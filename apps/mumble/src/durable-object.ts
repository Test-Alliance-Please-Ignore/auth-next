import { DurableObject } from 'cloudflare:workers'

import { captureException } from '@repo/hono-helpers'
import { formatMumbleError } from '@repo/mumble'

import { createPasswordVerifier, generatePassword } from './hazmat'
import { MurmurControlApiError, MurmurControlClient } from './murmur-control/client'

import type {
	LocalAccountSnapshot,
	Mumble,
	MumbleAccountStatus,
	MumbleDeleteResult,
	MumbleErrorCode,
	MumbleGroupAssignment,
	MumbleProfileAssignment,
	MumbleProvisionInput,
	MumbleProvisionResult,
	MumbleSyncGroupsResult,
	MumbleSyncProfilesResult,
	UserProjectionSnapshot,
} from '@repo/mumble'
import type { Env } from './context'

/** Max entries per outbound murmur-control batch request */
const CHUNK_SIZE = 200

/** Token bucket: sustained provisions/resets per second */
const BUCKET_REFILL_PER_SECOND = 5
/** Token bucket: burst capacity */
const BUCKET_CAPACITY = 10

/** Max numeric suffix tried when resolving loginName collisions */
const MAX_LOGIN_NAME_SUFFIX = 9

/** DO storage key prefix for deletions awaiting retry against murmur-control */
const PENDING_DELETE_PREFIX = 'pending-delete:'

/** Retry interval for pending deletions */
const PENDING_DELETE_RETRY_MS = 5 * 60 * 1000

/**
 * Assignments at or below this count are existence-checked per subject;
 * larger batches use a single full user-state read instead.
 */
const PER_SUBJECT_LOOKUP_THRESHOLD = 2

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

function toAccountStatus(snapshot: LocalAccountSnapshot): MumbleAccountStatus {
	return {
		subjectId: snapshot.subjectId,
		loginName: snapshot.loginName,
		displayName: snapshot.displayName,
		enabled: snapshot.enabled,
		groups: snapshot.groups,
		hasPassword: snapshot.hasPassword,
		lastAuthenticatedAt: snapshot.lastAuthenticatedAt,
	}
}

function typedError(code: MumbleErrorCode, message: string): Error {
	return new Error(formatMumbleError(code, message))
}

/**
 * Mumble Durable Object
 *
 * One instance per Murmur server (instance name = serverId). All
 * murmur-control writes funnel through this object, which serializes them and
 * applies a token-bucket throttle to interactive operations so a launch rush
 * cannot overwhelm the control plane.
 *
 * Account state lives in murmur-control (no local tables); DO storage holds
 * only a small alarm-driven retry queue for failed deletions.
 */
export class MumbleDO extends DurableObject<Env> implements Mumble {
	/** In-memory token bucket for interactive ops (provision/reset). */
	private bucketTokens = BUCKET_CAPACITY
	private bucketLastRefill = Date.now()

	/** Tail of the mutation queue — see serialize(). */
	private writeLock: Promise<unknown> = Promise.resolve()

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	private client(): MurmurControlClient {
		return new MurmurControlClient({
			baseUrl: this.env.MURMUR_CONTROL_API_URL,
			fetcher: this.env.MURMUR_CONTROL_MTLS ?? undefined,
			token: this.env.MURMUR_CONTROL_TOKEN,
			environment: this.env.ENVIRONMENT,
		})
	}

	/**
	 * Serialize mutating murmur-control operations.
	 *
	 * Durable Object event handlers interleave at await points (input gates
	 * only cover storage), so check-then-write sequences like the provision
	 * exists-check or loginName collision resolution would race under
	 * concurrent RPCs. Chaining them on one promise makes each mutation see
	 * the previous one's writes. Reads (getAccount) stay concurrent.
	 */
	private serialize<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.writeLock.then(fn, fn)
		this.writeLock = next.catch(() => undefined)
		return next
	}

	/** Take a token from the bucket, or throw a typed busy error. */
	private takeToken(): void {
		const now = Date.now()
		const elapsedSeconds = (now - this.bucketLastRefill) / 1000
		this.bucketTokens = Math.min(
			BUCKET_CAPACITY,
			this.bucketTokens + elapsedSeconds * BUCKET_REFILL_PER_SECOND
		)
		this.bucketLastRefill = now

		if (this.bucketTokens < 1) {
			throw typedError('busy', 'Mumble control plane is busy, retry shortly')
		}
		this.bucketTokens -= 1
	}

	/**
	 * Wrap murmur-control failures: report to Sentry and convert to typed
	 * errors that survive the RPC boundary.
	 */
	private handleError(error: unknown, method: string, serverId: string): never {
		captureException(error as Error, {
			tags: { durableObject: 'MumbleDO', method, serverId },
		})
		if (error instanceof MurmurControlApiError) {
			throw typedError(error.code, error.message)
		}
		throw error
	}

	/**
	 * Resolve a free loginName: the base name, then base_2..base_9.
	 * Names are matched case-insensitively by murmur-control, so candidates
	 * are lowercased up front. Callers must hold the mutation queue (see
	 * serialize()) so the check-then-write is safe against our own traffic.
	 */
	private async resolveLoginName(
		serverId: string,
		baseName: string,
		subjectId: string
	): Promise<string> {
		const client = this.client()
		const base = baseName.toLowerCase()
		const candidates = [base]
		for (let i = 2; i <= MAX_LOGIN_NAME_SUFFIX; i++) {
			candidates.push(`${base}_${i}`)
		}

		for (const candidate of candidates) {
			const state = await client.getUserState(serverId, { loginName: candidate })
			const holder = state.users[0]
			if (!holder || holder.subjectId === subjectId) {
				return candidate
			}
		}

		throw typedError('login_name_taken', `No free login name available for ${base}`)
	}

	async provisionAccount(
		serverId: string,
		input: MumbleProvisionInput
	): Promise<MumbleProvisionResult> {
		// Throttle before queueing so callers fail fast with `busy` instead of
		// piling onto the mutation queue.
		this.takeToken()
		return this.serialize(async () => {
			try {
				const client = this.client()

				const existing = await client.getLocalAccount(serverId, input.subjectId)
				if (existing) {
					throw typedError('already_exists', `Subject ${input.subjectId} already has an account`)
				}

				const loginName = await this.resolveLoginName(serverId, input.loginName, input.subjectId)
				const password = generatePassword()
				const passwordVerifier = await createPasswordVerifier(password)

				const result = await client.batchSync(serverId, [
					{
						subjectId: input.subjectId,
						loginName,
						displayName: input.displayName,
						enabled: true,
						groups: input.groups,
						...(input.comment !== undefined ? { comment: input.comment } : {}),
						passwordVerifier,
					},
				])

				const snapshot = result.updated.find((account) => account.subjectId === input.subjectId)
				if (!snapshot) {
					throw new MurmurControlApiError(500, 'batchSync did not return the provisioned account')
				}

				return { account: toAccountStatus(snapshot), password }
			} catch (error) {
				this.handleError(error, 'provisionAccount', serverId)
			}
		})
	}

	async resetPassword(serverId: string, subjectId: string): Promise<{ password: string }> {
		this.takeToken()
		return this.serialize(async () => {
			try {
				const client = this.client()

				const existing = await client.getLocalAccount(serverId, subjectId)
				if (!existing) {
					throw typedError('not_found', `Subject ${subjectId} has no Mumble account`)
				}

				const password = generatePassword()
				const passwordVerifier = await createPasswordVerifier(password)

				// Echo the current account intent with fresh verifier material only
				await client.batchSync(serverId, [
					{
						subjectId,
						loginName: existing.loginName,
						displayName: existing.displayName,
						enabled: existing.enabled,
						groups: existing.groups,
						...(existing.comment !== null ? { comment: existing.comment } : {}),
						passwordVerifier,
					},
				])

				return { password }
			} catch (error) {
				this.handleError(error, 'resetPassword', serverId)
			}
		})
	}

	async getAccount(serverId: string, subjectId: string): Promise<MumbleAccountStatus | null> {
		try {
			const snapshot = await this.client().getLocalAccount(serverId, subjectId)
			return snapshot ? toAccountStatus(snapshot) : null
		} catch (error) {
			this.handleError(error, 'getAccount', serverId)
		}
	}

	/**
	 * Find which of the given subjects have provisioned accounts.
	 * Small inputs use per-subject reads; larger batches use one full
	 * user-state read to keep the request count bounded.
	 */
	private async findProvisionedSubjects(
		serverId: string,
		subjectIds: string[]
	): Promise<Set<string>> {
		const client = this.client()
		const provisioned = new Set<string>()

		if (subjectIds.length <= PER_SUBJECT_LOOKUP_THRESHOLD) {
			for (const subjectId of subjectIds) {
				const account = await client.getLocalAccount(serverId, subjectId)
				if (account) provisioned.add(subjectId)
			}
			return provisioned
		}

		const state = await client.getUserState(serverId)
		const known = new Set(
			state.users.filter((user) => user.status === 'reconciled').map((user) => user.subjectId)
		)
		for (const subjectId of subjectIds) {
			if (known.has(subjectId)) provisioned.add(subjectId)
		}
		return provisioned
	}

	/**
	 * Fetch reconciled projected users for the given server, keyed by subjectId.
	 * Only reconciled rows are authoritative enough for profile/group sync.
	 */
	private async getReconciledProjectedUsers(
		serverId: string
	): Promise<Map<string, UserProjectionSnapshot>> {
		const state = await this.client().getUserState(serverId)
		return new Map(
			state.users
				.filter((user) => user.status === 'reconciled')
				.map((user) => [user.subjectId, user])
		)
	}

	async syncUserGroups(
		serverId: string,
		assignments: MumbleGroupAssignment[],
		reason?: string
	): Promise<MumbleSyncGroupsResult> {
		if (assignments.length === 0) {
			return { synced: [], skipped: [] }
		}

		return this.serialize(async () => {
			try {
				const provisioned = await this.findProvisionedSubjects(
					serverId,
					assignments.map((assignment) => assignment.subjectId)
				)

				const toSync = assignments.filter((assignment) => provisioned.has(assignment.subjectId))
				const skipped = assignments
					.filter((assignment) => !provisioned.has(assignment.subjectId))
					.map((assignment) => assignment.subjectId)

				const client = this.client()
				for (const batch of chunk(toSync, CHUNK_SIZE)) {
					await client.assignGroups(serverId, batch, reason)
				}

				return { synced: toSync.map((assignment) => assignment.subjectId), skipped }
			} catch (error) {
				this.handleError(error, 'syncUserGroups', serverId)
			}
		})
	}

	async syncAccountProfiles(
		serverId: string,
		assignments: MumbleProfileAssignment[]
	): Promise<MumbleSyncProfilesResult> {
		if (assignments.length === 0) {
			return { synced: [], skipped: [] }
		}

		return this.serialize(async () => {
			try {
				const reconciled = await this.getReconciledProjectedUsers(serverId)
				const toSync = assignments.filter((assignment) => reconciled.has(assignment.subjectId))
				const skipped = assignments
					.filter((assignment) => !reconciled.has(assignment.subjectId))
					.map((assignment) => assignment.subjectId)

				const client = this.client()
				for (const batch of chunk(toSync, CHUNK_SIZE)) {
					const accounts = batch.map((assignment) => {
						const current = reconciled.get(assignment.subjectId)!
						return {
							subjectId: current.subjectId,
							loginName: current.loginName,
							displayName: assignment.displayName,
							enabled: current.enabled,
							groups: current.groups,
							...(current.comment !== null ? { comment: current.comment } : {}),
						}
					})
					await client.batchSync(serverId, accounts)
				}

				return { synced: toSync.map((assignment) => assignment.subjectId), skipped }
			} catch (error) {
				this.handleError(error, 'syncAccountProfiles', serverId)
			}
		})
	}

	async enableAccounts(serverId: string, subjectIds: string[]): Promise<void> {
		if (subjectIds.length === 0) return
		return this.serialize(async () => {
			try {
				const client = this.client()
				for (const batch of chunk(subjectIds, CHUNK_SIZE)) {
					await client.enable(serverId, batch)
				}
			} catch (error) {
				this.handleError(error, 'enableAccounts', serverId)
			}
		})
	}

	async disableAccounts(serverId: string, subjectIds: string[]): Promise<void> {
		if (subjectIds.length === 0) return
		return this.serialize(async () => {
			try {
				const client = this.client()
				for (const batch of chunk(subjectIds, CHUNK_SIZE)) {
					await client.disable(serverId, batch)
				}
			} catch (error) {
				this.handleError(error, 'disableAccounts', serverId)
			}
		})
	}

	async deleteAccounts(serverId: string, subjectIds: string[]): Promise<MumbleDeleteResult> {
		if (subjectIds.length === 0) {
			return { deleted: [], notFound: [], queued: [] }
		}

		return this.serialize(() => this.deleteAccountsInner(serverId, subjectIds))
	}

	/**
	 * Delete accounts, queueing failures for alarm-driven retry.
	 *
	 * Deletion must be durable: the caller (user deletion in core) proceeds
	 * regardless, and once the upstream user row is gone nothing else will
	 * ever disable the voice account. Any subjects that cannot be confirmed
	 * deleted are persisted to DO storage and retried by alarm() until
	 * murmur-control confirms them gone.
	 */
	private async deleteAccountsInner(
		serverId: string,
		subjectIds: string[]
	): Promise<MumbleDeleteResult> {
		const deleted: string[] = []
		let notFound: string[] = []
		let pending = [...subjectIds]

		try {
			// Pre-filter to provisioned accounts: :delete is not idempotent and
			// returns 404 for missing subjects.
			const provisioned = await this.findProvisionedSubjects(serverId, subjectIds)
			notFound = subjectIds.filter((subjectId) => !provisioned.has(subjectId))
			pending = subjectIds.filter((subjectId) => provisioned.has(subjectId))

			const client = this.client()
			for (const batch of chunk(pending, CHUNK_SIZE)) {
				const result = await client.delete(serverId, batch)
				deleted.push(...result.deletedSubjectIds)

				// On a successful response, anything murmur-control did not list as
				// deleted no longer exists on its side — treat it as notFound.
				const confirmed = new Set(result.deletedSubjectIds)
				notFound.push(...batch.filter((subjectId) => !confirmed.has(subjectId)))

				// Batch is fully resolved; pending keeps only unattempted chunks so
				// the catch block queues exactly the unresolved remainder.
				const batchSet = new Set(batch)
				pending = pending.filter((subjectId) => !batchSet.has(subjectId))
			}

			return { deleted, notFound, queued: [] }
		} catch (error) {
			// Queue everything unresolved for retry instead of surfacing the
			// failure — the upstream deletion must not be blocked, but the voice
			// account must not be orphaned either.
			captureException(error as Error, {
				tags: { durableObject: 'MumbleDO', method: 'deleteAccounts', serverId },
				extra: { queuedSubjectIds: pending },
			})
			await this.queuePendingDeletes(serverId, pending)
			return { deleted, notFound, queued: pending }
		}
	}

	/** Persist failed deletions and arm the retry alarm. */
	private async queuePendingDeletes(serverId: string, subjectIds: string[]): Promise<void> {
		if (subjectIds.length === 0) return
		const entries: Record<string, number> = {}
		for (const subjectId of subjectIds) {
			entries[`${PENDING_DELETE_PREFIX}${serverId}:${subjectId}`] = Date.now()
		}
		await this.state.storage.put(entries)
		const existingAlarm = await this.state.storage.getAlarm()
		if (existingAlarm === null) {
			await this.state.storage.setAlarm(Date.now() + PENDING_DELETE_RETRY_MS)
		}
	}

	/**
	 * Alarm handler: retry pending deletions until murmur-control confirms
	 * each account gone, then clear the queue entries.
	 */
	async alarm(): Promise<void> {
		const pendingEntries = await this.state.storage.list<number>({
			prefix: PENDING_DELETE_PREFIX,
		})
		if (pendingEntries.size === 0) return

		// Group queued subjects by serverId. subjectIds are UUIDs (no colons),
		// so the last colon separates serverId from subjectId.
		const byServer = new Map<string, string[]>()
		for (const key of pendingEntries.keys()) {
			const rest = key.slice(PENDING_DELETE_PREFIX.length)
			const sep = rest.lastIndexOf(':')
			if (sep === -1) continue
			const serverId = rest.slice(0, sep)
			const subjectId = rest.slice(sep + 1)
			const list = byServer.get(serverId) ?? []
			list.push(subjectId)
			byServer.set(serverId, list)
		}

		for (const [serverId, subjectIds] of byServer) {
			// Still-failing subjects are re-queued (and the alarm re-armed) by
			// deleteAccountsInner via queuePendingDeletes.
			const result = await this.serialize(() => this.deleteAccountsInner(serverId, subjectIds))
			const resolved = [...result.deleted, ...result.notFound]
			if (resolved.length > 0) {
				await this.state.storage.delete(
					resolved.map((subjectId) => `${PENDING_DELETE_PREFIX}${serverId}:${subjectId}`)
				)
			}
		}
	}
}
