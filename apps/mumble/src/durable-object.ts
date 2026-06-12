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
	MumbleProvisionInput,
	MumbleProvisionResult,
	MumbleSyncGroupsResult,
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
 * Stateless by design: murmur-control is the authoritative store of account
 * state; this object holds no SQLite tables in the MVP.
 */
export class MumbleDO extends DurableObject<Env> implements Mumble {
	/** In-memory token bucket for interactive ops (provision/reset). */
	private bucketTokens = BUCKET_CAPACITY
	private bucketLastRefill = Date.now()

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	private client(): MurmurControlClient {
		return new MurmurControlClient({
			baseUrl: this.env.MURMUR_CONTROL_API_URL,
			token: this.env.MURMUR_CONTROL_TOKEN,
		})
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
	 * are lowercased up front. Serialized writes through this DO make the
	 * check-then-write safe against our own traffic.
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
		this.takeToken()
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
	}

	async resetPassword(serverId: string, subjectId: string): Promise<{ password: string }> {
		this.takeToken()
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
		const known = new Set(state.users.map((user) => user.subjectId))
		for (const subjectId of subjectIds) {
			if (known.has(subjectId)) provisioned.add(subjectId)
		}
		return provisioned
	}

	async syncUserGroups(
		serverId: string,
		assignments: MumbleGroupAssignment[],
		reason?: string
	): Promise<MumbleSyncGroupsResult> {
		if (assignments.length === 0) {
			return { synced: [], skipped: [] }
		}

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
	}

	async enableAccounts(serverId: string, subjectIds: string[]): Promise<void> {
		if (subjectIds.length === 0) return
		try {
			const client = this.client()
			for (const batch of chunk(subjectIds, CHUNK_SIZE)) {
				await client.enable(serverId, batch)
			}
		} catch (error) {
			this.handleError(error, 'enableAccounts', serverId)
		}
	}

	async disableAccounts(serverId: string, subjectIds: string[]): Promise<void> {
		if (subjectIds.length === 0) return
		try {
			const client = this.client()
			for (const batch of chunk(subjectIds, CHUNK_SIZE)) {
				await client.disable(serverId, batch)
			}
		} catch (error) {
			this.handleError(error, 'disableAccounts', serverId)
		}
	}

	async deleteAccounts(serverId: string, subjectIds: string[]): Promise<MumbleDeleteResult> {
		if (subjectIds.length === 0) {
			return { deleted: [], notFound: [] }
		}

		try {
			// Pre-filter to provisioned accounts: :delete is not idempotent and
			// returns 404 for missing subjects.
			const provisioned = await this.findProvisionedSubjects(serverId, subjectIds)
			const toDelete = subjectIds.filter((subjectId) => provisioned.has(subjectId))
			const notFound = subjectIds.filter((subjectId) => !provisioned.has(subjectId))

			const client = this.client()
			const deleted: string[] = []
			for (const batch of chunk(toDelete, CHUNK_SIZE)) {
				const result = await client.delete(serverId, batch)
				deleted.push(...result.deletedSubjectIds)
			}

			return { deleted, notFound }
		} catch (error) {
			this.handleError(error, 'deleteAccounts', serverId)
		}
	}
}
