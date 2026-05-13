import { DurableObject } from 'cloudflare:workers'

import { CORE_ROLES, SERVICE_CORE } from '@repo/core'
import { and, asc, eq, inArray, isNull, lt, ne, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter, getEsiInstanceForCorporation } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { userCharacters, userIpAddresses, users } from './db/schema'
import { recordUserIpAddress } from './lib/ip-tracking'
import { validateAndSyncCharacterTokenValidity } from './lib/token-validity'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from './lib/workflow-triggers'
import { updateCharacterPublicInfo } from './workflows/steps/update-character'

import type { Core } from '@repo/core'
import type { CharacterPublicInfo } from '@repo/esi'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { CreateRoleRequest, Groups } from '@repo/groups'
import type { BlacklistTargetCheckItem, BlacklistTargetType, Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { Env } from './context'

export class CoreDO extends DurableObject<Env> implements Core {
	private readonly logger = logger.withTags({ service: 'core-durable-object' })
	private static readonly encoder = new TextEncoder()
	private static cachedIpHashSecret: string | null = null
	private static cachedIpHashKey: CryptoKey | null = null

	/**
	 * In-memory map of userIds pending Discord refresh.
	 *
	 * - Entries are added with processed=false and a 15-minute TTL.
	 * - The TTL acts as a deduplication window: re-adding a userId before it
	 *   expires is a no-op, whether or not it has already been processed.
	 * - The cron picks up processed=false entries, marks them processed=true,
	 *   then triggers workflows. Subsequent cron runs skip already-processed entries.
	 * - If a user is pre-checked as not having linked Discord, that user is
	 *   evicted from the pending set immediately after user-refresh completion
	 *   (no TTL wait).
	 * - Expired entries are pruned on each cron run.
	 * - State is persisted to DO storage so it survives evictions and redeploys.
	 *   The in-memory map is the working copy; storage is the source of truth on cold start.
	 */
	private pendingDiscordRefreshes = new Map<
		string,
		{
			expiresAt: number
			processed: boolean
			source?: string
			userRefreshWorkflowInstanceId?: string
		}
	>()
	private static readonly PENDING_TTL_MS = 15 * 60 * 1000 // 15 minutes
	private static readonly STORAGE_PREFIX = 'pending-discord:'

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		void this.state.blockConcurrencyWhile(async () => {
			await Promise.all([this.ensureRolesExist(), this.loadPendingDiscordRefreshes()])
		})
	}

	private async loadPendingDiscordRefreshes(): Promise<void> {
		const stored = await this.state.storage.list<{
			expiresAt: number
			processed: boolean
			source?: string
			userRefreshWorkflowInstanceId?: string
		}>({
			prefix: CoreDO.STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const userId = key.slice(CoreDO.STORAGE_PREFIX.length)
			this.pendingDiscordRefreshes.set(userId, {
				expiresAt: value.expiresAt,
				processed: value.processed,
				source: value.source,
				userRefreshWorkflowInstanceId: value.userRefreshWorkflowInstanceId,
			})
		}
		this.logger.info('[CoreDO] Loaded pending Discord refreshes from storage', {
			count: this.pendingDiscordRefreshes.size,
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
		const instance = getEsiInstanceForCharacter(this.env.ESI, characterId)
		const characterInfo = await instance.fetchCharacterPublicInfo(characterId)
		return characterInfo
	}

	private async getCharacterAllianceInfo(
		characterId: string
	): Promise<{ allianceId: string; allianceName: string } | null> {
		const characterInfo = await this.getCharacterInfo(characterId)
		if (!characterInfo) {
			return null
		}
		const instance = getEsiInstanceForCorporation(this.env.ESI, characterInfo.corporation_id)
		const corporationInfo = await instance.fetchCorporationPublicInfo(characterInfo.corporation_id)

		if (!corporationInfo.alliance_id) {
			return null
		}

		return {
			allianceId: String(corporationInfo.alliance_id),
			allianceName: corporationInfo.name,
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
		const db = this.getDb()
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		return Promise.all(
			characters.map(async (c) => {
				let hasValidToken = c.hasValidToken === true
				try {
					const tokenStatus = await validateAndSyncCharacterTokenValidity({
						db,
						tokenStore,
						characterId: c.characterId,
						previousHasValidToken: c.hasValidToken ?? null,
					})
					hasValidToken = tokenStatus.nextHasValidToken === true
				} catch (error) {
					this.logger.warn('[CoreDO] Failed to validate token while listing user characters', {
						userId,
						characterId: c.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				return {
					characterId: c.characterId,
					characterName: c.characterName,
					hasValidToken,
					isDeleted: c.isDeleted,
					corporationId: c.corporationId,
					corporationName: c.corporationName,
					allianceId: c.allianceId,
					allianceName: c.allianceName,
				}
			})
		)
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

		const corporations = (
			await Promise.all(
				characters.map(async (c) => {
					try {
						const characterInfo = await this.getCharacterInfo(c.characterId)
						if (!characterInfo) {
							return null
						}
						return {
							corporationId: characterInfo.corporation_id,
							corporationName: characterInfo.name,
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

		return corporations
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
						corporationName: info.name,
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

		const alliances = await Promise.all(
			characters.map(async (c) => {
				try {
					const allianceInfo = await this.getCharacterAllianceInfo(c.characterId)
					if (!allianceInfo) {
						return null
					}
					return allianceInfo
				} catch (error) {
					// Same safety rule as corporation resolution: avoid cascading failure
					// from one invalid character token, while never elevating access.
					this.logger.warn('Skipping character during alliance resolution', {
						userId,
						characterId: c.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				}
			})
		)

		return alliances.filter((a): a is NonNullable<typeof a> => a !== null)
	}

	async getUserDiscordUserId(userId: string): Promise<string | null> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
			columns: { discordUserId: true },
		})
		return user?.discordUserId ?? null
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
			const authorCharacterName =
				attributedPrimary?.characterName ??
				(note.legacyCreatedByUserId
					? (legacyActorCharacterNames[note.legacyCreatedByUserId] ?? null)
					: null) ??
				importerCharacterName

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
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

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
		const resolvedNames = idsToResolve.length > 0 ? await tokenStore.resolveIds(idsToResolve) : {}

		return baseRows.map((row) => ({
			...row,
			corporationName: row.corporationId ? (resolvedNames[row.corporationId] ?? row.corporationName) : null,
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
		const buildMatchSet = (rows: Array<{ targetType: string; targetValue: string }>): Set<string> =>
			new Set(
				rows.map((row) => {
					const normalizedValue =
						row.targetType === 'character_name' ? row.targetValue.toLowerCase() : row.targetValue
					return `${row.targetType}:${normalizedValue}`
				})
			)

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
		options?: { source?: string; bypassThrottle?: boolean }
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}> {
		return this.handleCharacterAffiliationChanges([characterId], options)
	}

	async handleCharacterAffiliationChanges(
		characterIds: string[],
		options?: { source?: string; bypassThrottle?: boolean }
	): Promise<{
		usersMatched: number
		workflowsTriggered: number
		discordUsersQueued: number
	}> {
		const normalizedCharacterIds = [...new Set(characterIds.map((id) => String(id)))]
		const uniqueUserIds = await this.resolveUserIdsForCharacterIds(normalizedCharacterIds)
		const db = this.getDb()
		let workflowsTriggered = 0
		const workflowInstanceIdByUserId: Record<string, string> = {}

		for (const userId of uniqueUserIds) {
			const result = await triggerUserRefreshWorkflow({
				db,
				env: this.env,
				userId,
				source: options?.source ?? 'character-affiliation-changed',
				bypassThrottle: options?.bypassThrottle ?? true,
				refreshMode: 'event',
			})
			if (result.triggered) {
				workflowsTriggered++
				if (result.workflowInstanceId) {
					workflowInstanceIdByUserId[userId] = result.workflowInstanceId
				}
			}
		}

		await this.addPendingDiscordRefreshes(uniqueUserIds, {
			source: options?.source ?? 'character-affiliation-changed',
			force: true,
			userRefreshWorkflowInstanceIdByUserId: workflowInstanceIdByUserId,
		})

		return {
			usersMatched: uniqueUserIds.length,
			workflowsTriggered,
			discordUsersQueued: uniqueUserIds.length,
		}
	}

	/**
	 * Add userIds to the pending Discord refresh map.
	 * If a userId already has a non-expired entry (processed or not), it is skipped —
	 * the TTL window acts as the deduplication guard.
	 */
	async addPendingDiscordRefreshes(
		userIds: string[],
		options?: {
			source?: string
			force?: boolean
			userRefreshWorkflowInstanceIdByUserId?: Record<string, string>
		}
	): Promise<{ pendingCount: number; added: number; skipped: number }> {
		const now = Date.now()
		const expiresAt = now + CoreDO.PENDING_TTL_MS
		const source = options?.source ?? 'corp-membership-changed'
		const force = options?.force === true
		const toStore: Record<
			string,
			{
				expiresAt: number
				processed: boolean
				source?: string
				userRefreshWorkflowInstanceId?: string
			}
		> = {}
		const workflowIdByUserId = options?.userRefreshWorkflowInstanceIdByUserId ?? {}
		let added = 0
		let skipped = 0

		for (const userId of userIds) {
			const existing = this.pendingDiscordRefreshes.get(userId)
			if (!force && existing && existing.expiresAt > now) {
				// Still within TTL window — skip
				skipped++
				continue
			}
			const entry = {
				expiresAt,
				processed: false,
				source,
				userRefreshWorkflowInstanceId: workflowIdByUserId[userId],
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

	private async waitForUserRefreshWorkflowCompletion(workflowInstanceId: string): Promise<{
		status: 'completed' | 'completed_with_errors' | 'failed' | 'unknown'
		affiliationChanged: boolean
	}> {
		const POLL_INTERVAL_MS = 1500
		const MAX_WAIT_MS = 60 * 1000
		const startedAt = Date.now()

		try {
			const instance = await this.env.USER_REFRESH_WORKFLOW.get(workflowInstanceId)
			while (Date.now() - startedAt < MAX_WAIT_MS) {
				const status = await instance.status()
				const runState = status.status
				if (runState === 'running' || runState === 'queued' || runState === 'waiting') {
					await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
					continue
				}

				const outputStatus =
					status.output && typeof status.output === 'object' && 'status' in status.output
						? (status.output as { status?: string }).status
						: undefined
				const outputAffiliationChanged =
					status.output &&
					typeof status.output === 'object' &&
					'summary' in status.output &&
					(status.output as { summary?: { affiliationChanged?: number } }).summary
						?.affiliationChanged
				const affiliationChanged =
					typeof outputAffiliationChanged === 'number' && outputAffiliationChanged > 0

				if (
					outputStatus === 'completed' ||
					outputStatus === 'completed_with_errors' ||
					outputStatus === 'failed'
				) {
					return { status: outputStatus, affiliationChanged }
				}

				if (runState === 'complete' && outputStatus === undefined) {
					return { status: 'unknown', affiliationChanged: false }
				}

				if (runState === 'errored') {
					return { status: 'failed', affiliationChanged: false }
				}

				return { status: 'unknown', affiliationChanged: false }
			}
		} catch (error) {
			this.logger.warn('[CoreDO] Failed while waiting for user refresh workflow completion', {
				workflowInstanceId,
				error: error instanceof Error ? error.message : String(error),
			})
			return { status: 'unknown', affiliationChanged: false }
		}

		this.logger.warn('[CoreDO] Timed out waiting for user refresh workflow completion', {
			workflowInstanceId,
			maxWaitMs: MAX_WAIT_MS,
		})
		return { status: 'unknown', affiliationChanged: false }
	}

	/**
	 * Drain the pending set and trigger Discord refresh + user refresh workflows.
	 * Processes in staggered chunks to avoid overwhelming the Discord API.
	 * Called by the scheduled handler (cron).
	 */
	async processPendingDiscordRefreshes(): Promise<{
		processed: number
		triggered: number
		failed: number
	}> {
		const now = Date.now()

		// Prune expired entries from both in-memory map and storage
		const expiredKeys: string[] = []
		for (const [userId, entry] of this.pendingDiscordRefreshes) {
			if (entry.expiresAt <= now) {
				this.pendingDiscordRefreshes.delete(userId)
				expiredKeys.push(`${CoreDO.STORAGE_PREFIX}${userId}`)
			}
		}
		if (expiredKeys.length > 0) {
			await this.state.storage.delete(expiredKeys)
		}

		// Collect unprocessed entries and mark them processed before triggering.
		// Persist the processed flag to storage first so that if the DO is evicted
		// mid-run, a cold-start won't re-trigger the same workflows on the next cron.
		const toProcess: string[] = []
		const toStore: Record<
			string,
			{
				expiresAt: number
				processed: boolean
				source?: string
				userRefreshWorkflowInstanceId?: string
			}
		> = {}
		const sourceByUserId = new Map<string, string>()
		for (const [userId, entry] of this.pendingDiscordRefreshes) {
			if (!entry.processed) {
				entry.processed = true
				toProcess.push(userId)
				sourceByUserId.set(userId, entry.source ?? 'corp-membership-changed')
				toStore[`${CoreDO.STORAGE_PREFIX}${userId}`] = entry
			}
		}

		if (toProcess.length === 0) {
			return { processed: 0, triggered: 0, failed: 0 }
		}

		await this.state.storage.put(toStore)

		this.logger.info('[CoreDO] Processing pending Discord refreshes', { count: toProcess.length })

		const userIds = toProcess

		const db = this.getDb()
		// Spread workflows across a 10-minute window using per-workflow jitter,
		// matching the orchestrator's approach. All workflows are created immediately;
		// each sleeps for its own random duration before executing.
		const JITTER_MAX_SECONDS = 600

		const results = await Promise.allSettled(
			userIds.map(async (userId) => {
				const pendingEntry = this.pendingDiscordRefreshes.get(userId)
				const preRefreshUser = await db.query.users.findFirst({
					where: eq(users.id, userId),
					columns: { discordUserId: true },
				})
				const hadLinkedDiscordBeforeRefresh = !!preRefreshUser?.discordUserId

				const preTriggeredWorkflowInstanceId = pendingEntry?.userRefreshWorkflowInstanceId
				const userRefreshResult = preTriggeredWorkflowInstanceId
					? {
							status: 'already-triggered',
							triggered: true,
							workflowInstanceId: preTriggeredWorkflowInstanceId,
							error: undefined,
						}
					: await triggerUserRefreshWorkflow({
							db,
							env: this.env,
							userId,
							source: sourceByUserId.get(userId) ?? 'corp-membership-changed',
							bypassThrottle: true,
							refreshMode: 'event',
						})

				if (userRefreshResult.status === 'failed' || !userRefreshResult.triggered) {
					return {
						userId,
						userRefreshResult,
						discordResult: null,
						skippedNoDiscord: false,
						precheckedNoDiscord: !hadLinkedDiscordBeforeRefresh,
						userRefreshCompletionStatus: 'unknown' as const,
						affiliationChanged: false,
					}
				}

				let userRefreshCompletionStatus:
					| 'completed'
					| 'completed_with_errors'
					| 'failed'
					| 'unknown' = 'unknown'
				let affiliationChanged = false
				if (userRefreshResult.workflowInstanceId) {
					const completion = await this.waitForUserRefreshWorkflowCompletion(
						userRefreshResult.workflowInstanceId
					)
					userRefreshCompletionStatus = completion.status
					affiliationChanged = completion.affiliationChanged
				}

				if (!hadLinkedDiscordBeforeRefresh) {
					await this.evictPendingDiscordRefresh(userId, 'no-linked-discord-after-user-refresh')
					return {
						userId,
						userRefreshResult,
						discordResult: null,
						skippedNoDiscord: true,
						precheckedNoDiscord: true,
						userRefreshCompletionStatus,
						affiliationChanged,
					}
				}

				if (!affiliationChanged) {
					await this.evictPendingDiscordRefresh(
						userId,
						'no-core-affiliation-change-after-user-refresh'
					)
					return {
						userId,
						userRefreshResult,
						discordResult: null,
						skippedNoDiscord: false,
						precheckedNoDiscord: false,
						userRefreshCompletionStatus,
						affiliationChanged,
					}
				}

				const jitterDelaySeconds = Math.floor(Math.random() * JITTER_MAX_SECONDS)
				const source = sourceByUserId.get(userId) ?? 'corp-membership-changed'
				const hardStripAllRoles =
					source === 'corp-member-flag-disabled' ||
					source === 'corp-discord-attachment-detached-none-remaining' ||
					source === 'corp-admin-refresh-no-attachments'
				const discordResult = await triggerDiscordRefreshWorkflow({
					env: this.env,
					userId,
					source,
					allowRemoval: true,
					hardStripAllRoles,
					jitterDelaySeconds,
				})

				return {
					userId,
					userRefreshResult,
					discordResult,
					skippedNoDiscord: false,
					precheckedNoDiscord: false,
					userRefreshCompletionStatus,
					affiliationChanged,
				}
			})
		)

		let triggeredCount = 0
		let failedCount = 0

		for (const result of results) {
			if (result.status === 'rejected') {
				// Unexpected — the per-user async fn should not throw
				failedCount++
				this.logger.error('[CoreDO] Unexpected error triggering workflows for user', {
					error: result.reason instanceof Error ? result.reason.message : String(result.reason),
				})
				continue
			}
			const {
				userId,
				discordResult,
				userRefreshResult,
				skippedNoDiscord,
				precheckedNoDiscord,
				userRefreshCompletionStatus,
				affiliationChanged,
			} = result.value
			const refreshOk = userRefreshResult.triggered
			const discordOk = !!discordResult?.triggered
			if (discordOk || refreshOk) {
				triggeredCount++
			} else {
				failedCount++
				this.logger.error('[CoreDO] Failed to trigger workflows for user', {
					userId,
					discord: discordResult?.status ?? 'skipped',
					userRefresh: userRefreshResult.status,
					skippedNoDiscord,
					precheckedNoDiscord,
					userRefreshCompletionStatus,
					affiliationChanged,
				})
			}
		}

		this.logger.info('[CoreDO] Pending Discord refreshes complete', {
			processed: userIds.length,
			triggered: triggeredCount,
			failed: failedCount,
		})

		return { processed: userIds.length, triggered: triggeredCount, failed: failedCount }
	}
}
