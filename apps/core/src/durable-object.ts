import { DurableObject } from 'cloudflare:workers'

import { CORE_ROLES, SERVICE_CORE } from '@repo/core'
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { getPublicEsiInstance } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import {
	discordServers,
	managedCorporations,
	userCharacters,
	userIpAddresses,
	users,
} from './db/schema'
import {
	buildImmunitasAccessAlertMessage,
	IMMUNITAS_ALERT_COOLDOWN_MS,
	IMMUNITAS_ALERT_INITIAL_DELAY_MS,
	IMMUNITAS_ALERT_RETRY_MS,
	IMMUNITAS_ALERT_TTL_MS,
	shouldRetryImmunitasAccessAlertDelivery,
} from './lib/immunitas-alerts'
import { recordUserIpAddress } from './lib/ip-tracking'
import {
	buildTokenInvalidationMessage,
	shouldRetryTokenInvalidationAlertDelivery,
	TOKEN_INVALID_ALERT_COOLDOWN_MS,
	TOKEN_INVALID_ALERT_RETRY_MS,
	TOKEN_INVALID_ALERT_TTL_MS,
} from './lib/token-invalid-alerts'
import { validateAndSyncCharacterTokenValidityBatchTransitions } from './lib/token-validity'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from './lib/workflow-triggers'
import { processExpiredTempops } from './services/mumble-tempop.service'
import { updateCharacterPublicInfo } from './workflows/steps/update-character'

import type { Core } from '@repo/core'
import type { Discord } from '@repo/discord'
import type { CharacterAffiliation, CharacterPublicInfo, EsiTypeResolver } from '@repo/esi'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { CreateRoleRequest, Groups } from '@repo/groups'
import type { BlacklistTargetCheckItem, BlacklistTargetType, Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { Env } from './context'

type PendingDiscordRefresh = {
	expiresAt: number
	processed: boolean
	source: string
	allowRemoval: boolean
	hardStripAllRoles: boolean
}

type PendingUserRefresh = {
	expiresAt: number
	processed: boolean
	source: string
}

export class CoreDO extends DurableObject<Env> implements Core {
	private readonly logger = logger.withTags({ service: 'core-durable-object' })
	private static readonly encoder = new TextEncoder()
	private static cachedIpHashSecret: string | null = null
	private static cachedIpHashKey: CryptoKey | null = null

	/**
	 * Discord work is only queued after its prerequisite state is already
	 * persisted. User refresh requests use a separate queue below.
	 *
	 * - Entries are added with processed=false and a 15-minute TTL.
	 * - The TTL acts as a deduplication window: re-adding a userId before it
	 *   expires is a no-op, whether or not it has already been processed.
	 * - The cron picks up processed=false entries, marks them processed=true,
	 *   then triggers workflows. Subsequent cron runs skip already-processed entries.
	 * - Expired entries are pruned on each cron run.
	 * - State is persisted to DO storage so it survives evictions and redeploys.
	 *   The in-memory map is the working copy; storage is the source of truth on cold start.
	 */
	private pendingDiscordRefreshes = new Map<string, PendingDiscordRefresh>()
	private pendingUserRefreshes = new Map<string, PendingUserRefresh>()
	private static readonly PENDING_TTL_MS = 15 * 60 * 1000 // 15 minutes
	private static readonly STORAGE_PREFIX = 'pending-discord:'
	private static readonly USER_REFRESH_STORAGE_PREFIX = 'pending-user-refresh:'
	private pendingTokenInvalidationAlerts = new Map<
		string,
		{
			expiresAt: number
			pendingCharacterIds: string[]
			lastNotifiedAt: number | null
			nextEligibleAt: number
			attemptCount: number
			lastError?: string
			source?: string
		}
	>()
	private static readonly TOKEN_ALERT_STORAGE_PREFIX = 'pending-token-invalid:'
	private pendingImmunitasAccessAlerts = new Map<
		string,
		{
			expiresAt: number
			pendingTargetCharacterLabels: string[]
			pendingRequestorGroups: Array<{
				requestorUserId: string
				requestorLabels: string[]
				attemptCount: number
			}>
			lastNotifiedAt: number | null
			nextEligibleAt: number
			attemptCount: number
			lastError?: string
			source?: string
			accessType: 'profile-data' | 'fulcrum-report'
			targetUserId: string
		}
	>()
	private static readonly IMMUNITAS_ALERT_STORAGE_PREFIX = 'pending-immunitas:'

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		void this.state.blockConcurrencyWhile(async () => {
			await Promise.all([
				this.ensureRolesExist(),
				this.loadPendingDiscordRefreshes(),
				this.loadPendingUserRefreshes(),
				this.loadPendingImmunitasAccessAlerts(),
				this.loadPendingTokenInvalidationAlerts(),
			])
			await this.scheduleImmunitasAccessAlertAlarm()
		})
	}

	private async loadPendingDiscordRefreshes(): Promise<void> {
		const stored = await this.state.storage.list<PendingDiscordRefresh>({
			prefix: CoreDO.STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const userId = key.slice(CoreDO.STORAGE_PREFIX.length)
			this.pendingDiscordRefreshes.set(userId, {
				expiresAt: value.expiresAt,
				processed: value.processed,
				source: value.source ?? 'unknown',
				allowRemoval: value.allowRemoval ?? true,
				hardStripAllRoles: value.hardStripAllRoles ?? false,
			})
		}
		this.logger.info('[CoreDO] Loaded pending Discord refreshes from storage', {
			count: this.pendingDiscordRefreshes.size,
		})
	}

	private async loadPendingUserRefreshes(): Promise<void> {
		const stored = await this.state.storage.list<PendingUserRefresh>({
			prefix: CoreDO.USER_REFRESH_STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const userId = key.slice(CoreDO.USER_REFRESH_STORAGE_PREFIX.length)
			this.pendingUserRefreshes.set(userId, {
				expiresAt: value.expiresAt,
				processed: value.processed,
				source: value.source ?? 'character-affiliation-changed',
			})
		}
		this.logger.info('[CoreDO] Loaded pending user refreshes from storage', {
			count: this.pendingUserRefreshes.size,
		})
	}

	private async loadPendingTokenInvalidationAlerts(): Promise<void> {
		const stored = await this.state.storage.list<{
			expiresAt: number
			pendingCharacterIds: string[]
			lastNotifiedAt: number | null
			nextEligibleAt: number
			attemptCount: number
			lastError?: string
			source?: string
		}>({
			prefix: CoreDO.TOKEN_ALERT_STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const userId = key.slice(CoreDO.TOKEN_ALERT_STORAGE_PREFIX.length)
			this.pendingTokenInvalidationAlerts.set(userId, {
				expiresAt: value.expiresAt,
				pendingCharacterIds: value.pendingCharacterIds ?? [],
				lastNotifiedAt: value.lastNotifiedAt ?? null,
				nextEligibleAt: value.nextEligibleAt ?? 0,
				attemptCount: value.attemptCount ?? 0,
				lastError: value.lastError,
				source: value.source,
			})
		}
		this.logger.info('[CoreDO] Loaded pending token invalidation alerts from storage', {
			count: this.pendingTokenInvalidationAlerts.size,
		})
	}

	private async loadPendingImmunitasAccessAlerts(): Promise<void> {
		const stored = await this.state.storage.list<{
			expiresAt: number
			pendingTargetCharacterLabels: string[]
			pendingRequestorGroups?: Array<{
				requestorUserId: string
				requestorLabels: string[]
				attemptCount: number
			}>
			pendingRequestorLabels?: string[]
			lastNotifiedAt: number | null
			nextEligibleAt: number
			attemptCount: number
			lastError?: string
			source?: string
			accessType: 'profile-data' | 'fulcrum-report'
			targetUserId: string
		}>({
			prefix: CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const pendingRequestorGroups =
				value.pendingRequestorGroups ??
				(value.pendingRequestorLabels?.length
					? [
							{
								requestorUserId: 'legacy',
								requestorLabels: value.pendingRequestorLabels ?? [],
								attemptCount: value.attemptCount ?? 0,
							},
						]
					: [])
			const queueKey = key.slice(CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX.length)
			this.pendingImmunitasAccessAlerts.set(queueKey, {
				expiresAt: value.expiresAt,
				pendingTargetCharacterLabels: value.pendingTargetCharacterLabels ?? [],
				pendingRequestorGroups,
				lastNotifiedAt: value.lastNotifiedAt ?? null,
				nextEligibleAt: value.nextEligibleAt ?? 0,
				attemptCount: value.attemptCount ?? 0,
				lastError: value.lastError,
				source: value.source,
				accessType: value.accessType,
				targetUserId: value.targetUserId,
			})
		}
		this.logger.info('[CoreDO] Loaded pending immunitas access alerts from storage', {
			count: this.pendingImmunitasAccessAlerts.size,
		})
	}

	private getDb(): ReturnType<typeof createDb> {
		return createDb(this.env.DATABASE_URL)
	}

	private static bufferToHex(buffer: ArrayBuffer): string {
		return Array.from(new Uint8Array(buffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	}

	private async hashIpAddress(secret: string, value: string): Promise<string> {
		if (CoreDO.cachedIpHashSecret !== secret || !CoreDO.cachedIpHashKey) {
			CoreDO.cachedIpHashKey = await crypto.subtle.importKey(
				'raw',
				CoreDO.encoder.encode(secret),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['sign']
			)
			CoreDO.cachedIpHashSecret = secret
		}

		const signature = await crypto.subtle.sign(
			'HMAC',
			CoreDO.cachedIpHashKey,
			CoreDO.encoder.encode(value)
		)
		return CoreDO.bufferToHex(signature)
	}

	private async ensureRolesExist(): Promise<void> {
		const roles = CORE_ROLES.map((role) => ({
			name: role,
			ownedBy: SERVICE_CORE,
			description: `${role} role for the HR system`,
		})) as CreateRoleRequest[]

		const groupsStub = getStub<Groups>(this.env.GROUPS, 'default')
		const maxAttempts = 5
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await groupsStub.batchCreateRoles({ roles })
				this.logger.info('Groups roles created.', { roles, attempt })
				return
			} catch (error) {
				this.logger.error('Failed to seed core roles.', {
					attempt,
					maxAttempts,
					error: error instanceof Error ? error.message : String(error),
				})
				if (attempt === maxAttempts) {
					throw error
				}
				const backoffMs = Math.min(250 * 2 ** (attempt - 1), 2000)
				await new Promise((resolve) => setTimeout(resolve, backoffMs))
			}
		}
	}

	private async getCharacterInfo(characterId: string): Promise<CharacterPublicInfo | null> {
		const instance = getPublicEsiInstance(this.env.ESI)
		const [publicInfoResult, affiliationResult] = await Promise.allSettled([
			instance.fetchCharacterPublicInfo(characterId),
			instance.fetchCharacterAffiliation(characterId, [characterId]),
		])

		if (publicInfoResult.status === 'rejected') {
			throw publicInfoResult.reason
		}

		const publicInfo = publicInfoResult.value
		const affiliation =
			affiliationResult.status === 'fulfilled'
				? affiliationResult.value.find(
						(entry: CharacterAffiliation) => String(entry.character_id) === characterId
					)
				: null

		if (!affiliation) {
			return publicInfo
		}

		return {
			...publicInfo,
			corporation_id: affiliation.corporation_id ?? publicInfo.corporation_id,
			alliance_id: affiliation.alliance_id ?? publicInfo.alliance_id,
		}
	}

	private async getCorporationName(corporationId: string): Promise<string | null> {
		const instance = getPublicEsiInstance(this.env.ESI)
		const corporationInfo = await instance.fetchCorporationPublicInfo(corporationId)
		return corporationInfo?.name ?? null
	}

	private async getAllianceName(allianceId: string): Promise<string | null> {
		const instance = getPublicEsiInstance(this.env.ESI)
		const allianceInfo = await instance.fetchAlliancePublicInfo(allianceId)
		return allianceInfo?.name ?? null
	}

	private async getCharacterAllianceInfo(
		characterId: string
	): Promise<{ allianceId: string; allianceName: string } | null> {
		const characterInfo = await this.getCharacterInfo(characterId)
		if (!characterInfo?.alliance_id) {
			return null
		}

		const allianceName = await this.getAllianceName(characterInfo.alliance_id)
		if (!allianceName) {
			return null
		}

		return {
			allianceId: String(characterInfo.alliance_id),
			allianceName,
		}
	}

	async getCharacterOwner(
		characterId: string
	): Promise<{ userId: string; isPrimary: boolean } | null> {
		const character = await this.getDb().query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})
		if (!character) {
			return null
		}

		return { userId: character.userId, isPrimary: character.is_primary }
	}

	async getUserCharacterIds(userId: string): Promise<string[]> {
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
			columns: {
				characterId: true,
			},
		})

		return characters.map((character) => character.characterId)
	}

	async isMemberCorporation(corporationId: string): Promise<boolean> {
		return this.getDb()
			.query.managedCorporations.findFirst({
				where: and(
					eq(managedCorporations.corporationId, corporationId),
					eq(managedCorporations.isActive, true),
					eq(managedCorporations.isMemberCorporation, true)
				),
				columns: { corporationId: true },
			})
			.then((corporation) => corporation !== undefined)
	}

	async getMemberCorporationIds(corporationIds: string[]): Promise<string[]> {
		if (corporationIds.length === 0) {
			return []
		}

		const corporations = await this.getDb()
			.select({ corporationId: managedCorporations.corporationId })
			.from(managedCorporations)
			.where(
				and(
					inArray(managedCorporations.corporationId, corporationIds),
					eq(managedCorporations.isActive, true),
					eq(managedCorporations.isMemberCorporation, true)
				)
			)

		return corporations.map((corporation) => corporation.corporationId)
	}

	async isUserAllianceMember(userId: string): Promise<boolean> {
		const [match] = await this.getDb()
			.select({ characterId: userCharacters.characterId })
			.from(userCharacters)
			.innerJoin(
				managedCorporations,
				eq(managedCorporations.corporationId, userCharacters.corporationId)
			)
			.where(
				and(
					eq(userCharacters.userId, userId),
					eq(userCharacters.isDeleted, false),
					eq(managedCorporations.isActive, true),
					eq(managedCorporations.isMemberCorporation, true)
				)
			)
			.limit(1)

		return match !== undefined
	}

	async listUsersWithActiveCharactersPage(input: { limit: number; offset: number }): Promise<{
		users: Array<{ userId: string; characterIds: string[] }>
		totalCount: number
	}> {
		const limit = Math.max(1, Math.min(500, Math.floor(input.limit)))
		const offset = Math.max(0, Math.floor(input.offset))
		const db = this.getDb()

		const countRows = await db
			.select({ count: sql<number>`count(distinct ${userCharacters.userId})::int` })
			.from(userCharacters)
			.where(eq(userCharacters.isDeleted, false))
		const totalCount = countRows[0]?.count ?? 0
		if (totalCount === 0) {
			return { users: [], totalCount }
		}

		const paginatedUserRows = await db
			.select({
				userId: userCharacters.userId,
			})
			.from(userCharacters)
			.where(eq(userCharacters.isDeleted, false))
			.groupBy(userCharacters.userId)
			.orderBy(asc(userCharacters.userId))
			.limit(limit)
			.offset(offset)

		const userIds = paginatedUserRows.map((row) => row.userId)
		if (userIds.length === 0) {
			return { users: [], totalCount }
		}

		const pageCharacters = await db.query.userCharacters.findMany({
			where: and(inArray(userCharacters.userId, userIds), eq(userCharacters.isDeleted, false)),
			columns: {
				userId: true,
				characterId: true,
			},
			orderBy: (table, operators) => [
				operators.asc(table.userId),
				operators.asc(table.characterId),
			],
		})

		const characterIdsByUserId = new Map<string, string[]>()
		for (const row of pageCharacters) {
			const bucket = characterIdsByUserId.get(row.userId) ?? []
			bucket.push(row.characterId)
			characterIdsByUserId.set(row.userId, bucket)
		}

		return {
			users: userIds.map((userId) => ({
				userId,
				characterIds: [...new Set(characterIdsByUserId.get(userId) ?? [])],
			})),
			totalCount,
		}
	}

	async getUsersNeedingCharacterDataSync(): Promise<{
		userBatches: Array<{ userId: string; characterIds: string[] }>
		unownedCharacterIds: string[]
	}> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const dueCharacterIds = await tokenStore.getCharactersNeedingDataSync()

		if (dueCharacterIds.length === 0) {
			return { userBatches: [], unownedCharacterIds: [] }
		}

		const dueCharacterOwners = await this.getDb().query.userCharacters.findMany({
			where: inArray(userCharacters.characterId, dueCharacterIds),
			columns: {
				userId: true,
				characterId: true,
			},
		})

		const dueCharacterIndex = new Map(
			dueCharacterIds.map((characterId, index) => [characterId, index])
		)
		const userOrder = new Map<string, number>()
		const dueUserIds = new Set<string>()

		for (const row of dueCharacterOwners) {
			dueUserIds.add(row.userId)
			const existingOrder = userOrder.get(row.userId)
			const dueIndex = dueCharacterIndex.get(row.characterId) ?? Number.MAX_SAFE_INTEGER
			if (existingOrder === undefined || dueIndex < existingOrder) {
				userOrder.set(row.userId, dueIndex)
			}
		}

		const ownedCharacterIdSet = new Set(dueCharacterOwners.map((row) => row.characterId))
		const unownedCharacterIds = dueCharacterIds.filter(
			(characterId) => !ownedCharacterIdSet.has(characterId)
		)

		if (dueUserIds.size === 0) {
			return { userBatches: [], unownedCharacterIds }
		}

		const allUserCharacters = await this.getDb().query.userCharacters.findMany({
			where: and(
				inArray(userCharacters.userId, Array.from(dueUserIds)),
				eq(userCharacters.isDeleted, false)
			),
			columns: {
				userId: true,
				characterId: true,
			},
		})

		const characterIdsByUserId = new Map<string, Set<string>>()
		for (const row of allUserCharacters) {
			const bucket = characterIdsByUserId.get(row.userId) ?? new Set<string>()
			bucket.add(row.characterId)
			characterIdsByUserId.set(row.userId, bucket)
		}

		return {
			userBatches: Array.from(dueUserIds)
				.sort((a, b) => (userOrder.get(a) ?? 0) - (userOrder.get(b) ?? 0))
				.map((userId) => ({
					userId,
					characterIds: Array.from(characterIdsByUserId.get(userId) ?? []),
				})),
			unownedCharacterIds,
		}
	}

	async getUserCharacters(
		userId: string,
		includeDeleted: boolean = false
	): Promise<
		Array<{
			characterId: string
			characterName: string
			hasValidToken: boolean
			isDeleted: boolean
			corporationId?: string | null
			corporationName?: string | null
			allianceId?: string | null
			allianceName?: string | null
		}>
	> {
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.isDeleted, includeDeleted), eq(userCharacters.userId, userId)),
		})
		return characters.map((c) => ({
			characterId: c.characterId,
			characterName: c.characterName,
			hasValidToken: c.hasValidToken === true,
			isDeleted: c.isDeleted,
			corporationId: c.corporationId,
			corporationName: c.corporationName,
			allianceId: c.allianceId,
			allianceName: c.allianceName,
		}))
	}

	async syncUserCharacterTokenValidityBatch(input: {
		userId: string
		characterIds: string[]
		forceValidate?: boolean
	}): Promise<
		Array<{
			characterId: string
			previousHasValidToken: boolean | null
			nextHasValidToken: boolean | null
			validationStatus: string | null
			validationError: string | null
			refreshAttempted: boolean
			refreshSucceeded: boolean
		}>
	> {
		const normalizedCharacterIds = [
			...new Set(input.characterIds.map((id) => String(id).trim())),
		].filter(Boolean)
		if (normalizedCharacterIds.length === 0) {
			return []
		}

		const rows = await this.getDb().query.userCharacters.findMany({
			where: and(
				eq(userCharacters.userId, input.userId),
				inArray(userCharacters.characterId, normalizedCharacterIds)
			),
			columns: {
				characterId: true,
				hasValidToken: true,
			},
		})

		const matchedIds = new Set(rows.map((row) => row.characterId))
		const missingCharacterIds = normalizedCharacterIds.filter((id) => !matchedIds.has(id))
		if (missingCharacterIds.length > 0) {
			this.logger.warn('[CoreDO] Some requested characters were not owned by the target user', {
				userId: input.userId,
				requestedCount: normalizedCharacterIds.length,
				matchedCount: rows.length,
				missingCharacterIds,
			})
		}

		if (rows.length === 0) {
			return []
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const transitions = await validateAndSyncCharacterTokenValidityBatchTransitions({
			db: this.getDb(),
			tokenStore,
			characters: rows.map((row) => ({
				characterId: row.characterId,
				hasValidToken: row.hasValidToken ?? null,
			})),
			forceValidate: input.forceValidate === true,
		})

		return transitions.map((transition) => ({
			characterId: transition.characterId,
			previousHasValidToken: transition.previousHasValidToken,
			nextHasValidToken: transition.nextHasValidToken,
			validationStatus: transition.validation?.status ?? null,
			validationError: transition.validationError ?? transition.validation?.error ?? null,
			refreshAttempted: transition.validation?.refreshAttempted ?? false,
			refreshSucceeded: transition.validation?.refreshSucceeded ?? false,
		}))
	}

	async isActiveDiscordGuild(guildId: string): Promise<boolean> {
		const server = await this.getDb().query.discordServers.findFirst({
			where: and(eq(discordServers.guildId, guildId), eq(discordServers.isActive, true)),
			columns: { id: true },
		})

		return server !== null
	}

	async getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.getDb().query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const characterInfos = (
			await Promise.all(
				characters.map(async (c) => {
					try {
						const characterInfo = await this.getCharacterInfo(c.characterId)
						if (!characterInfo) {
							return null
						}
						return {
							characterId: c.characterId,
							corporationId: characterInfo.corporation_id,
						}
					} catch (error) {
						// One bad/expired character token must not break the entire user's
						// auth/session flow. Skipping is safe because this only omits
						// character-derived corporation context; it never grants extra access.
						this.logger.warn('Skipping character during corporation resolution', {
							userId,
							characterId: c.characterId,
							error: error instanceof Error ? error.message : String(error),
						})
						return null
					}
				})
			)
		).filter((c): c is NonNullable<typeof c> => c !== null)

		const corporationIds = [...new Set(characterInfos.map((info) => info.corporationId))]
		const corporationNames = new Map<string, string>()
		await Promise.all(
			corporationIds.map(async (corporationId) => {
				try {
					const corporationName = await this.getCorporationName(corporationId)
					if (corporationName) {
						corporationNames.set(corporationId, corporationName)
					}
				} catch (error) {
					this.logger.warn('Skipping corporation during corporation name resolution', {
						userId,
						corporationId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		return corporationIds.map((corporationId) => ({
			corporationId,
			corporationName: corporationNames.get(corporationId) ?? corporationId,
		}))
	}

	async getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>> {
		const result = new Map<string, Array<{ corporationId: string; corporationName: string }>>()

		if (userIds.length === 0) {
			return result
		}

		// Batch fetch all user characters
		const allCharacters = await this.getDb().query.userCharacters.findMany({
			where: inArray(userCharacters.userId, userIds),
		})

		// Group characters by userId
		const charactersByUser = new Map<string, Array<(typeof allCharacters)[number]>>()
		for (const char of allCharacters) {
			if (!charactersByUser.has(char.userId)) {
				charactersByUser.set(char.userId, [])
			}
			charactersByUser.get(char.userId)!.push(char)
		}

		// Fetch character info for all characters in parallel
		const allCharacterIds = allCharacters.map((c) => c.characterId)
		const characterInfoMap = new Map<string, CharacterPublicInfo>()

		await Promise.all(
			allCharacterIds.map(async (characterId) => {
				try {
					const info = await this.getCharacterInfo(characterId)
					if (info) {
						characterInfoMap.set(characterId, info)
					}
				} catch (error) {
					// Partial-failure behavior: preserve permissions/auth for healthy
					// characters and skip only unresolved entries. This is fail-closed
					// for authorization (missing context can reduce permissions, not expand).
					this.logger.warn('Skipping character during batch corporation resolution', {
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		const corporationIds = [
			...new Set(Array.from(characterInfoMap.values()).map((info) => info.corporation_id)),
		]
		const corporationNames = new Map<string, string>()
		await Promise.all(
			corporationIds.map(async (corporationId) => {
				try {
					const corporationName = await this.getCorporationName(corporationId)
					if (corporationName) {
						corporationNames.set(corporationId, corporationName)
					}
				} catch (error) {
					this.logger.warn('Skipping corporation during batch corporation name resolution', {
						corporationId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		// Build per-user corporation lists from fetched character info.
		for (const userId of userIds) {
			const userCharactersForId = charactersByUser.get(userId) ?? []
			const corporations = userCharactersForId
				.map((char) => {
					const info = characterInfoMap.get(char.characterId)
					if (!info) {
						return null
					}
					return {
						corporationId: String(info.corporation_id),
						corporationName:
							corporationNames.get(String(info.corporation_id)) ?? String(info.corporation_id),
					}
				})
				.filter((corp): corp is NonNullable<typeof corp> => corp !== null)

			// De-duplicate by corporation ID while preserving first-seen order.
			const seen = new Set<string>()
			const uniqueCorporations = corporations.filter((corp) => {
				if (seen.has(corp.corporationId)) {
					return false
				}
				seen.add(corp.corporationId)
				return true
			})

			result.set(userId, uniqueCorporations)
		}

		return result
	}

	async getUserAlliances(
		userId: string
	): Promise<Array<{ allianceId: string; allianceName: string }>> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.getDb().query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const characterAlliances = await Promise.all(
			characters.map(async (character) => {
				try {
					const characterInfo = await this.getCharacterInfo(character.characterId)
					return characterInfo?.alliance_id ? String(characterInfo.alliance_id) : null
				} catch (error) {
					// Same safety rule as corporation resolution: avoid cascading failure
					// from one invalid character token, while never elevating access.
					this.logger.warn('Skipping character during alliance resolution', {
						userId,
						characterId: character.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				}
			})
		)

		const uniqueAllianceIds: string[] = []
		const seenAllianceIds = new Set<string>()
		for (const allianceId of characterAlliances) {
			if (!allianceId || seenAllianceIds.has(allianceId)) {
				continue
			}
			seenAllianceIds.add(allianceId)
			uniqueAllianceIds.push(allianceId)
		}

		const allianceNameById = new Map<string, string>()
		await Promise.all(
			uniqueAllianceIds.map(async (allianceId) => {
				try {
					const allianceName = await this.getAllianceName(allianceId)
					if (allianceName) {
						allianceNameById.set(allianceId, allianceName)
					}
				} catch (error) {
					this.logger.warn('Skipping alliance during alliance resolution', {
						userId,
						allianceId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		return uniqueAllianceIds
			.map((allianceId) => {
				const allianceName = allianceNameById.get(allianceId)
				if (!allianceName) {
					return null
				}
				return {
					allianceId,
					allianceName,
				}
			})
			.filter((a): a is NonNullable<typeof a> => a !== null)
	}

	async getUserDiscordUserId(userId: string): Promise<string | null> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
			columns: { discordUserId: true },
		})
		return user?.discordUserId ?? null
	}

	async updateCorporationAuthHealth(
		corporationId: string,
		input: {
			healthyDirectorCount: number
			isVerified: boolean
			lastVerified?: string | null
		}
	): Promise<void> {
		const lastVerified = input.lastVerified ? new Date(input.lastVerified) : new Date()
		await this.getDb()
			.update(managedCorporations)
			.set({
				healthyDirectorCount: Math.max(0, Math.floor(input.healthyDirectorCount)),
				isVerified: input.isVerified,
				lastVerified,
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))
	}

	async createUserBlacklist(input: {
		userId: string
		reason: string
		blacklistedBy: string
		metadata?: Record<string, unknown>
	}): Promise<{ entryId: string }> {
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, input.userId),
			columns: { discordUserId: true },
		})
		const entry = await hrStub.createUserBlacklist({
			userId: input.userId,
			discordUserId: user?.discordUserId ?? undefined,
			reason: input.reason,
			blacklistedBy: input.blacklistedBy,
			metadata: input.metadata,
		})
		return { entryId: entry.id }
	}

	async createCharacterBlacklist(input: {
		characterId?: string
		characterName?: string
		reason: string
		blacklistedBy: string
		triggeredBy?: string
		metadata?: Record<string, unknown>
	}): Promise<{ entryId: string }> {
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const entry = await hrStub.createCharacterBlacklist({
			characterId: input.characterId,
			characterName: input.characterName,
			reason: input.reason,
			blacklistedBy: input.blacklistedBy,
			triggeredBy: input.triggeredBy,
			metadata: input.metadata,
		})
		return { entryId: entry.id }
	}

	async legacyImportCharacterLinks(input: {
		modernUserId: string
		legacyAuthUserId: string
		characters: Array<{
			characterId: string
			characterName: string
			source?: 'legacy_primary' | 'esi_owner' | 'xml_account'
		}>
	}): Promise<{
		inserted: number
		alreadyLinkedToUser: number
		linkedToOtherUser: number
		totalRequested: number
	}> {
		const db = this.getDb()
		const uniqueCharacters = [
			...new Map(input.characters.map((ch) => [ch.characterId, ch])).values(),
		]
		const existing = await db.query.userCharacters.findMany({
			where: inArray(
				userCharacters.characterId,
				uniqueCharacters.map((ch) => ch.characterId)
			),
			columns: { characterId: true, userId: true },
		})
		const existingByCharacterId = new Map(existing.map((row) => [row.characterId, row]))
		const insertedCharacterIds: string[] = []
		let inserted = 0
		let alreadyLinkedToUser = 0
		let linkedToOtherUser = 0

		for (const character of uniqueCharacters) {
			const existingRow = existingByCharacterId.get(character.characterId)
			if (existingRow) {
				if (existingRow.userId === input.modernUserId) {
					alreadyLinkedToUser += 1
				} else {
					linkedToOtherUser += 1
				}
				continue
			}

			await db.insert(userCharacters).values({
				userId: input.modernUserId,
				characterId: character.characterId,
				characterName: character.characterName,
				characterOwnerHash: `legacy-import:${input.legacyAuthUserId}:${character.source ?? 'unknown'}`,
				is_primary: false,
				hasValidToken: null,
				isDeleted: false,
			})
			insertedCharacterIds.push(character.characterId)
			inserted += 1
		}

		await db
			.update(users)
			.set({
				legacyAuthUserId: input.legacyAuthUserId,
				updatedAt: new Date(),
			})
			.where(eq(users.id, input.modernUserId))

		// Ensure newly imported characters are hydrated with current public/affiliation
		// data immediately so HR/admin views don't show stale "unknown" corp/alliance.
		if (inserted > 0) {
			const hydrateContext = {
				db,
				env: this.env,
				workflowInstanceId: `legacy-import-hydration-${Date.now().toString(36)}`,
				userId: input.modernUserId,
				refreshMode: 'manual' as const,
				suppressDiscordRefresh: true,
			}
			for (const characterId of insertedCharacterIds) {
				try {
					await updateCharacterPublicInfo(hydrateContext, characterId)
				} catch (error) {
					this.logger.warn('[Legacy Import] Failed to pre-hydrate imported character', {
						userId: input.modernUserId,
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			await triggerUserRefreshWorkflow({
				db,
				env: this.env,
				userId: input.modernUserId,
				source: 'legacy-import-character-links',
				bypassThrottle: true,
				refreshMode: 'manual',
				suppressDiscordRefresh: true,
			})
		}

		return {
			inserted,
			alreadyLinkedToUser,
			linkedToOtherUser,
			totalRequested: uniqueCharacters.length,
		}
	}

	async legacyImportNotes(input: {
		modernUserId: string
		legacyAuthUserId: string
		actorUserId: string
		notes: Array<{
			legacyNoteId: string
			note: string
			legacyCreatedByUserId?: string | null
			legacyDateCreated?: string | null
			metadata?: Record<string, unknown>
		}>
	}): Promise<{ created: number; failed: number; totalRequested: number }> {
		const db = this.getDb()
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const isUuid = (value: string) =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
		const actorUserId = isUuid(input.actorUserId) ? input.actorUserId : null
		const importerPrimary = actorUserId
			? await db.query.userCharacters.findFirst({
					where: and(eq(userCharacters.userId, actorUserId), eq(userCharacters.is_primary, true)),
					columns: { characterId: true, characterName: true },
				})
			: null
		const importerUser = actorUserId
			? await db.query.users.findFirst({
					where: eq(users.id, actorUserId),
					columns: { mainCharacterId: true },
				})
			: null
		const importerCharacterId =
			importerPrimary?.characterId ?? importerUser?.mainCharacterId ?? null
		const importerCharacterName = importerPrimary?.characterName ?? 'System'

		const legacyActorIds = [
			...new Set(
				input.notes
					.map((note) => note.legacyCreatedByUserId)
					.filter((value): value is string => Boolean(value))
			),
		]
		const legacyStub = getStub<Legacy>(this.env.LEGACY, 'default')
		const legacyActorCharacterNames =
			legacyActorIds.length > 0
				? await legacyStub.resolveLegacyActorCharacterNames(legacyActorIds)
				: {}
		const modernUsersByLegacyId =
			legacyActorIds.length > 0
				? await db.query.users.findMany({
						where: inArray(users.legacyAuthUserId, legacyActorIds),
						columns: { id: true, legacyAuthUserId: true, mainCharacterId: true },
					})
				: []
		const modernUserByLegacyId = new Map(
			modernUsersByLegacyId
				.filter((row): row is typeof row & { legacyAuthUserId: string } =>
					Boolean(row.legacyAuthUserId)
				)
				.map((row) => [row.legacyAuthUserId, row])
		)
		const modernUserIds = [...new Set(modernUsersByLegacyId.map((row) => row.id))]
		const primaryChars =
			modernUserIds.length > 0
				? await db.query.userCharacters.findMany({
						where: and(
							inArray(userCharacters.userId, modernUserIds),
							eq(userCharacters.is_primary, true)
						),
						columns: { userId: true, characterId: true, characterName: true },
					})
				: []
		const primaryCharByUserId = new Map(primaryChars.map((row) => [row.userId, row]))

		let created = 0
		let failed = 0
		for (const note of input.notes) {
			const attributedModernUser = note.legacyCreatedByUserId
				? modernUserByLegacyId.get(note.legacyCreatedByUserId)
				: undefined
			const attributedPrimary = attributedModernUser
				? (primaryCharByUserId.get(attributedModernUser.id) ?? null)
				: null
			const authorUserId = attributedModernUser?.id ?? actorUserId ?? input.modernUserId
			const authorCharacterId =
				attributedPrimary?.characterId ??
				attributedModernUser?.mainCharacterId ??
				importerCharacterId ??
				null
			const legacyAuthorCharacterName = note.legacyCreatedByUserId
				? legacyActorCharacterNames[note.legacyCreatedByUserId]
				: undefined
			const authorCharacterName =
				attributedPrimary?.characterName ?? legacyAuthorCharacterName ?? importerCharacterName

			try {
				await hrStub.createNote(
					input.modernUserId,
					null,
					authorUserId,
					authorCharacterId,
					authorCharacterName,
					note.note,
					'general',
					'normal',
					{
						source: 'legacy_import',
						legacyAuthUserId: input.legacyAuthUserId,
						legacyNoteId: note.legacyNoteId,
						legacyCreatedByUserId: note.legacyCreatedByUserId ?? null,
						legacyDateCreated: note.legacyDateCreated ?? null,
						legacyNoteActorResolution: attributedModernUser
							? 'resolved_modern_user'
							: 'unresolved_importer_fallback',
						legacyNoteActorResolvedUserId: attributedModernUser?.id ?? null,
						...(note.metadata ?? {}),
						visibility: 'hr',
					}
				)
				created += 1
			} catch {
				failed += 1
			}
		}

		return { created, failed, totalRequested: input.notes.length }
	}

	async legacyImportIpAssociations(input: {
		modernUserId: string
		legacyAuthUserId: string
		ipAddresses: Array<{
			ipAddress: string
			firstSeenAt?: string | null
			lastSeenAt?: string | null
		}>
	}): Promise<{ imported: number; failed: number; totalRequested: number }> {
		const db = this.getDb()
		const hashSecret = this.env.IP_ADDRESS_HASH_SECRET
		if (!hashSecret) {
			throw new Error('IP hash secret not configured')
		}

		const aggregatedByIp = new Map<
			string,
			{ ipAddress: string; firstSeenAt: Date | null; lastSeenAt: Date | null }
		>()
		for (const row of input.ipAddresses) {
			const ipAddress = row.ipAddress.trim()
			if (!ipAddress) continue
			const parsedFirstSeenAt =
				row.firstSeenAt && !Number.isNaN(new Date(row.firstSeenAt).getTime())
					? new Date(row.firstSeenAt)
					: null
			const parsedLastSeenAt =
				row.lastSeenAt && !Number.isNaN(new Date(row.lastSeenAt).getTime())
					? new Date(row.lastSeenAt)
					: null
			const existing = aggregatedByIp.get(ipAddress)
			if (!existing) {
				aggregatedByIp.set(ipAddress, {
					ipAddress,
					firstSeenAt: parsedFirstSeenAt,
					lastSeenAt: parsedLastSeenAt,
				})
				continue
			}
			const firstSeenAt =
				existing.firstSeenAt && parsedFirstSeenAt
					? existing.firstSeenAt < parsedFirstSeenAt
						? existing.firstSeenAt
						: parsedFirstSeenAt
					: (existing.firstSeenAt ?? parsedFirstSeenAt)
			const lastSeenAt =
				existing.lastSeenAt && parsedLastSeenAt
					? existing.lastSeenAt > parsedLastSeenAt
						? existing.lastSeenAt
						: parsedLastSeenAt
					: (existing.lastSeenAt ?? parsedLastSeenAt)
			aggregatedByIp.set(ipAddress, { ipAddress, firstSeenAt, lastSeenAt })
		}
		const uniqueIps = [...aggregatedByIp.values()]
		let imported = 0
		let failed = 0
		for (const ip of uniqueIps) {
			try {
				await recordUserIpAddress({
					db,
					userId: input.modernUserId,
					ip: ip.ipAddress,
					hashSecret,
					firstSeenAt: ip.firstSeenAt,
					lastSeenAt: ip.lastSeenAt,
					overwriteObservedWindow: true,
				})
				imported += 1
			} catch {
				failed += 1
			}
		}

		return {
			imported,
			failed,
			totalRequested: uniqueIps.length,
		}
	}

	async getImportedLegacyNoteIdsForUser(
		userId: string,
		legacyNoteIds: string[]
	): Promise<string[]> {
		if (legacyNoteIds.length === 0) return []
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const notes = await hrStub.listNotes({
			subjectUserId: userId,
			limit: Math.max(legacyNoteIds.length * 4, 200),
			offset: 0,
		})
		const targetIds = new Set(legacyNoteIds)
		return notes
			.filter((note) => note.metadata?.source === 'legacy_import')
			.map((note) =>
				typeof note.metadata?.legacyNoteId === 'string' ? note.metadata.legacyNoteId : null
			)
			.filter((legacyNoteId): legacyNoteId is string => legacyNoteId !== null)
			.filter((legacyNoteId) => targetIds.has(legacyNoteId))
	}

	async getLegacyCharacterImportMetadata(characterIds: string[]): Promise<
		Array<{
			characterId: string
			characterName: string | null
			corporationId: string | null
			corporationName: string | null
			allianceId: string | null
			allianceName: string | null
			isDeleted: boolean
		}>
	> {
		const uniqueCharacterIds = [...new Set(characterIds.filter(Boolean))]
		if (uniqueCharacterIds.length === 0) return []

		const db = this.getDb()
		const existingRows = await db.query.userCharacters.findMany({
			where: inArray(userCharacters.characterId, uniqueCharacterIds),
			columns: {
				characterId: true,
				characterName: true,
				corporationId: true,
				corporationName: true,
				allianceId: true,
				allianceName: true,
				isDeleted: true,
			},
		})
		const existingByCharacterId = new Map(existingRows.map((row) => [row.characterId, row]))
		const typeResolver = getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global')

		const resolveIsDeletedError = (error: unknown): boolean => {
			if (!(error instanceof Error)) return false
			const message = error.message.toLowerCase()
			return message.includes('deleted') || message.includes('404') || message.includes('not found')
		}

		const baseRows = await Promise.all(
			uniqueCharacterIds.map(async (characterId) => {
				const existing = existingByCharacterId.get(characterId)
				if (existing?.isDeleted) {
					return {
						characterId,
						characterName: existing.characterName ?? null,
						corporationId: existing.corporationId ?? null,
						corporationName: existing.corporationName ?? null,
						allianceId: existing.allianceId ?? null,
						allianceName: existing.allianceName ?? null,
						isDeleted: true,
					}
				}
				try {
					const publicInfo = await this.getCharacterInfo(characterId)
					const corporationId = publicInfo?.corporation_id
						? String(publicInfo.corporation_id)
						: (existing?.corporationId ?? null)
					const allianceId = publicInfo?.alliance_id
						? String(publicInfo.alliance_id)
						: (existing?.allianceId ?? null)
					return {
						characterId,
						characterName: publicInfo?.name ?? existing?.characterName ?? null,
						corporationId,
						corporationName: existing?.corporationName ?? null,
						allianceId,
						allianceName: existing?.allianceName ?? null,
						isDeleted: corporationId === '1000001' ? true : false,
					}
				} catch (error) {
					return {
						characterId,
						characterName: existing?.characterName ?? null,
						corporationId: existing?.corporationId ?? null,
						corporationName: existing?.corporationName ?? null,
						allianceId: existing?.allianceId ?? null,
						allianceName: existing?.allianceName ?? null,
						isDeleted: resolveIsDeletedError(error),
					}
				}
			})
		)

		const idsToResolve = [
			...new Set(
				baseRows
					.flatMap((row) => [row.corporationId, row.allianceId])
					.filter((value): value is string => Boolean(value))
			),
		]
		const resolvedNames = idsToResolve.length > 0 ? await typeResolver.resolveIds(idsToResolve) : {}

		return baseRows.map((row) => ({
			...row,
			corporationName: row.corporationId
				? (resolvedNames[row.corporationId] ?? row.corporationName)
				: null,
			allianceName: row.allianceId ? (resolvedNames[row.allianceId] ?? row.allianceName) : null,
			isDeleted:
				row.isDeleted ||
				row.corporationId === '1000001' ||
				(row.corporationName?.toLowerCase() ?? '') === 'doomheim',
		}))
	}

	async evaluateLegacyMigrationBlacklistSignals(input: {
		modernUserId: string
		characterPairs: Array<{ characterId: string; characterName: string }>
		discordUserIds: string[]
		ipAddresses: string[]
		sourceHints?: Array<{
			targetType: BlacklistTargetType
			targetValue: string
			source: 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'
		}>
	}): Promise<{
		hasAnyBlacklistSignal: boolean
		modernUserBlacklisted: boolean
		matchedTargets: Array<{
			targetType: BlacklistTargetType
			targetValue: string
			reason: string | null
			createdAt: Date | null
			blacklistedBy: string | null
			entryMode: 'manual' | 'automatic' | null
			discoverySources: Array<
				'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'
			>
			preferredSource: 'legacy' | 'tang'
		}>
		matchingCharactersBlacklisted: Array<{
			characterId: string
			characterName: string
			matchedBy: Array<'character_id' | 'character_name'>
			reason: string | null
			createdAt: Date | null
			blacklistedBy: string | null
			entryMode: 'manual' | 'automatic' | null
			discoverySources: Array<
				'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'
			>
			preferredSource: 'legacy' | 'tang'
		}>
		matchingDiscordUserIdsBlacklisted: string[]
		ipAssociatedBlacklistedUsers: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			matchingIpHashes: string[]
			userBlacklisted: boolean
			discordBlacklisted: boolean
			matchedItems: Array<{ targetType: BlacklistTargetType; targetValue: string }>
			matchingBlacklistedCharacters: Array<{
				characterId: string
				characterName: string
				matchedBy: Array<'character_id' | 'character_name'>
			}>
		}>
	}> {
		const db = this.getDb()
		const hrStub = getStub<Hr>(this.env.HR, 'default')
		const pushTarget = (
			targets: BlacklistTargetCheckItem[],
			targetType: BlacklistTargetCheckItem['targetType'],
			targetValue?: string | null
		) => {
			const value = (targetValue ?? '').trim()
			if (!value) return
			targets.push({ targetType, targetValue: value })
		}
		const dedupeTargets = (targets: BlacklistTargetCheckItem[]): BlacklistTargetCheckItem[] => {
			const map = new Map<string, BlacklistTargetCheckItem>()
			for (const target of targets) {
				const normalizedValue =
					target.targetType === 'character_name'
						? target.targetValue.trim().toLowerCase()
						: target.targetValue.trim()
				if (!normalizedValue) continue
				map.set(`${target.targetType}:${normalizedValue}`, {
					targetType: target.targetType,
					targetValue: normalizedValue,
				})
			}
			return [...map.values()]
		}
		const sourceByTarget = new Map<
			string,
			Set<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
		>()
		const addSource = (
			targetType: BlacklistTargetType,
			targetValue: string,
			source: 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'
		) => {
			const normalizedValue =
				targetType === 'character_name' ? targetValue.trim().toLowerCase() : targetValue.trim()
			if (!normalizedValue) return
			const key = `${targetType}:${normalizedValue}`
			const bucket =
				sourceByTarget.get(key) ??
				new Set<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>()
			bucket.add(source)
			sourceByTarget.set(key, bucket)
		}
		const getSourceMeta = (targetType: BlacklistTargetType, targetValue: string) => {
			const normalizedValue =
				targetType === 'character_name' ? targetValue.trim().toLowerCase() : targetValue.trim()
			const sources = [...(sourceByTarget.get(`${targetType}:${normalizedValue}`) ?? new Set())]
			const preferredSource: 'legacy' | 'tang' = sources.some((source) =>
				source.startsWith('tang_')
			)
				? 'tang'
				: 'legacy'
			return { sources, preferredSource }
		}
		const uniqueCharacterPairs = [
			...new Map(
				input.characterPairs
					.filter((pair) => pair.characterId || pair.characterName)
					.map((pair) => [pair.characterId || `name:${pair.characterName}`, pair])
			).values(),
		]
		const uniqueIpAddresses = [
			...new Set(input.ipAddresses.map((value) => value.trim()).filter(Boolean)),
		]

		const primaryTargets: BlacklistTargetCheckItem[] = [
			{ targetType: 'user', targetValue: input.modernUserId },
		]
		addSource('user', input.modernUserId, 'tang_direct')
		for (const hint of input.sourceHints ?? []) {
			addSource(hint.targetType, hint.targetValue, hint.source)
		}
		for (const pair of uniqueCharacterPairs) {
			pushTarget(primaryTargets, 'character_id', pair.characterId)
			pushTarget(primaryTargets, 'character_name', pair.characterName)
		}
		for (const discordUserId of input.discordUserIds) {
			pushTarget(primaryTargets, 'discord_id', discordUserId)
		}
		const dedupedPrimaryTargets = dedupeTargets(primaryTargets)
		const allTargets: BlacklistTargetCheckItem[] = [...dedupedPrimaryTargets]
		const directTargetKeySet = new Set(
			dedupedPrimaryTargets.map((target) => `${target.targetType}:${target.targetValue}`)
		)
		const linkedUserContexts: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			discordUserId: string | null
			userPairs: Array<{ characterId: string; characterName: string }>
			matchingIpHashes: string[]
		}> = []

		const ipAssociatedBlacklistedUsers: Array<{
			userId: string
			mainCharacterId: string
			mainCharacterName: string | null
			matchingIpHashes: string[]
			userBlacklisted: boolean
			discordBlacklisted: boolean
			matchedItems: Array<{ targetType: BlacklistTargetType; targetValue: string }>
			matchingBlacklistedCharacters: Array<{
				characterId: string
				characterName: string
				matchedBy: Array<'character_id' | 'character_name'>
			}>
		}> = []

		if (uniqueIpAddresses.length > 0 && this.env.IP_ADDRESS_HASH_SECRET) {
			const hashSecret = this.env.IP_ADDRESS_HASH_SECRET
			const ipHashes = await Promise.all(
				uniqueIpAddresses.map((ipAddress) => this.hashIpAddress(hashSecret, ipAddress))
			)
			const uniqueIpHashes = [...new Set(ipHashes)]
			if (uniqueIpHashes.length > 0) {
				const linkedRows = await db
					.select({
						userId: userIpAddresses.userId,
						ipAddressHash: userIpAddresses.ipAddressHash,
					})
					.from(userIpAddresses)
					.where(
						and(
							inArray(userIpAddresses.ipAddressHash, uniqueIpHashes),
							ne(userIpAddresses.userId, input.modernUserId)
						)
					)
				const linkedUserIds = [...new Set(linkedRows.map((row) => row.userId))]
				if (linkedUserIds.length > 0) {
					const linkedUsers = await db.query.users.findMany({
						where: inArray(users.id, linkedUserIds),
						columns: { id: true, mainCharacterId: true, discordUserId: true },
					})
					const linkedUserCharacters = await db.query.userCharacters.findMany({
						where: and(
							inArray(userCharacters.userId, linkedUserIds),
							eq(userCharacters.isDeleted, false)
						),
						columns: { userId: true, characterId: true, characterName: true },
					})
					const linkedMainCharacterNames = await db.query.userCharacters.findMany({
						where: inArray(
							userCharacters.characterId,
							linkedUsers.map((user) => user.mainCharacterId)
						),
						columns: { characterId: true, characterName: true },
					})
					const mainCharacterNameById = new Map(
						linkedMainCharacterNames.map((row) => [row.characterId, row.characterName])
					)
					const characterPairsByUser = new Map<
						string,
						Array<{ characterId: string; characterName: string }>
					>()
					for (const row of linkedUserCharacters) {
						const bucket = characterPairsByUser.get(row.userId) ?? []
						bucket.push({ characterId: row.characterId, characterName: row.characterName })
						characterPairsByUser.set(row.userId, bucket)
					}
					const matchingHashesByUserId = new Map<string, Set<string>>()
					for (const row of linkedRows) {
						const bucket = matchingHashesByUserId.get(row.userId) ?? new Set<string>()
						bucket.add(row.ipAddressHash)
						matchingHashesByUserId.set(row.userId, bucket)
					}

					const ipAssociationTargets: BlacklistTargetCheckItem[] = []
					for (const linkedUser of linkedUsers) {
						const userTargets: BlacklistTargetCheckItem[] = [
							{ targetType: 'user', targetValue: linkedUser.id },
						]
						addSource('user', linkedUser.id, 'tang_ip_association')
						if (linkedUser.discordUserId) {
							userTargets.push({ targetType: 'discord_id', targetValue: linkedUser.discordUserId })
							addSource('discord_id', linkedUser.discordUserId, 'tang_ip_association')
						}
						const userPairs = characterPairsByUser.get(linkedUser.id) ?? []
						for (const pair of userPairs) {
							pushTarget(userTargets, 'character_id', pair.characterId)
							pushTarget(userTargets, 'character_name', pair.characterName)
							addSource('character_id', pair.characterId, 'tang_ip_association')
							if (pair.characterName)
								addSource('character_name', pair.characterName, 'tang_ip_association')
						}
						for (const target of dedupeTargets(userTargets)) {
							ipAssociationTargets.push(target)
						}
						linkedUserContexts.push({
							userId: linkedUser.id,
							mainCharacterId: linkedUser.mainCharacterId,
							mainCharacterName: mainCharacterNameById.get(linkedUser.mainCharacterId) ?? null,
							discordUserId: linkedUser.discordUserId ?? null,
							userPairs,
							matchingIpHashes: [
								...(matchingHashesByUserId.get(linkedUser.id) ?? new Set<string>()),
							],
						})
					}
					allTargets.push(...dedupeTargets(ipAssociationTargets))
				}
			}
		}

		const dedupedAllTargets = dedupeTargets(allTargets)
		const allResults = await hrStub.checkBlacklistTargets(dedupedAllTargets)
		const allBlacklisted = allResults.filter((row) => row.isBlacklisted)
		const matchedByKey = new Map(
			allBlacklisted.map((row) => [`${row.targetType}:${row.targetValue}`, row] as const)
		)
		const isMatched = (targetType: BlacklistTargetType, targetValue?: string | null): boolean => {
			const value = (targetValue ?? '').trim()
			if (!value) return false
			const normalized = targetType === 'character_name' ? value.toLowerCase() : value
			return matchedByKey.has(`${targetType}:${normalized}`)
		}
		const getMatchedMeta = (targetType: BlacklistTargetType, targetValue?: string | null) => {
			const value = (targetValue ?? '').trim()
			if (!value) return null
			const normalized = targetType === 'character_name' ? value.toLowerCase() : value
			return matchedByKey.get(`${targetType}:${normalized}`) ?? null
		}
		const coalesceCharacterMeta = (characterId: string, characterName?: string | null) => {
			const byId = getMatchedMeta('character_id', characterId)
			const byName = getMatchedMeta('character_name', characterName)
			if (byId && byName) {
				const idDate = byId.createdAt ? new Date(byId.createdAt).getTime() : 0
				const nameDate = byName.createdAt ? new Date(byName.createdAt).getTime() : 0
				return idDate >= nameDate ? byId : byName
			}
			return byId ?? byName
		}

		const primaryResults = allResults.filter((row) =>
			directTargetKeySet.has(`${row.targetType}:${row.targetValue}`)
		)
		const modernUserBlacklisted = isMatched('user', input.modernUserId)
		const matchingCharactersBlacklisted = uniqueCharacterPairs
			.map((pair) => {
				const idMatched = isMatched('character_id', pair.characterId)
				const nameMatched = isMatched('character_name', pair.characterName)
				if (!idMatched && !nameMatched) return null
				const meta = coalesceCharacterMeta(pair.characterId, pair.characterName)
				const sourceMeta = getSourceMeta('character_id', pair.characterId)
				return {
					characterId: pair.characterId,
					characterName: pair.characterName ?? '',
					matchedBy:
						idMatched && nameMatched
							? (['character_id', 'character_name'] as Array<'character_id' | 'character_name'>)
							: idMatched
								? (['character_id'] as Array<'character_id' | 'character_name'>)
								: (['character_name'] as Array<'character_id' | 'character_name'>),
					reason: meta?.reason ?? null,
					createdAt: meta?.createdAt ?? null,
					blacklistedBy: meta?.blacklistedBy ?? null,
					entryMode: meta?.entryMode ?? null,
					discoverySources: sourceMeta.sources,
					preferredSource: sourceMeta.preferredSource,
				}
			})
			.filter((row): row is NonNullable<typeof row> => row !== null)
		const matchingDiscordUserIdsBlacklisted = [
			...new Set(
				input.discordUserIds.filter((discordUserId) => isMatched('discord_id', discordUserId))
			),
		]

		for (const linkedUser of linkedUserContexts) {
			const userBlacklisted = isMatched('user', linkedUser.userId)
			const discordBlacklisted = linkedUser.discordUserId
				? isMatched('discord_id', linkedUser.discordUserId)
				: false
			const matchingBlacklistedCharacters = linkedUser.userPairs
				.map((pair) => {
					const idMatched = isMatched('character_id', pair.characterId)
					const nameMatched = isMatched('character_name', pair.characterName)
					if (!idMatched && !nameMatched) return null
					return {
						characterId: pair.characterId,
						characterName: pair.characterName ?? '',
						matchedBy:
							idMatched && nameMatched
								? (['character_id', 'character_name'] as Array<'character_id' | 'character_name'>)
								: idMatched
									? (['character_id'] as Array<'character_id' | 'character_name'>)
									: (['character_name'] as Array<'character_id' | 'character_name'>),
					}
				})
				.filter((row): row is NonNullable<typeof row> => row !== null)
			const matchedItems: Array<{ targetType: BlacklistTargetType; targetValue: string }> = []
			if (userBlacklisted) matchedItems.push({ targetType: 'user', targetValue: linkedUser.userId })
			if (discordBlacklisted && linkedUser.discordUserId) {
				matchedItems.push({ targetType: 'discord_id', targetValue: linkedUser.discordUserId })
			}
			for (const row of matchingBlacklistedCharacters) {
				matchedItems.push({ targetType: 'character_id', targetValue: row.characterId })
			}
			if (!userBlacklisted && !discordBlacklisted && matchingBlacklistedCharacters.length === 0)
				continue
			ipAssociatedBlacklistedUsers.push({
				userId: linkedUser.userId,
				mainCharacterId: linkedUser.mainCharacterId,
				mainCharacterName: linkedUser.mainCharacterName,
				matchingIpHashes: linkedUser.matchingIpHashes,
				userBlacklisted,
				discordBlacklisted,
				matchingBlacklistedCharacters,
				matchedItems,
			})
		}

		const hasAnyBlacklistSignal =
			modernUserBlacklisted ||
			matchingCharactersBlacklisted.length > 0 ||
			matchingDiscordUserIdsBlacklisted.length > 0 ||
			ipAssociatedBlacklistedUsers.length > 0

		return {
			hasAnyBlacklistSignal,
			modernUserBlacklisted,
			matchedTargets: primaryResults
				.filter((row) => row.isBlacklisted)
				.map((row) => {
					const sourceMeta = getSourceMeta(row.targetType, row.targetValue)
					return {
						targetType: row.targetType,
						targetValue: row.targetValue,
						reason: row.reason,
						createdAt: row.createdAt,
						blacklistedBy: row.blacklistedBy,
						entryMode: row.entryMode,
						discoverySources: sourceMeta.sources,
						preferredSource: sourceMeta.preferredSource,
					}
				}),
			matchingCharactersBlacklisted,
			matchingDiscordUserIdsBlacklisted,
			ipAssociatedBlacklistedUsers,
		}
	}

	async listUsersNeedingRefresh(maxResults: number): Promise<string[]> {
		const limit = Number.isFinite(maxResults) ? Math.floor(maxResults) : 0
		if (limit <= 0) {
			return []
		}

		const now = Date.now()
		const refreshThreshold = new Date(now - 60 * 60 * 1000) // 1 hour
		const attemptThreshold = new Date(now - 10 * 60 * 1000) // 10 minutes

		const candidates = await this.getDb().query.users.findMany({
			columns: {
				id: true,
			},
			where: and(
				or(isNull(users.lastRefreshWorkflow), lt(users.lastRefreshWorkflow, refreshThreshold)),
				or(
					isNull(users.lastRefreshWorkflowAttempt),
					lt(users.lastRefreshWorkflowAttempt, attemptThreshold)
				)
			),
			orderBy: (table) => [asc(table.lastRefreshWorkflow)],
			limit,
		})

		if (candidates.length === 0) {
			return []
		}

		const userIds = candidates.map((candidate) => candidate.id)
		const activeCharacterRows = await this.getDb().query.userCharacters.findMany({
			where: and(inArray(userCharacters.userId, userIds), eq(userCharacters.isDeleted, false)),
			columns: {
				userId: true,
			},
		})
		const usersWithActiveCharacters = new Set(activeCharacterRows.map((row) => row.userId))
		const filteredUserIds = userIds.filter((userId) => usersWithActiveCharacters.has(userId))

		if (filteredUserIds.length === 0) {
			return []
		}

		await this.getDb()
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date() })
			.where(inArray(users.id, filteredUserIds))

		return filteredUserIds
	}

	private async resolveUserIdsForCharacterIds(characterIds: string[]): Promise<string[]> {
		if (characterIds.length === 0) {
			return []
		}

		const mappings = await this.getDb()
			.select({ userId: userCharacters.userId })
			.from(userCharacters)
			.where(inArray(userCharacters.characterId, characterIds))

		return [...new Set(mappings.map((m) => m.userId))]
	}

	async handleCharacterAffiliationChange(
		characterId: string,
		options?: { source?: string }
	): Promise<{
		usersMatched: number
		refreshUsersQueued: number
	}> {
		return this.handleCharacterAffiliationChanges([characterId], options)
	}

	async handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: { source?: string }
	): Promise<{
		usersMatched: number
		refreshUsersQueued: number
	}> {
		const normalizedCharacterIds = [...new Set(characterIds.map((id) => String(id)))]
		const uniqueUserIds = await this.resolveUserIdsForCharacterIds(normalizedCharacterIds)
		const queueResult = await this.queueUserRefreshes(uniqueUserIds, {
			source: options?.source ?? 'character-affiliation-changed',
			force: true,
		})

		return {
			usersMatched: uniqueUserIds.length,
			refreshUsersQueued: queueResult.added,
		}
	}

	/**
	 * Queue user reconciliation without waiting for it. The workflow publishes a
	 * ready Discord refresh only after it persists affiliation and role changes.
	 */
	async queueUserRefreshes(
		userIds: string[],
		options?: { source?: string; force?: boolean }
	): Promise<{ pendingCount: number; added: number; skipped: number }> {
		const now = Date.now()
		const source = options?.source ?? 'character-affiliation-changed'
		const force = options?.force === true
		const expiresAt = now + CoreDO.PENDING_TTL_MS
		const toStore: Record<string, PendingUserRefresh> = {}
		let added = 0
		let skipped = 0

		for (const userId of userIds) {
			const existing = this.pendingUserRefreshes.get(userId)
			if (!force && existing && existing.expiresAt > now) {
				skipped++
				continue
			}
			const entry: PendingUserRefresh = { expiresAt, processed: false, source }
			this.pendingUserRefreshes.set(userId, entry)
			toStore[`${CoreDO.USER_REFRESH_STORAGE_PREFIX}${userId}`] = entry
			added++
		}

		if (added > 0) {
			await this.state.storage.put(toStore)
		}

		this.logger.info('[CoreDO] Queued user refreshes', {
			added,
			skipped,
			source,
			force,
			pendingCount: this.pendingUserRefreshes.size,
		})
		return { pendingCount: this.pendingUserRefreshes.size, added, skipped }
	}

	/**
	 * Add ready Discord work to the batching queue.
	 * If a userId already has a non-expired entry (processed or not), it is skipped —
	 * the TTL window acts as the deduplication guard.
	 */
	async addPendingDiscordRefreshes(
		userIds: string[],
		options?: {
			source?: string
			force?: boolean
			allowRemoval?: boolean
			hardStripAllRoles?: boolean
		}
	): Promise<{ pendingCount: number; added: number; skipped: number }> {
		const now = Date.now()
		const expiresAt = now + CoreDO.PENDING_TTL_MS
		const source = options?.source ?? 'corp-membership-changed'
		const force = options?.force === true
		const allowRemoval = options?.allowRemoval ?? true
		const hardStripAllRoles = options?.hardStripAllRoles ?? false
		const toStore: Record<string, PendingDiscordRefresh> = {}
		let added = 0
		let skipped = 0

		for (const userId of userIds) {
			const existing = this.pendingDiscordRefreshes.get(userId)
			if (!force && existing && existing.expiresAt > now) {
				// Still within TTL window — skip
				skipped++
				continue
			}
			const entry: PendingDiscordRefresh = {
				expiresAt,
				processed: false,
				source,
				allowRemoval: existing?.allowRemoval || allowRemoval,
				hardStripAllRoles: existing?.hardStripAllRoles || hardStripAllRoles,
			}
			this.pendingDiscordRefreshes.set(userId, entry)
			toStore[`${CoreDO.STORAGE_PREFIX}${userId}`] = entry
			added++
		}

		if (added > 0) {
			await this.state.storage.put(toStore)
		}

		this.logger.info('[CoreDO] Added pending Discord refreshes', {
			added,
			skipped,
			source,
			force,
			pendingCount: this.pendingDiscordRefreshes.size,
		})

		return {
			pendingCount: this.pendingDiscordRefreshes.size,
			added,
			skipped,
		}
	}

	private async evictPendingDiscordRefresh(userId: string, reason: string): Promise<void> {
		this.pendingDiscordRefreshes.delete(userId)
		await this.state.storage.delete(`${CoreDO.STORAGE_PREFIX}${userId}`)
		this.logger.info('[CoreDO] Evicted pending Discord refresh entry', { userId, reason })
	}

	private async evictPendingImmunitasAccessAlert(queueKey: string, reason: string): Promise<void> {
		this.pendingImmunitasAccessAlerts.delete(queueKey)
		await this.state.storage.delete(`${CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX}${queueKey}`)
		await this.scheduleImmunitasAccessAlertAlarm()
		this.logger.info('[CoreDO] Evicted pending immunitas access alert entry', {
			queueKey,
			reason,
		})
	}

	private buildImmunitasQueueKey(input: {
		targetUserId: string
		accessType: 'profile-data' | 'fulcrum-report'
	}): string {
		return `${input.targetUserId}:${input.accessType}`
	}

	private async evictPendingTokenInvalidationAlert(userId: string, reason: string): Promise<void> {
		this.pendingTokenInvalidationAlerts.delete(userId)
		await this.state.storage.delete(`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${userId}`)
		this.logger.info('[CoreDO] Evicted pending token invalidation alert entry', {
			userId,
			reason,
		})
	}

	private async getCharacterNamesForUser(
		userId: string,
		characterIds: string[]
	): Promise<Array<{ characterId: string; characterName: string; hasValidToken: boolean }>> {
		if (characterIds.length === 0) {
			return []
		}

		const normalized = [
			...new Set(characterIds.map((characterId) => String(characterId).trim())),
		].filter(Boolean)
		if (normalized.length === 0) {
			return []
		}

		const rows = await this.getDb().query.userCharacters.findMany({
			where: and(
				eq(userCharacters.userId, userId),
				inArray(userCharacters.characterId, normalized)
			),
			columns: {
				characterId: true,
				characterName: true,
				hasValidToken: true,
			},
		})

		return rows.map((row) => ({
			characterId: row.characterId,
			characterName: row.characterName,
			hasValidToken: row.hasValidToken === true,
		}))
	}

	private normalizeImmunitasLabels(labels: string[]): string[] {
		return [...new Set(labels.map((label) => String(label).trim()))].filter(Boolean)
	}

	private buildImmunitasAccessMessage(input: {
		accessType: 'profile-data' | 'fulcrum-report'
		targetCharacterLabels: string[]
		requestorGroups: Array<{
			requestorUserId: string
			requestorLabels: string[]
			attemptCount: number
		}>
		attemptCount: number
	}): ReturnType<typeof buildImmunitasAccessAlertMessage> {
		return buildImmunitasAccessAlertMessage({
			accessType: input.accessType,
			targetCharacterLabels: input.targetCharacterLabels,
			requestorGroups: input.requestorGroups,
			attemptCount: input.attemptCount,
			updatedAt: new Date(),
		})
	}

	private async scheduleImmunitasAccessAlertAlarm(): Promise<void> {
		const pendingEntries = [...this.pendingImmunitasAccessAlerts.values()].filter(
			(entry) => entry.pendingTargetCharacterLabels.length > 0
		)
		if (pendingEntries.length === 0) {
			await this.state.storage.deleteAlarm()
			return
		}

		const now = Date.now()
		const nextAlarmAt = Math.min(...pendingEntries.map((entry) => entry.nextEligibleAt))
		await this.state.storage.setAlarm(Math.max(now, nextAlarmAt))
	}

	async queueTokenInvalidationAlerts(input: {
		userId: string
		characterIds: string[]
		source?: string
	}): Promise<{
		added: number
		skipped: number
		pendingCount: number
	}> {
		const normalizedCharacterIds = [
			...new Set(input.characterIds.map((characterId) => String(characterId).trim())),
		].filter(Boolean)
		if (normalizedCharacterIds.length === 0) {
			return { added: 0, skipped: 0, pendingCount: this.pendingTokenInvalidationAlerts.size }
		}

		const now = Date.now()
		const expiresAt = now + TOKEN_INVALID_ALERT_TTL_MS
		const existing = this.pendingTokenInvalidationAlerts.get(input.userId)
		const pendingCharacterIds = new Set(existing?.pendingCharacterIds ?? [])
		const beforeSize = pendingCharacterIds.size
		for (const characterId of normalizedCharacterIds) {
			pendingCharacterIds.add(characterId)
		}
		const added = pendingCharacterIds.size - beforeSize
		const skipped = normalizedCharacterIds.length - added

		const nextEligibleAt =
			existing?.nextEligibleAt && existing.nextEligibleAt > now ? existing.nextEligibleAt : now

		this.pendingTokenInvalidationAlerts.set(input.userId, {
			expiresAt,
			pendingCharacterIds: [...pendingCharacterIds],
			lastNotifiedAt: existing?.lastNotifiedAt ?? null,
			nextEligibleAt,
			attemptCount: existing?.attemptCount ?? 0,
			lastError: existing?.lastError,
			source: input.source ?? existing?.source,
		})

		await this.state.storage.put({
			[`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${input.userId}`]:
				this.pendingTokenInvalidationAlerts.get(input.userId)!,
		})

		this.logger.info('[CoreDO] Queued token invalidation alerts', {
			userId: input.userId,
			added,
			skipped,
			pendingCount: this.pendingTokenInvalidationAlerts.size,
			source: input.source ?? existing?.source ?? 'unknown',
		})

		return {
			added,
			skipped,
			pendingCount: this.pendingTokenInvalidationAlerts.size,
		}
	}

	async queueImmunitasAccessAlert(input: {
		targetUserId: string
		targetCharacterLabel: string
		requestorUserId: string
		requestorCharacterLabel: string | null
		accessType: 'profile-data' | 'fulcrum-report'
		source?: string
	}): Promise<{
		added: number
		skipped: number
		pendingCount: number
	}> {
		const queueKey = this.buildImmunitasQueueKey(input)
		const now = Date.now()
		const expiresAt = now + IMMUNITAS_ALERT_TTL_MS
		const existing = this.pendingImmunitasAccessAlerts.get(queueKey)
		const pendingTargetCharacterLabels = new Set(existing?.pendingTargetCharacterLabels ?? [])
		const pendingRequestorGroupsByUserId = new Map(
			(existing?.pendingRequestorGroups ?? []).map((group) => [
				group.requestorUserId,
				{
					requestorUserId: group.requestorUserId,
					requestorLabels: new Set(
						group.requestorLabels.map((label) => String(label).trim()).filter(Boolean)
					),
					attemptCount: group.attemptCount ?? 0,
				},
			])
		)
		const beforeTargetSize = pendingTargetCharacterLabels.size
		const hasPendingEntry = (existing?.pendingTargetCharacterLabels.length ?? 0) > 0
		const requestorLabel =
			input.requestorCharacterLabel?.trim() || input.requestorUserId.trim() || 'Unknown requester'
		const existingRequestorGroup = pendingRequestorGroupsByUserId.get(input.requestorUserId) ?? {
			requestorUserId: input.requestorUserId,
			requestorLabels: new Set<string>(),
			attemptCount: 0,
		}
		const beforeRequestorSize = existingRequestorGroup.requestorLabels.size
		pendingTargetCharacterLabels.add(input.targetCharacterLabel.trim())
		existingRequestorGroup.requestorLabels.add(requestorLabel)
		existingRequestorGroup.attemptCount += 1
		pendingRequestorGroupsByUserId.set(input.requestorUserId, existingRequestorGroup)
		const added =
			pendingTargetCharacterLabels.size -
			beforeTargetSize +
			existingRequestorGroup.requestorLabels.size -
			beforeRequestorSize
		const skipped = Math.max(0, 2 - added)
		const nextEligibleAt = hasPendingEntry
			? existing!.nextEligibleAt
			: existing?.nextEligibleAt && existing.nextEligibleAt > now
				? existing.nextEligibleAt
				: now + IMMUNITAS_ALERT_INITIAL_DELAY_MS
		const entry = {
			expiresAt,
			pendingTargetCharacterLabels: [...pendingTargetCharacterLabels],
			pendingRequestorGroups: [...pendingRequestorGroupsByUserId.values()].map((group) => ({
				requestorUserId: group.requestorUserId,
				requestorLabels: [...group.requestorLabels],
				attemptCount: group.attemptCount,
			})),
			lastNotifiedAt: existing?.lastNotifiedAt ?? null,
			nextEligibleAt,
			attemptCount: (existing?.attemptCount ?? 0) + 1,
			lastError: existing?.lastError,
			source: input.source ?? existing?.source,
			accessType: input.accessType,
			targetUserId: input.targetUserId,
		}
		this.pendingImmunitasAccessAlerts.set(queueKey, entry)

		await this.state.storage.put({
			[`${CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX}${queueKey}`]:
				this.pendingImmunitasAccessAlerts.get(queueKey)!,
		})
		await this.scheduleImmunitasAccessAlertAlarm()

		this.logger.info('[CoreDO] Queued immunitas access alert', {
			queueKey,
			targetUserId: input.targetUserId,
			accessType: input.accessType,
			pendingCount: this.pendingImmunitasAccessAlerts.size,
			source: input.source ?? existing?.source ?? 'unknown',
			hasPendingEntry,
		})

		return {
			added,
			skipped,
			pendingCount: this.pendingImmunitasAccessAlerts.size,
		}
	}

	private buildPendingTokenInvalidationMessage(
		characterNames: string[]
	): ReturnType<typeof buildTokenInvalidationMessage> {
		return buildTokenInvalidationMessage({
			characterNames,
			invalidCharacterCount: characterNames.length,
			updatedAt: new Date(),
		})
	}

	private async markPendingEntriesProcessed<T extends { processed: boolean }>(
		entries: Map<string, T>,
		storagePrefix: string
	): Promise<Array<{ userId: string; entry: T }>> {
		const pending: Array<{ userId: string; entry: T }> = []
		const toStore: Record<string, T> = {}

		for (const [userId, entry] of entries) {
			if (!entry.processed) {
				entry.processed = true
				pending.push({ userId, entry })
				toStore[`${storagePrefix}${userId}`] = entry
			}
		}

		if (pending.length > 0) {
			await this.state.storage.put(toStore)
		}

		return pending
	}

	private async pruneExpiredPendingEntries<T extends { expiresAt: number }>(
		entries: Map<string, T>,
		storagePrefix: string,
		now: number
	): Promise<void> {
		const expiredKeys: string[] = []
		for (const [userId, entry] of entries) {
			if (entry.expiresAt <= now) {
				entries.delete(userId)
				expiredKeys.push(`${storagePrefix}${userId}`)
			}
		}
		if (expiredKeys.length > 0) {
			await this.state.storage.delete(expiredKeys)
		}
	}

	/**
	 * Drain the two-stage refresh pipeline. A user-refresh request starts durable
	 * reconciliation work and returns immediately; the workflow later publishes a
	 * ready Discord job after state has been persisted.
	 */
	async processPendingRefreshes(): Promise<{
		refreshesProcessed: number
		refreshesTriggered: number
		discordProcessed: number
		triggered: number
		failed: number
	}> {
		const now = Date.now()
		await Promise.all([
			this.pruneExpiredPendingEntries(
				this.pendingUserRefreshes,
				CoreDO.USER_REFRESH_STORAGE_PREFIX,
				now
			),
			this.pruneExpiredPendingEntries(this.pendingDiscordRefreshes, CoreDO.STORAGE_PREFIX, now),
		])

		const pendingUserRefreshes = await this.markPendingEntriesProcessed(
			this.pendingUserRefreshes,
			CoreDO.USER_REFRESH_STORAGE_PREFIX
		)
		const pendingDiscordRefreshes = await this.markPendingEntriesProcessed(
			this.pendingDiscordRefreshes,
			CoreDO.STORAGE_PREFIX
		)

		const db = this.getDb()
		const refreshResults = await Promise.allSettled(
			pendingUserRefreshes.map(({ userId, entry }) =>
				triggerUserRefreshWorkflow({
					db,
					env: this.env,
					userId,
					source: entry.source,
					bypassThrottle: true,
					refreshMode: 'event',
				})
			)
		)

		let refreshesTriggered = 0
		let failedCount = 0
		for (const [index, result] of refreshResults.entries()) {
			const userId = pendingUserRefreshes[index]?.userId
			if (result.status === 'fulfilled' && result.value.triggered) {
				refreshesTriggered++
				continue
			}
			failedCount++
			this.logger.error('[CoreDO] Failed to trigger queued user refresh', {
				userId,
				source: pendingUserRefreshes[index]?.entry.source,
				error:
					result.status === 'rejected'
						? result.reason instanceof Error
							? result.reason.message
							: String(result.reason)
						: (result.value.error ?? result.value.status),
			})
		}

		const JITTER_MAX_SECONDS = 600
		const discordResults = await Promise.allSettled(
			pendingDiscordRefreshes.map(async ({ userId, entry }) => {
				const user = await db.query.users.findFirst({
					where: eq(users.id, userId),
					columns: { discordUserId: true },
				})
				if (!user?.discordUserId) {
					await this.evictPendingDiscordRefresh(userId, 'no-linked-discord')
					return { kind: 'skipped' as const }
				}

				return {
					kind: 'result' as const,
					result: await triggerDiscordRefreshWorkflow({
						env: this.env,
						userId,
						source: entry.source,
						allowRemoval: entry.allowRemoval,
						hardStripAllRoles: entry.hardStripAllRoles,
						jitterDelaySeconds: Math.floor(Math.random() * JITTER_MAX_SECONDS),
					}),
				}
			})
		)

		let discordTriggered = 0
		for (const [index, result] of discordResults.entries()) {
			if (result.status === 'fulfilled') {
				if (result.value.kind === 'skipped') {
					continue
				}
				if (result.value.result.triggered) {
					discordTriggered++
					continue
				}
				failedCount++
				this.logger.error('[CoreDO] Failed to trigger queued Discord refresh', {
					userId: pendingDiscordRefreshes[index]?.userId,
					source: pendingDiscordRefreshes[index]?.entry.source,
					error: result.value.result.error ?? result.value.result.status,
				})
				continue
			}
			failedCount++
			this.logger.error('[CoreDO] Failed to trigger queued Discord refresh', {
				userId: pendingDiscordRefreshes[index]?.userId,
				source: pendingDiscordRefreshes[index]?.entry.source,
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			})
		}

		const result = {
			refreshesProcessed: pendingUserRefreshes.length,
			refreshesTriggered,
			discordProcessed: pendingDiscordRefreshes.length,
			triggered: refreshesTriggered + discordTriggered,
			failed: failedCount,
		}
		this.logger.info('[CoreDO] Processed queued user and Discord refreshes', result)
		return result
	}

	/**
	 * Expire Mumble temp-ops whose TTL has elapsed, disconnecting their guests,
	 * and sweep stale credential handoffs. Called by the scheduled handler (cron).
	 */
	async processExpiredTempops(): Promise<{ expired: number; disconnected: number }> {
		return processExpiredTempops(this.env)
	}

	/**
	 * Drain queued immunitas access alerts and DM the affected users.
	 * Alerts are deduplicated per target user + access type and rate-limited
	 * to one delivery per 15 minutes.
	 */
	async processPendingImmunitasAccessAlerts(): Promise<{
		processed: number
		sent: number
		failed: number
	}> {
		const now = Date.now()

		const expiredKeys: string[] = []
		for (const [queueKey, entry] of this.pendingImmunitasAccessAlerts) {
			if (entry.expiresAt <= now) {
				this.pendingImmunitasAccessAlerts.delete(queueKey)
				expiredKeys.push(`${CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX}${queueKey}`)
			}
		}
		if (expiredKeys.length > 0) {
			await this.state.storage.delete(expiredKeys)
		}

		const dueEntries = [...this.pendingImmunitasAccessAlerts.entries()]
			.filter(
				([, entry]) => entry.pendingTargetCharacterLabels.length > 0 && entry.nextEligibleAt <= now
			)
			.sort((a, b) => a[1].nextEligibleAt - b[1].nextEligibleAt)
			.slice(0, 20)

		if (dueEntries.length === 0) {
			return { processed: 0, sent: 0, failed: 0 }
		}

		const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
		const db = this.getDb()
		let sent = 0
		let failed = 0
		const toStore: Record<
			string,
			{
				expiresAt: number
				pendingTargetCharacterLabels: string[]
				pendingRequestorGroups: Array<{
					requestorUserId: string
					requestorLabels: string[]
					attemptCount: number
				}>
				lastNotifiedAt: number | null
				nextEligibleAt: number
				attemptCount: number
				lastError?: string
				source?: string
				accessType: 'profile-data' | 'fulcrum-report'
				targetUserId: string
			}
		> = {}

		for (const [queueKey, entry] of dueEntries) {
			const user = await db.query.users.findFirst({
				where: eq(users.id, entry.targetUserId),
				columns: {
					id: true,
					discordUserId: true,
				},
			})

			if (!user) {
				await this.evictPendingImmunitasAccessAlert(
					queueKey,
					'queue entry no longer has a matching core user'
				)
				this.logger.info('[CoreDO] Dropped immunitas access alert for missing core user', {
					queueKey,
					targetUserId: entry.targetUserId,
				})
				continue
			}

			if (!user.discordUserId) {
				await this.evictPendingImmunitasAccessAlert(
					queueKey,
					'discord account is not linked for this user'
				)
				this.logger.info('[CoreDO] Dropped immunitas access alert due to missing Discord link', {
					queueKey,
					targetUserId: entry.targetUserId,
					pendingTargetCharacterLabels: entry.pendingTargetCharacterLabels.length,
				})
				continue
			}

			const message = this.buildImmunitasAccessMessage({
				accessType: entry.accessType,
				targetCharacterLabels: entry.pendingTargetCharacterLabels,
				requestorGroups: entry.pendingRequestorGroups,
				attemptCount: entry.attemptCount,
			})
			const result = await discordStub.sendDirectMessage(entry.targetUserId, message)
			if (!result.success) {
				if (!shouldRetryImmunitasAccessAlertDelivery(result)) {
					await this.evictPendingImmunitasAccessAlert(
						queueKey,
						result.error ?? 'fatal Discord delivery failure'
					)
					failed++
					this.logger.warn(
						'[CoreDO] Dropped immunitas access alert due to fatal Discord delivery failure',
						{
							queueKey,
							targetUserId: entry.targetUserId,
							accessType: entry.accessType,
							error: result.error ?? 'Unknown Discord delivery error',
						}
					)
					continue
				}

				const retryAfterMs =
					typeof result.retryAfter === 'number' && result.retryAfter > 0
						? result.retryAfter * 1000
						: IMMUNITAS_ALERT_RETRY_MS
				const nextEntry = {
					...entry,
					attemptCount: entry.attemptCount + 1,
					lastError: result.error ?? 'Failed to deliver immunitas access alert',
					nextEligibleAt: now + retryAfterMs,
					expiresAt: now + IMMUNITAS_ALERT_TTL_MS,
				}
				this.pendingImmunitasAccessAlerts.set(queueKey, nextEntry)
				toStore[`${CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX}${queueKey}`] = nextEntry
				failed++
				this.logger.warn('[CoreDO] Failed to send immunitas access alert', {
					queueKey,
					targetUserId: entry.targetUserId,
					accessType: entry.accessType,
					error: result.error ?? 'Unknown Discord delivery error',
					retryAfterMs,
				})
				continue
			}

			const nextEntry = {
				...entry,
				pendingTargetCharacterLabels: [],
				pendingRequestorGroups: [],
				lastNotifiedAt: now,
				nextEligibleAt: now + IMMUNITAS_ALERT_COOLDOWN_MS,
				attemptCount: 0,
				lastError: undefined,
				expiresAt: now + IMMUNITAS_ALERT_TTL_MS,
			}
			this.pendingImmunitasAccessAlerts.set(queueKey, nextEntry)
			toStore[`${CoreDO.IMMUNITAS_ALERT_STORAGE_PREFIX}${queueKey}`] = nextEntry
			sent++
		}

		if (Object.keys(toStore).length > 0) {
			await this.state.storage.put(toStore)
		}
		await this.scheduleImmunitasAccessAlertAlarm()

		this.logger.info('[CoreDO] Processed pending immunitas access alerts', {
			processed: dueEntries.length,
			sent,
			failed,
		})

		return {
			processed: dueEntries.length,
			sent,
			failed,
		}
	}

	async alarm(): Promise<void> {
		const result = await this.processPendingImmunitasAccessAlerts()
		if (result.processed > 0) {
			this.logger.info('[CoreDO] Immunitas alert alarm drained pending alerts', result)
		}
	}

	/**
	 * Drain queued token invalidation alerts and DM the affected users.
	 * Alerts are deduplicated per user and rate-limited to one delivery per 12 hours.
	 */
	async processPendingTokenInvalidationAlerts(): Promise<{
		processed: number
		sent: number
		failed: number
	}> {
		const now = Date.now()

		const expiredKeys: string[] = []
		for (const [userId, entry] of this.pendingTokenInvalidationAlerts) {
			if (entry.expiresAt <= now) {
				this.pendingTokenInvalidationAlerts.delete(userId)
				expiredKeys.push(`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${userId}`)
			}
		}
		if (expiredKeys.length > 0) {
			await this.state.storage.delete(expiredKeys)
		}

		const dueUserIds = [...this.pendingTokenInvalidationAlerts.entries()]
			.filter(([, entry]) => entry.pendingCharacterIds.length > 0 && entry.nextEligibleAt <= now)
			.sort((a, b) => a[1].nextEligibleAt - b[1].nextEligibleAt)
			.slice(0, 20)
			.map(([userId]) => userId)

		if (dueUserIds.length === 0) {
			return { processed: 0, sent: 0, failed: 0 }
		}

		const discordStub = getStub<Discord>(this.env.DISCORD, 'default')
		const db = this.getDb()
		let sent = 0
		let failed = 0
		const toStore: Record<
			string,
			{
				expiresAt: number
				pendingCharacterIds: string[]
				lastNotifiedAt: number | null
				nextEligibleAt: number
				attemptCount: number
				lastError?: string
				source?: string
			}
		> = {}

		for (const userId of dueUserIds) {
			const entry = this.pendingTokenInvalidationAlerts.get(userId)
			if (!entry) {
				continue
			}

			const user = await db.query.users.findFirst({
				where: eq(users.id, userId),
				columns: {
					id: true,
					discordUserId: true,
				},
			})

			if (!user) {
				await this.evictPendingTokenInvalidationAlert(
					userId,
					'queue entry no longer has a matching core user'
				)
				this.logger.info('[CoreDO] Dropped token invalidation alert for missing core user', {
					userId,
				})
				continue
			}

			if (!user.discordUserId) {
				await this.evictPendingTokenInvalidationAlert(
					userId,
					'discord account is not linked for this user'
				)
				this.logger.info('[CoreDO] Dropped token invalidation alert due to missing Discord link', {
					userId,
					pendingCharacterIds: entry.pendingCharacterIds.length,
				})
				continue
			}

			const characterRows = await this.getCharacterNamesForUser(userId, entry.pendingCharacterIds)
			const invalidCharacterNames = characterRows
				.filter((character) => character.hasValidToken === false)
				.map((character) => character.characterName)

			if (invalidCharacterNames.length === 0) {
				if (entry.lastNotifiedAt === null) {
					await this.evictPendingTokenInvalidationAlert(
						userId,
						'all pending characters recovered before delivery'
					)
				} else {
					const nextEntry = {
						...entry,
						pendingCharacterIds: [],
						attemptCount: 0,
						lastError: undefined,
						expiresAt: now + TOKEN_INVALID_ALERT_TTL_MS,
						nextEligibleAt: now + TOKEN_INVALID_ALERT_COOLDOWN_MS,
					}
					this.pendingTokenInvalidationAlerts.set(userId, nextEntry)
					toStore[`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${userId}`] = nextEntry
				}
				continue
			}

			const message = this.buildPendingTokenInvalidationMessage(invalidCharacterNames)
			const result = await discordStub.sendDirectMessage(userId, message)
			if (!result.success) {
				if (!shouldRetryTokenInvalidationAlertDelivery(result)) {
					await this.evictPendingTokenInvalidationAlert(
						userId,
						result.error ?? 'fatal Discord delivery failure'
					)
					failed++
					this.logger.warn(
						'[CoreDO] Dropped token invalidation alert due to fatal Discord delivery failure',
						{
							userId,
							error: result.error ?? 'Unknown Discord delivery error',
						}
					)
					continue
				}

				const retryAfterMs =
					typeof result.retryAfter === 'number' && result.retryAfter > 0
						? result.retryAfter * 1000
						: TOKEN_INVALID_ALERT_RETRY_MS
				const nextEntry = {
					...entry,
					attemptCount: entry.attemptCount + 1,
					lastError: result.error ?? 'Failed to deliver token invalidation alert',
					nextEligibleAt: now + retryAfterMs,
					expiresAt: now + TOKEN_INVALID_ALERT_TTL_MS,
				}
				this.pendingTokenInvalidationAlerts.set(userId, nextEntry)
				toStore[`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${userId}`] = nextEntry
				failed++
				this.logger.warn('[CoreDO] Failed to send token invalidation alert', {
					userId,
					error: result.error ?? 'Unknown Discord delivery error',
					retryAfterMs,
				})
				continue
			}

			const nextEntry = {
				...entry,
				pendingCharacterIds: [],
				lastNotifiedAt: now,
				nextEligibleAt: now + TOKEN_INVALID_ALERT_COOLDOWN_MS,
				attemptCount: 0,
				lastError: undefined,
				expiresAt: now + TOKEN_INVALID_ALERT_TTL_MS,
			}
			this.pendingTokenInvalidationAlerts.set(userId, nextEntry)
			toStore[`${CoreDO.TOKEN_ALERT_STORAGE_PREFIX}${userId}`] = nextEntry
			sent++
		}

		if (Object.keys(toStore).length > 0) {
			await this.state.storage.put(toStore)
		}

		this.logger.info('[CoreDO] Processed pending token invalidation alerts', {
			processed: dueUserIds.length,
			sent,
			failed,
		})

		return {
			processed: dueUserIds.length,
			sent,
			failed,
		}
	}
}
