/**
 * @repo/mumble
 *
 * Shared types and interfaces for the Mumble Durable Object.
 * This package allows other workers (core) to manage Mumble voice accounts in
 * the external murmur-control control plane via RPC.
 *
 * Identity model: `subjectId` is the core user UUID (users.id) and is the
 * stable join key murmur-control stores accounts under. `loginName` is the
 * credential the Mumble client connects with (unique case-insensitively per
 * server) — never use it to correlate records.
 */
import type { DurableObject } from 'cloudflare:workers'

export * from './schemas'

/**
 * Error codes surfaced by the Mumble DO to callers.
 * Core maps these onto HTTP statuses: already_exists -> 409, not_found -> 404,
 * busy -> 429, login_name_taken -> 409, unavailable -> 502.
 */
export type MumbleErrorCode =
	| 'already_exists'
	| 'not_found'
	| 'login_name_taken'
	| 'busy'
	| 'unauthorized'
	| 'validation'
	| 'unavailable'
	| 'unknown'

/**
 * Prefix for RPC-safe typed errors thrown by the Mumble DO.
 * Error instances do not cross the RPC boundary with custom fields intact,
 * so errors are encoded as `${MUMBLE_ERROR_PREFIX}${code}:${message}`.
 * Use parseMumbleError() on the caller side.
 */
export const MUMBLE_ERROR_PREFIX = 'MUMBLE_ERROR:'

/** Parse a typed Mumble error from a caught RPC error, if present. */
export function parseMumbleError(
	error: unknown
): { code: MumbleErrorCode; message: string } | null {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
	if (!message.startsWith(MUMBLE_ERROR_PREFIX)) return null
	const rest = message.slice(MUMBLE_ERROR_PREFIX.length)
	const sep = rest.indexOf(':')
	if (sep === -1) return { code: rest as MumbleErrorCode, message: '' }
	return { code: rest.slice(0, sep) as MumbleErrorCode, message: rest.slice(sep + 1) }
}

/** Build the message for a typed Mumble error. */
export function formatMumbleError(code: MumbleErrorCode, message: string): string {
	return `${MUMBLE_ERROR_PREFIX}${code}:${message}`
}

/**
 * Input for provisioning a new Mumble account.
 */
export interface MumbleProvisionInput {
	/** Core user UUID — the stable subject join key */
	subjectId: string
	/** Desired base login name; collisions are resolved with numeric suffixes */
	loginName: string
	/** Display name, typically the user's main character name */
	displayName: string
	/** auth-next group names to project */
	groups: string[]
	/** Optional account comment */
	comment?: string
}

/**
 * Account status exposed to core/UI.
 */
export interface MumbleAccountStatus {
	subjectId: string
	loginName: string
	displayName: string
	enabled: boolean
	groups: string[]
	hasPassword: boolean
	lastAuthenticatedAt: string | null
}

/**
 * One user's full desired group set.
 */
export interface MumbleGroupAssignment {
	subjectId: string
	groups: string[]
}

export interface MumbleProvisionResult {
	account: MumbleAccountStatus
	/** One-time plaintext password — returned exactly once, never stored */
	password: string
}

export interface MumbleSyncGroupsResult {
	/** Subjects whose groups were pushed to murmur-control */
	synced: string[]
	/** Subjects skipped because they have no Mumble account */
	skipped: string[]
}

export interface MumbleDeleteResult {
	/** Subjects deleted from murmur-control */
	deleted: string[]
	/** Subjects that had no account to delete */
	notFound: string[]
}

/**
 * Public RPC interface for the Mumble Durable Object.
 *
 * One DO instance per Murmur server (instance name = serverId), which
 * serializes all murmur-control writes for that server. Every method still
 * takes serverId explicitly — never derived from the DO id.
 *
 * @example
 * ```ts
 * import { getStub } from '@repo/do-utils'
 * import type { Mumble } from '@repo/mumble'
 *
 * const stub = getStub<Mumble>(env.MUMBLE, serverId)
 * const account = await stub.getAccount(serverId, userId)
 * ```
 */
export interface Mumble extends DurableObject {
	/**
	 * Provision a new account with a generated one-time password.
	 * Throws typed errors: already_exists, login_name_taken, busy.
	 */
	provisionAccount(serverId: string, input: MumbleProvisionInput): Promise<MumbleProvisionResult>

	/**
	 * Rotate the password for an existing account.
	 * Throws typed errors: not_found, busy.
	 */
	resetPassword(serverId: string, subjectId: string): Promise<{ password: string }>

	/** Get account status, or null if the subject has no account. */
	getAccount(serverId: string, subjectId: string): Promise<MumbleAccountStatus | null>

	/**
	 * Replace group sets for the given subjects (batch-first; pass 1 or N).
	 * Subjects without an account are filtered out and reported as skipped.
	 */
	syncUserGroups(
		serverId: string,
		assignments: MumbleGroupAssignment[],
		reason?: string
	): Promise<MumbleSyncGroupsResult>

	/** Enable the listed accounts (explicit-only; omitted accounts untouched). */
	enableAccounts(serverId: string, subjectIds: string[]): Promise<void>

	/** Disable the listed accounts and disconnect their active sessions. */
	disableAccounts(serverId: string, subjectIds: string[]): Promise<void>

	/**
	 * Delete the listed accounts (disconnects sessions, unregisters Murmur
	 * users). Missing accounts are reported as notFound, not errors.
	 */
	deleteAccounts(serverId: string, subjectIds: string[]): Promise<MumbleDeleteResult>
}
