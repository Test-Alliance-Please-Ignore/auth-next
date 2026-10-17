import { DurableObject } from 'cloudflare:workers'

import { captureException } from '@repo/hono-helpers'
import { formatMumbleError } from '@repo/mumble'

import { createPasswordVerifier, generatePassword } from './hazmat'
import { MurmurControlApiError, MurmurControlClient } from './murmur-control/client'

import type {
	LocalAccountSnapshot,
	Mumble,
	MumbleAccountStatus,
	MumbleDeleteIntent,
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

interface PendingDelete {
	intent: MumbleDeleteIntent
	requestedAt: number
}

const DELETE_INTENTS: ReadonlySet<string> = new Set([
	'offboarding',
	'blacklist',
	'user_deleted',
	'admin_manual',
	'tempop_terminal',
])

function isPendingDelete(value: unknown): value is PendingDelete {
	if (typeof value !== 'object' || value === null) return false
	const pending = value as Partial<PendingDelete>
	return (
		typeof pending.intent === 'string' &&
		DELETE_INTENTS.has(pending.intent) &&
		typeof pending.requestedAt === 'number' &&
		Number.isFinite(pending.requestedAt)
	)
}

/** Expected while the control API's scoped projection repair is disabled. */
const PROJECTION_REPAIR_DISABLED_MESSAGE = 'Mumble projection-only deletion is not enabled'

/** Durable state prefix for on-demand user sync cooldown leases. */
const USER_SYNC_PREFIX = 'user-sync:'
/** Keep temporary sync state only until the cooldown has elapsed. */
const USER_SYNC_DEFAULT_COOLDOWN_MS = 5 * 60 * 1000

interface UserSyncState {
	completedAt: number
	cooldownMs: number
	leaseToken: string | null
	leaseUntil: number
	cleanupAt: number
}

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

				// The new account is a later explicit intent than any pending delete.
				await this.clearPendingDelete(serverId, input.subjectId)
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

	private userSyncKey(subjectId: string): string {
		return `${USER_SYNC_PREFIX}${subjectId}`
	}

	async tryClaimUserSync(
		_serverId: string,
		subjectId: string,
		cooldownMs: number,
		leaseMs: number,
		nowMs = Date.now()
	): Promise<{ token: string } | null> {
		if (cooldownMs < 0 || leaseMs <= 0) {
			throw new Error('User sync cooldown and lease must be non-negative and positive respectively')
		}

		return this.serialize(async () => {
			const key = this.userSyncKey(subjectId)
			const current = (await this.state.storage.get<UserSyncState>(key)) ?? {
				completedAt: 0,
				cooldownMs,
				leaseToken: null,
				leaseUntil: 0,
				cleanupAt: 0,
			}
			const cleanupAt =
				current.cleanupAt > 0
					? current.cleanupAt
					: current.completedAt > 0
						? current.completedAt + (current.cooldownMs || cooldownMs)
						: current.leaseUntil

			if (current.leaseToken && current.leaseUntil > nowMs) {
				return null
			}
			if (cleanupAt > nowMs) {
				return null
			}

			const token = crypto.randomUUID()
			await this.state.storage.put(key, {
				completedAt: current.completedAt,
				cooldownMs,
				leaseToken: token,
				leaseUntil: nowMs + leaseMs,
				cleanupAt: nowMs + leaseMs,
			})
			await this.scheduleUserSyncAlarm(nowMs + leaseMs)
			return { token }
		})
	}

	async completeUserSync(
		_serverId: string,
		subjectId: string,
		token: string,
		nowMs = Date.now()
	): Promise<void> {
		await this.serialize(async () => {
			const key = this.userSyncKey(subjectId)
			const current = await this.state.storage.get<UserSyncState>(key)
			if (current?.leaseToken !== token) return
			await this.state.storage.put(key, {
				completedAt: nowMs,
				cooldownMs: current.cooldownMs || USER_SYNC_DEFAULT_COOLDOWN_MS,
				leaseToken: null,
				leaseUntil: 0,
				cleanupAt: nowMs + (current.cooldownMs || USER_SYNC_DEFAULT_COOLDOWN_MS),
			})
			await this.scheduleUserSyncAlarm(
				nowMs + (current.cooldownMs || USER_SYNC_DEFAULT_COOLDOWN_MS)
			)
		})
	}

	async releaseUserSync(_serverId: string, subjectId: string, token: string): Promise<void> {
		await this.serialize(async () => {
			const key = this.userSyncKey(subjectId)
			const current = await this.state.storage.get<UserSyncState>(key)
			if (current?.leaseToken !== token) return
			await this.state.storage.delete(key)
		})
	}

	private async scheduleUserSyncAlarm(scheduledAt: number): Promise<void> {
		const existingAlarm = await this.state.storage.getAlarm()
		const nowMs = Date.now()
		if (existingAlarm === null || existingAlarm <= nowMs || existingAlarm > scheduledAt) {
			await this.state.storage.setAlarm(scheduledAt)
		}
	}

	private async cleanupUserSyncStates(nowMs: number): Promise<number | null> {
		const entries = await this.state.storage.list<UserSyncState>({ prefix: USER_SYNC_PREFIX })
		let nextCleanupAt: number | null = null
		const expiredKeys: string[] = []

		for (const [key, state] of entries) {
			const cleanupAt =
				state.cleanupAt > 0
					? state.cleanupAt
					: state.completedAt > 0
						? state.completedAt + (state.cooldownMs || USER_SYNC_DEFAULT_COOLDOWN_MS)
						: state.leaseUntil
			if (cleanupAt <= nowMs) {
				expiredKeys.push(key)
			} else if (nextCleanupAt === null || cleanupAt < nextCleanupAt) {
				nextCleanupAt = cleanupAt
			}
		}

		if (expiredKeys.length > 0) {
			await this.state.storage.delete(expiredKeys)
		}

		return nextCleanupAt
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
		// A queued projection was created by a persisted local-account write;
		// group/profile updates may arrive before Murmur reconciliation finishes.
		const known = new Set(state.users.map((user) => user.subjectId))
		for (const subjectId of subjectIds) {
			if (known.has(subjectId)) provisioned.add(subjectId)
		}
		return provisioned
	}

	/**
	 * Fetch projected local accounts for the given server, keyed by subjectId.
	 * Queued rows retain the current local-account fields while Murmur catches up.
	 */
	private async getProjectedUsers(serverId: string): Promise<Map<string, UserProjectionSnapshot>> {
		const state = await this.client().getUserState(serverId)
		return new Map(state.users.map((user) => [user.subjectId, user]))
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
				const projected = await this.getProjectedUsers(serverId)
				const toSync = assignments.filter((assignment) => projected.has(assignment.subjectId))
				const skipped = assignments
					.filter((assignment) => !projected.has(assignment.subjectId))
					.map((assignment) => assignment.subjectId)

				const client = this.client()
				for (const batch of chunk(toSync, CHUNK_SIZE)) {
					const accounts = batch.map((assignment) => {
						const current = projected.get(assignment.subjectId)!
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

	async deleteAccounts(
		serverId: string,
		subjectIds: string[],
		intent: MumbleDeleteIntent
	): Promise<MumbleDeleteResult> {
		if (!DELETE_INTENTS.has(intent)) {
			throw typedError('validation', 'A recognized Mumble deletion intent is required')
		}
		if (subjectIds.length === 0) {
			return { deleted: [], notFound: [], queued: [] }
		}

		return this.serialize(() => this.deleteAccountsInner(serverId, subjectIds, true, intent))
	}

	/**
	 * Delete accounts, queueing failures for alarm-driven retry.
	 *
	 * Unconfirmed deletions are persisted to DO storage. Alarm retries only
	 * after Core confirms that the original reason is still valid.
	 */
	private async deleteAccountsInner(
		serverId: string,
		subjectIds: string[],
		allowProjectionRepair: boolean,
		intent: MumbleDeleteIntent
	): Promise<MumbleDeleteResult> {
		const deleted: string[] = []
		const notFound: string[] = []
		const queued: string[] = []
		let client: MurmurControlClient

		try {
			client = this.client()
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'MumbleDO', method: 'deleteAccounts', serverId },
				extra: { queuedSubjectIds: subjectIds },
			})
			await this.queuePendingDeletes(serverId, subjectIds, intent)
			return { deleted, notFound, queued: [...subjectIds] }
		}

		const getProjection = async (subjectId: string) => {
			const state = await client.getUserState(serverId, { subjectId })
			if (
				state.serverId !== serverId ||
				state.users.length > 1 ||
				state.users.some((user) => user.subjectId !== subjectId)
			) {
				throw new Error(`Unexpected Mumble projection response for ${subjectId}`)
			}
			return state.users[0] ?? null
		}

		for (const subjectId of subjectIds) {
			try {
				const account = await client.getLocalAccount(serverId, subjectId)
				const projection = await getProjection(subjectId)
				if (!account && !projection) {
					await this.clearPendingDelete(serverId, subjectId)
					notFound.push(subjectId)
					continue
				}

				if (account) {
					const result = await client.delete(serverId, [subjectId])
					if (
						result.serverId !== serverId ||
						result.deletedSubjectIds.length !== 1 ||
						result.deletedSubjectIds[0] !== subjectId
					) {
						throw new Error(`Mumble delete did not confirm ${subjectId}`)
					}
				}

				// A control-plane reload can leave a projection after the local row
				// disappears. The scoped user route also kicks and unregisters Murmur.
				if (await client.getLocalAccount(serverId, subjectId)) {
					throw new Error(`Mumble local account ${subjectId} survived deletion`)
				}
				if (await getProjection(subjectId)) {
					// Scoped projection deletion requires the verified control API.
					if (!allowProjectionRepair || this.env.MUMBLE_CONTROL_SAFE_PROJECTION_DELETE !== 'true') {
						throw new Error(PROJECTION_REPAIR_DISABLED_MESSAGE)
					}
					await client.deleteProjectedUser(serverId, subjectId)
				}
				if (
					(await client.getLocalAccount(serverId, subjectId)) ||
					(await getProjection(subjectId))
				) {
					throw new Error(`Mumble account ${subjectId} survived deletion verification`)
				}
				await this.clearPendingDelete(serverId, subjectId)
				deleted.push(subjectId)
			} catch (error) {
				queued.push(subjectId)
				// The feature gate deliberately keeps projection-only orphans queued.
				if (!(error instanceof Error && error.message === PROJECTION_REPAIR_DISABLED_MESSAGE)) {
					captureException(error as Error, {
						tags: { durableObject: 'MumbleDO', method: 'deleteAccounts', serverId },
						extra: { queuedSubjectIds: [subjectId] },
					})
				}
				// Persist the failed subject before another network request can time out.
				await this.queuePendingDeletes(serverId, [subjectId], intent)
			}
		}

		return { deleted, notFound, queued }
	}

	/** Remove a completed or superseded deletion. */
	private async clearPendingDelete(serverId: string, subjectId: string): Promise<void> {
		await this.state.storage.delete(`${PENDING_DELETE_PREFIX}${serverId}:${subjectId}`)
	}

	/** Persist failed deletions and arm the retry alarm. */
	private async queuePendingDeletes(
		serverId: string,
		subjectIds: string[],
		intent: MumbleDeleteIntent
	): Promise<void> {
		if (subjectIds.length === 0) return
		const entries: Record<string, PendingDelete> = {}
		for (const subjectId of subjectIds) {
			entries[`${PENDING_DELETE_PREFIX}${serverId}:${subjectId}`] = {
				intent,
				requestedAt: Date.now(),
			}
		}
		await this.state.storage.put(entries)
		await this.scheduleUserSyncAlarm(Date.now() + PENDING_DELETE_RETRY_MS)
	}

	/**
	 * Alarm handler: recheck every pending deletion against Core before retrying.
	 * Legacy numeric entries have no original intent, so treat them as
	 * offboarding or terminal temp-op only after the same Core recheck.
	 */
	async alarm(): Promise<void> {
		const pendingEntries = await this.state.storage.list<PendingDelete | number>({
			prefix: PENDING_DELETE_PREFIX,
		})

		for (const key of pendingEntries.keys()) {
			// Server IDs contain no colons, while temp-op subject IDs do.
			const rest = key.slice(PENDING_DELETE_PREFIX.length)
			const sep = rest.indexOf(':')
			if (sep === -1) continue
			const serverId = rest.slice(0, sep)
			const subjectId = rest.slice(sep + 1)

			// Process one subject at a time so interactive mutations can run
			// between retries. The re-read and Core decision share the same lock.
			await this.serialize(async () => {
				const value = await this.state.storage.get<PendingDelete | number>(key)
				// Older releases persisted only a timestamp. Their original reason
				// cannot be recovered; use the conservative current-state rule.
				const intent = isPendingDelete(value)
					? value.intent
					: typeof value === 'number' && Number.isFinite(value)
						? subjectId.startsWith('tempop:')
							? 'tempop_terminal'
							: 'offboarding'
						: null
				if (!intent) return
				let decision: 'retry' | 'cancel' | 'defer'
				try {
					decision = await this.env.CORE.decideMumbleDeleteRetry(serverId, subjectId, intent)
				} catch (error) {
					captureException(error as Error, {
						tags: { durableObject: 'MumbleDO', method: 'alarm', serverId },
						extra: { subjectId, intent },
					})
					return
				}
				if (decision === 'cancel') {
					await this.clearPendingDelete(serverId, subjectId)
				} else if (decision === 'retry') {
					await this.deleteAccountsInner(serverId, [subjectId], true, intent)
				}
			})
		}

		// Queue writes also hold the mutation lock. Re-read and schedule under
		// it so a concurrent failed delete cannot lose its retry alarm.
		await this.serialize(async () => {
			const remainingPendingEntries = await this.state.storage.list<PendingDelete | number>({
				prefix: PENDING_DELETE_PREFIX,
			})
			const nextUserSyncCleanupAt = await this.cleanupUserSyncStates(Date.now())
			if (remainingPendingEntries.size === 0) {
				if (nextUserSyncCleanupAt === null) {
					await this.state.storage.deleteAlarm()
				} else {
					await this.state.storage.setAlarm(nextUserSyncCleanupAt)
				}
			} else {
				await this.scheduleUserSyncAlarm(
					Math.min(Date.now() + PENDING_DELETE_RETRY_MS, nextUserSyncCleanupAt ?? Infinity)
				)
			}
		})
	}
}
