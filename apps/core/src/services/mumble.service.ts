import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { parseMumbleError } from '@repo/mumble'

import { createDb } from '../db'
import { getCachedUserRoles } from '../lib/groups-cache'
import { isMumbleFeatureEnabled } from '../lib/mumble-feature'
import {
	managedCorporations,
	mumbleTempopGuests,
	mumbleTempops,
	userCharacters,
	users,
} from '../db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
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
const MAX_MUMBLE_TICKER_LENGTH = 5
const SITE_ADMIN_MUMBLE_TICKER = 'SA'
/**
 * Mumble ACL group synthesized for users holding the alliance-member role
 * (ROLE_CORE_ALLIANCE_MEMBER). Must exist on the Murmur server with channel
 * ACLs referencing it; auth-next only assigns the name.
 */
const ALLIANCE_MEMBER_MUMBLE_GROUP = 'Test Alliance'
/**
 * Mumble ACL group that temp-op guests are assigned to. Must exist on the
 * Murmur server with channel ACLs referencing it; auth-next only assigns the
 * group name. Snapshotted onto each temp-op row at creation.
 */
export const TEMPOP_GROUP_NAME = 'TempOp'
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

function normalizeMumbleTicker(ticker?: string | null): string | null {
	const normalized = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
	if (!normalized) {
		return null
	}

	return normalized.slice(0, MAX_MUMBLE_TICKER_LENGTH)
}

function appendMumbleDisplaySuffixes(baseName: string, suffixes: string[]): string {
	if (suffixes.length === 0) {
		return baseName
	}

	return `${baseName} ${suffixes.map((suffix) => `[${suffix}]`).join(' ')}`
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
			is_admin: true,
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

	const corporationId = mainCharacter.corporationId
	const [corpTicker, groupTickers] = await Promise.all([
		corporationId
			? (async () => {
					const corpStub = getStub<EveCorporationData>(
						env.EVE_CORPORATION_DATA,
						corporationId
					)
					const corpInfo = await corpStub.getCorporationInfo(corporationId)
					return normalizeMumbleTicker(corpInfo?.ticker)
				})()
			: Promise.resolve(null),
		(async () => {
			const memberships = await getStub<Groups>(env.GROUPS, 'default').getUserMemberships(userId)
			return memberships
				.filter((membership) => membership.mumbleSyncEnabled)
				.map((membership) => normalizeMumbleTicker(membership.mumbleTicker))
				.filter((ticker): ticker is string => ticker !== null)
				.sort((left, right) => left.localeCompare(right))
		})(),
	])

	const suffixes: string[] = []
	if (corpTicker) {
		suffixes.push(corpTicker)
	}
	for (const ticker of groupTickers) {
		if (!suffixes.includes(ticker)) {
			suffixes.push(ticker)
		}
	}
	if (corporationId) {
		if (user.is_admin && !suffixes.includes(SITE_ADMIN_MUMBLE_TICKER)) {
			suffixes.push(SITE_ADMIN_MUMBLE_TICKER)
		}
	} else if (user.is_admin && !suffixes.includes(SITE_ADMIN_MUMBLE_TICKER)) {
		suffixes.push(SITE_ADMIN_MUMBLE_TICKER)
	}

	return {
		characterName: mainCharacter.characterName,
		displayName: appendMumbleDisplaySuffixes(mainCharacter.characterName, suffixes),
		loginName: deriveLoginName(mainCharacter.characterName, userId),
	}
}

async function isUserBlacklisted(env: Env, userId: string): Promise<boolean> {
	const hrStub = getStub<Hr>(env.HR, 'default')
	return hrStub.isUserBlacklisted(userId)
}

async function hasMemberCorporationAttachment(env: Env, userId: string): Promise<boolean> {
	const db = createDb(env.DATABASE_URL)
	const [characters, memberCorporations] = await Promise.all([
		db.query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
			columns: {
				corporationId: true,
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
		(character) => !!character.corporationId && memberCorporationIds.has(character.corporationId)
	)
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

	const db = createDb(env.DATABASE_URL)
	const [user, hasAttachment, roleAttachments] = await Promise.all([
		db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: {
				is_admin: true,
			},
		}),
		hasMemberCorporationAttachment(env, userId),
		getCachedUserRoles(env, userId),
	])
	const isAllianceMember = roleAttachments.some(
		(attachment) => attachment.role.name === ROLE_CORE_ALLIANCE_MEMBER
	)

	if (!hasAttachment && !user?.is_admin) {
		return []
	}

	const memberships = hasAttachment
		? await getStub<Groups>(env.GROUPS, 'default').getUserMemberships(userId)
		: []

	const groups = memberships
		.filter((membership) => membership.mumbleSyncEnabled)
		.map((membership) => membership.groupName)

	if (isAllianceMember) {
		groups.push(ALLIANCE_MEMBER_MUMBLE_GROUP)
	}
	if (user?.is_admin) {
		groups.push('Server Admin')
	}

	return [...new Set(groups)]
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
	if (!(await isMumbleFeatureEnabled(env))) {
		logger.info('[Mumble] Skipped blacklist enforcement because feature is disabled', {
			userId,
			reason,
		})
		return
	}

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

	if (!(await isMumbleFeatureEnabled(env))) {
		logger.info('[Mumble] Skipped profile sync because feature is disabled', {
			userIds,
		})
		return { synced: [], skipped: userIds }
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
		if (!(await isMumbleFeatureEnabled(env))) {
			logger.info('[Mumble] Skipped account deletion because feature is disabled', {
				userIds,
			})
			return { deleted: [], notFound: [], queued: [] }
		}

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

interface TempopGuestCredentials {
	loginName: string
	password: string
	connection: { host: string; port: number }
}

/**
 * Provision (or re-issue) an ephemeral Mumble account for a temp-op guest.
 *
 * The guest is identified only by an EVE character id obtained from a minimal
 * publicData SSO. Their account is scoped under the temp-op via a synthetic
 * `subjectId` (`tempop:<tempopId>:<characterId>`) and assigned the temp-op's
 * group. Re-opening the link for the same character rotates the password rather
 * than failing. Affiliation is captured on the guest row for display only and
 * never written to core user/character tables.
 */
/**
 * Re-validate that a temp-op is still active after provisioning work. If it was
 * closed (deleted or expired) concurrently — e.g. an SSO callback that lands
 * after the temp-op was finalized — disconnect and remove the just-issued guest
 * so a late callback cannot leave an active guest attached to a dead temp-op,
 * then throw so the caller surfaces an error instead of returning credentials.
 */
async function rollbackIfTempopClosed(
	env: Env,
	db: ReturnType<typeof createDb>,
	tempopId: string,
	subjectId: string
): Promise<void> {
	const current = await db.query.mumbleTempops.findFirst({
		where: eq(mumbleTempops.id, tempopId),
		columns: { status: true, expiresAt: true },
	})
	if (current && current.status === 'active' && current.expiresAt.getTime() > Date.now()) {
		return
	}

	await getMumbleStub(env)
		.deleteAccounts(env.MUMBLE_SERVER_ID, [subjectId])
		.catch((error) => {
			logger.error('[Mumble] Failed to roll back orphaned temp-op guest', {
				tempopId,
				subjectId,
				error: error instanceof Error ? error.message : String(error),
			})
		})
	await db
		.update(mumbleTempopGuests)
		.set({ status: 'deleted' })
		.where(eq(mumbleTempopGuests.subjectId, subjectId))

	throw new Error(`Temp-op ${tempopId} closed during provisioning`)
}

export async function provisionTempopGuest(
	env: Env,
	params: { tempopId: string; characterId: string }
): Promise<TempopGuestCredentials> {
	const { tempopId, characterId } = params
	const db = createDb(env.DATABASE_URL)

	const tempop = await db.query.mumbleTempops.findFirst({
		where: eq(mumbleTempops.id, tempopId),
		columns: { id: true, shortCode: true, groupName: true, status: true, expiresAt: true },
	})
	if (!tempop) {
		throw new Error(`Temp-op ${tempopId} not found`)
	}
	if (tempop.status !== 'active' || tempop.expiresAt.getTime() <= Date.now()) {
		throw new Error(`Temp-op ${tempopId} is not active`)
	}

	const subjectId = `tempop:${tempopId}:${characterId}`
	const connection = getMumbleConnectionInfo(env)
	const mumbleStub = getMumbleStub(env)

	// Re-open: an existing guest row means the account was already provisioned —
	// rotate the password and return the stored login name.
	const existingGuest = await db.query.mumbleTempopGuests.findFirst({
		where: and(
			eq(mumbleTempopGuests.tempopId, tempopId),
			eq(mumbleTempopGuests.characterId, characterId)
		),
	})
	if (existingGuest && existingGuest.status === 'active') {
		try {
			const { password } = await mumbleStub.resetPassword(env.MUMBLE_SERVER_ID, subjectId)
			await rollbackIfTempopClosed(env, db, tempopId, subjectId)
			return { loginName: existingGuest.loginName, password, connection }
		} catch (error) {
			// Account vanished on the control plane — fall through and re-provision.
			if (parseMumbleError(error)?.code !== 'not_found') {
				throw error
			}
		}
	}

	// Fetch identity + affiliation (no persistence to core tables).
	const characterStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
	const publicData = await characterStub.refreshPublicCharacterData(characterId, true)
	const characterName = publicData.characterName ?? `Pilot ${characterId}`
	const corporationId = publicData.currentCorporationId ?? null
	const allianceId = publicData.currentAllianceId ?? null

	let corpTicker: string | null = null
	if (corporationId) {
		try {
			const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
			const corpInfo = await corpStub.getCorporationInfo(corporationId)
			corpTicker = normalizeMumbleTicker(corpInfo?.ticker)
		} catch (error) {
			logger.warn('[Mumble] Failed to resolve temp-op guest corp ticker', {
				characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const loginName = deriveLoginName(characterName, characterId)
	const displayName = `[T] ${characterName} [${tempop.shortCode}]`

	let password: string
	let resolvedLoginName = loginName
	try {
		const result = await mumbleStub.provisionAccount(env.MUMBLE_SERVER_ID, {
			subjectId,
			loginName,
			displayName,
			groups: [tempop.groupName],
			comment: `tempop ${tempopId}`,
		})
		password = result.password
		resolvedLoginName = result.account.loginName
	} catch (error) {
		// A stale account exists without an active guest row — rotate instead.
		if (parseMumbleError(error)?.code === 'already_exists') {
			const reset = await mumbleStub.resetPassword(env.MUMBLE_SERVER_ID, subjectId)
			password = reset.password
		} else {
			throw error
		}
	}

	// Upsert the guest row (idempotent on (tempopId, characterId)).
	await db
		.insert(mumbleTempopGuests)
		.values({
			tempopId,
			characterId,
			characterName,
			corporationId,
			allianceId,
			corpTicker,
			subjectId,
			loginName: resolvedLoginName,
			status: 'active',
		})
		.onConflictDoUpdate({
			target: [mumbleTempopGuests.tempopId, mumbleTempopGuests.characterId],
			set: {
				characterName,
				corporationId,
				allianceId,
				corpTicker,
				subjectId,
				loginName: resolvedLoginName,
				status: 'active',
			},
		})

	// Close the TOCTOU window: if the temp-op was deleted/expired while we were
	// fetching ESI data and talking to murmur-control, undo this guest now.
	await rollbackIfTempopClosed(env, db, tempopId, subjectId)

	logger.info('[Mumble] Provisioned temp-op guest', {
		tempopId,
		characterId,
		loginName: resolvedLoginName,
	})

	return { loginName: resolvedLoginName, password, connection }
}
