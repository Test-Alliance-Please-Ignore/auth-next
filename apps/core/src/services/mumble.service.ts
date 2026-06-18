import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters, users } from '../db/schema'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type {
	Mumble,
	MumbleAccountStatus,
	MumbleDeleteResult,
	MumbleGroupAssignment,
	MumbleProfileAssignment,
	MumbleSyncGroupsResult,
	MumbleSyncProfilesResult,
} from '@repo/mumble'
import type { Env } from '../context'

const MAX_LOGIN_NAME_LENGTH = 60
const USER_GROUP_LOOKUP_CONCURRENCY = 5
const USER_PROFILE_LOOKUP_CONCURRENCY = 5

interface MumbleIdentity {
	characterName: string
	displayName: string
	loginName: string
}

interface GetUserGroupNamesOptions {
	forceEmptyGroups?: boolean
}

/**
 * Derive a Mumble login name from a character name.
 * Spaces become underscores; anything outside [A-Za-z0-9_.-] is stripped;
 * repeated underscores collapse. Falls back to a userId-derived name when
 * nothing usable remains. The mumble worker handles collisions.
 */
export function deriveLoginName(characterName: string, userId: string): string {
	const derived = characterName
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^A-Za-z0-9_.-]/g, '')
		.replace(/_+/g, '_')
		.replace(/^[_.-]+|[_.-]+$/g, '')
		.slice(0, MAX_LOGIN_NAME_LENGTH)

	if (derived.length > 0) {
		return derived
	}
	return `user_${userId.replace(/-/g, '').slice(0, 8)}`
}

function getMumbleStub(env: Env) {
	return getStub<Mumble>(env.MUMBLE, env.MUMBLE_SERVER_ID)
}

async function buildMumbleIdentity(env: Env, userId: string): Promise<MumbleIdentity> {
	const db = createDb(env.DATABASE_URL)
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: {
			mainCharacterId: true,
		},
	})
	if (!user) {
		throw new Error(`User ${userId} not found`)
	}

	const mainCharacter = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, user.mainCharacterId),
		columns: {
			characterName: true,
			corporationId: true,
		},
	})
	if (!mainCharacter) {
		throw new Error(`Main character ${user.mainCharacterId} not found for user ${userId}`)
	}

	let displayName = mainCharacter.characterName
	if (mainCharacter.corporationId) {
		const corpStub = getStub<EveCorporationData>(
			env.EVE_CORPORATION_DATA,
			mainCharacter.corporationId
		)
		const corpInfo = await corpStub.getCorporationInfo(mainCharacter.corporationId)
		const ticker = corpInfo?.ticker?.trim()
		if (ticker) {
			displayName = `${mainCharacter.characterName} [${ticker}]`
		}
	}

	return {
		characterName: mainCharacter.characterName,
		displayName,
		loginName: deriveLoginName(mainCharacter.characterName, userId),
	}
}

async function hasAllianceMemberAttachment(env: Env, userId: string): Promise<boolean> {
	const db = createDb(env.DATABASE_URL)
	const [characters, memberCorporations] = await Promise.all([
		db.query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
			columns: {
				corporationId: true,
				allianceId: true,
			},
		}),
		db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isMemberCorporation, true),
			columns: {
				corporationId: true,
			},
		}),
	])

	const memberCorporationIds = new Set(
		memberCorporations.map((corporation) => corporation.corporationId)
	)
	return characters.some(
		(character) =>
			(!!character.corporationId && memberCorporationIds.has(character.corporationId)) ||
			!!character.allianceId
	)
}

async function isUserBlacklisted(env: Env, userId: string): Promise<boolean> {
	const hrStub = getStub<Hr>(env.HR, 'default')
	return hrStub.isUserBlacklisted(userId)
}

async function runWithConcurrencyLimit<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return []

	const results = new Array<R>(items.length)
	let index = 0
	const workerCount = Math.max(1, Math.min(limit, items.length))

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const currentIndex = index
				index += 1
				if (currentIndex >= items.length) return
				results[currentIndex] = await worker(items[currentIndex])
			}
		})
	)

	return results
}

/** Connection info shown to users alongside their credentials. */
export function getMumbleConnectionInfo(env: Env): { host: string; port: number } {
	return { host: env.MUMBLE_HOST, port: Number(env.MUMBLE_PORT) }
}

/** Fetch the user's current auth-next group names. */
async function getUserGroupNames(
	env: Env,
	userId: string,
	options?: GetUserGroupNamesOptions
): Promise<string[]> {
	if (options?.forceEmptyGroups === true) {
		return []
	}

	if (await isUserBlacklisted(env, userId)) {
		return []
	}

	if (!(await hasAllianceMemberAttachment(env, userId))) {
		return []
	}

	const groupsStub = getStub<Groups>(env.GROUPS, 'default')
	const memberships = await groupsStub.getUserMemberships(userId)
	return memberships.map((membership) => membership.groupName)
}

/** Get the user's Mumble account status, or null when not provisioned. */
export async function getMumbleAccount(
	env: Env,
	userId: string
): Promise<MumbleAccountStatus | null> {
	return getMumbleStub(env).getAccount(env.MUMBLE_SERVER_ID, userId)
}

/**
 * Provision a Mumble account for a user with their current groups.
 * Returns the one-time plaintext password — it is never stored.
 */
export async function provisionMumbleAccount(
	env: Env,
	userId: string
): Promise<{ account: MumbleAccountStatus; password: string }> {
	const identity = await buildMumbleIdentity(env, userId)

	const groups = await getUserGroupNames(env, userId)

	return getMumbleStub(env).provisionAccount(env.MUMBLE_SERVER_ID, {
		subjectId: userId,
		loginName: identity.loginName,
		displayName: identity.displayName,
		groups,
	})
}

/** Rotate a user's Mumble password; returns the new one-time password. */
export async function resetMumblePassword(env: Env, userId: string): Promise<{ password: string }> {
	return getMumbleStub(env).resetPassword(env.MUMBLE_SERVER_ID, userId)
}

/**
 * Push current group memberships for the given users to murmur-control.
 * Batch-first: gathers each user's groups, then makes a single mumble RPC
 * which the worker maps to chunked murmur-control requests. Users without a
 * Mumble account are skipped inside the worker.
 */
export async function syncUsersMumbleGroups(
	env: Env,
	userIds: string[],
	reason?: string,
	options?: GetUserGroupNamesOptions
): Promise<MumbleSyncGroupsResult> {
	if (userIds.length === 0) {
		return { synced: [], skipped: [] }
	}

	const lookupResults = await runWithConcurrencyLimit(
		userIds,
		USER_GROUP_LOOKUP_CONCURRENCY,
		async (userId) => {
			try {
				return {
					status: 'ok' as const,
					userId,
					groups: await getUserGroupNames(env, userId, options),
				}
			} catch (error) {
				logger.error('[Mumble] Failed to gather groups for user', {
					userId,
					error: error instanceof Error ? error.message : String(error),
				})
				return { status: 'failed' as const, userId }
			}
		}
	)

	const assignments: MumbleGroupAssignment[] = []
	const failedUserIds: string[] = []
	for (const result of lookupResults) {
		if (result.status === 'ok') {
			assignments.push({ subjectId: result.userId, groups: result.groups })
		} else {
			failedUserIds.push(result.userId)
		}
	}

	if (failedUserIds.length > 0 && assignments.length === 0) {
		throw new Error(
			`Failed to gather groups for ${failedUserIds.length} user(s): ${failedUserIds.join(', ')}`
		)
	}

	const syncResult = await getMumbleStub(env).syncUserGroups(
		env.MUMBLE_SERVER_ID,
		assignments,
		reason
	)

	if (failedUserIds.length > 0) {
		throw new Error(
			`Failed to gather groups for ${failedUserIds.length} user(s): ${failedUserIds.join(', ')}`
		)
	}

	return syncResult
}

/**
 * Revoke a blacklisted user's Mumble access.
 *
 * This intentionally strips all groups and rotates the password, but it never
 * reveals the new password. Existing sessions should already be invalidated by
 * the blacklist flow; the password reset prevents reuse if credentials were
 * previously known.
 */
export async function enforceBlacklistedMumbleAccess(
	env: Env,
	userId: string,
	reason = 'user-blacklisted'
): Promise<void> {
	const account = await getMumbleAccount(env, userId).catch((error) => {
		logger.error('[Mumble] Failed to read account during blacklist enforcement', {
			userId,
			reason,
			error: error instanceof Error ? error.message : String(error),
		})
		return null
	})
	if (!account) {
		return
	}

	await syncUsersMumbleGroups(env, [userId], reason, {
		forceEmptyGroups: true,
	}).catch((error) => {
		logger.error('[Mumble] Failed to strip groups for blacklisted user', {
			userId,
			reason,
			error: error instanceof Error ? error.message : String(error),
		})
	})

	await resetMumblePassword(env, userId).catch((error) => {
		logger.error('[Mumble] Failed to rotate password for blacklisted user', {
			userId,
			reason,
			error: error instanceof Error ? error.message : String(error),
		})
	})

	logger.info('[Mumble] Enforced blacklisted access', {
		userId,
		reason,
	})
}

/**
 * Push refreshed display metadata for the given users to murmur-control.
 * The current login name, enabled state, password, and groups are preserved.
 */
export async function syncUsersMumbleProfiles(
	env: Env,
	userIds: string[]
): Promise<MumbleSyncProfilesResult> {
	if (userIds.length === 0) {
		return { synced: [], skipped: [] }
	}

	const lookupResults = await runWithConcurrencyLimit(
		userIds,
		USER_PROFILE_LOOKUP_CONCURRENCY,
		async (userId) => {
			try {
				const identity = await buildMumbleIdentity(env, userId)
				return {
					status: 'ok' as const,
					userId,
					displayName: identity.displayName,
				}
			} catch (error) {
				logger.error('[Mumble] Failed to gather profile metadata for user', {
					userId,
					error: error instanceof Error ? error.message : String(error),
				})
				return { status: 'failed' as const, userId }
			}
		}
	)

	const assignments: MumbleProfileAssignment[] = []
	const failedUserIds: string[] = []
	for (const result of lookupResults) {
		if (result.status === 'ok') {
			assignments.push({ subjectId: result.userId, displayName: result.displayName })
		} else {
			failedUserIds.push(result.userId)
		}
	}

	if (failedUserIds.length > 0 && assignments.length === 0) {
		throw new Error(
			`Failed to gather profile metadata for ${failedUserIds.length} user(s): ${failedUserIds.join(', ')}`
		)
	}

	const syncResult = await getMumbleStub(env).syncAccountProfiles(env.MUMBLE_SERVER_ID, assignments)

	if (failedUserIds.length > 0) {
		throw new Error(
			`Failed to gather profile metadata for ${failedUserIds.length} user(s): ${failedUserIds.join(', ')}`
		)
	}

	return syncResult
}

/**
 * Best-effort deletion of Mumble accounts (used from user-deletion paths).
 * Never throws — deletion of the auth-next user must not be blocked. On
 * murmur-control failure the mumble DO queues the deletion and retries by
 * alarm until confirmed, so a `queued` outcome is still eventually deleted.
 */
export async function deleteMumbleAccounts(
	env: Env,
	userIds: string[]
): Promise<MumbleDeleteResult | null> {
	try {
		const result = await getMumbleStub(env).deleteAccounts(env.MUMBLE_SERVER_ID, userIds)
		if (result.queued.length > 0) {
			logger.warn('[Mumble] Account deletion queued for retry', {
				queued: result.queued,
			})
		}
		logger.info('[Mumble] Deleted accounts', {
			deleted: result.deleted,
			notFound: result.notFound,
			queued: result.queued,
		})
		return result
	} catch (error) {
		// Unexpected: deleteAccounts queues control-plane failures internally.
		// Only RPC transport failures (mumble worker unreachable) land here.
		logger.error('[Mumble] Failed to delete accounts', {
			userIds,
			error: error instanceof Error ? error.message : String(error),
		})
		return null
	}
}
