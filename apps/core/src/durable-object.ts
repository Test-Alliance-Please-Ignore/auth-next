import { DurableObject } from 'cloudflare:workers'

import { CORE_ROLES, SERVICE_CORE } from '@repo/core'
import { and, asc, eq, inArray, isNull, lt, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter, getEsiInstanceForCorporation } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { userCharacters, users } from './db/schema'
import { triggerDiscordRefreshWorkflow, triggerUserRefreshWorkflow } from './lib/workflow-triggers'

import type { Core } from '@repo/core'
import type { CharacterPublicInfo } from '@repo/esi'
import type { CreateRoleRequest, Groups } from '@repo/groups'
import type { Env } from './context'

export class CoreDO extends DurableObject<Env> implements Core {
	private readonly logger = logger.withTags({ service: 'core-durable-object' })

	/**
	 * In-memory map of userIds pending Discord refresh.
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
	private pendingDiscordRefreshes = new Map<string, { expiresAt: number; processed: boolean }>()
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
		const stored = await this.state.storage.list<{ expiresAt: number; processed: boolean }>({
			prefix: CoreDO.STORAGE_PREFIX,
		})
		for (const [key, value] of stored) {
			const userId = key.slice(CoreDO.STORAGE_PREFIX.length)
			this.pendingDiscordRefreshes.set(userId, value)
		}
		this.logger.info('[CoreDO] Loaded pending Discord refreshes from storage', {
			count: this.pendingDiscordRefreshes.size,
		})
	}

	private getDb(): ReturnType<typeof createDb> {
		return createDb(this.env.DATABASE_URL)
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
			isDeleted: c.isDeleted,
			corporationId: c.corporationId,
			corporationName: c.corporationName,
			allianceId: c.allianceId,
			allianceName: c.allianceName,
		}))
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
		throw new Error('Not implemented')
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
		await this.getDb()
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date() })
			.where(inArray(users.id, userIds))

		return userIds
	}

	/**
	 * Add userIds to the pending Discord refresh map.
	 * If a userId already has a non-expired entry (processed or not), it is skipped —
	 * the TTL window acts as the deduplication guard.
	 */
	async addPendingDiscordRefreshes(userIds: string[]): Promise<{ pendingCount: number }> {
		const now = Date.now()
		const expiresAt = now + CoreDO.PENDING_TTL_MS
		const toStore: Record<string, { expiresAt: number; processed: boolean }> = {}
		let added = 0

		for (const userId of userIds) {
			const existing = this.pendingDiscordRefreshes.get(userId)
			if (existing && existing.expiresAt > now) {
				// Still within TTL window — skip
				continue
			}
			const entry = { expiresAt, processed: false }
			this.pendingDiscordRefreshes.set(userId, entry)
			toStore[`${CoreDO.STORAGE_PREFIX}${userId}`] = entry
			added++
		}

		if (added > 0) {
			await this.state.storage.put(toStore)
		}

		this.logger.info('[CoreDO] Added pending Discord refreshes', {
			added,
			skipped: userIds.length - added,
			pendingCount: this.pendingDiscordRefreshes.size,
		})

		return { pendingCount: this.pendingDiscordRefreshes.size }
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
		const toStore: Record<string, { expiresAt: number; processed: boolean }> = {}
		for (const [userId, entry] of this.pendingDiscordRefreshes) {
			if (!entry.processed) {
				entry.processed = true
				toProcess.push(userId)
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
				const jitterDelaySeconds = Math.floor(Math.random() * JITTER_MAX_SECONDS)

				const [discordResult, userRefreshResult] = await Promise.allSettled([
					triggerDiscordRefreshWorkflow({
						env: this.env,
						userId,
						source: 'corp-membership-changed',
						allowRemoval: true,
						jitterDelaySeconds,
					}),
					triggerUserRefreshWorkflow({
						db,
						env: this.env,
						userId,
						source: 'corp-membership-changed',
						bypassThrottle: true,
						refreshMode: 'event',
					}),
				])

				return { userId, discordResult, userRefreshResult }
			})
		)

		let triggeredCount = 0
		let failedCount = 0

		for (const result of results) {
			if (result.status === 'rejected') {
				// Unexpected — the per-user async fn should not throw
				failedCount++
				this.logger.error('[CoreDO] Unexpected error triggering workflows for user', {
					error:
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason),
				})
				continue
			}
			const { userId, discordResult, userRefreshResult } = result.value
			const discordOk = discordResult.status === 'fulfilled' && discordResult.value.triggered
			const refreshOk =
				userRefreshResult.status === 'fulfilled' && userRefreshResult.value.triggered
			if (discordOk || refreshOk) {
				triggeredCount++
			} else {
				failedCount++
				this.logger.error('[CoreDO] Failed to trigger workflows for user', {
					userId,
					discord: discordResult.status === 'fulfilled' ? discordResult.value.status : 'rejected',
					userRefresh:
						userRefreshResult.status === 'fulfilled'
							? userRefreshResult.value.status
							: 'rejected',
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
