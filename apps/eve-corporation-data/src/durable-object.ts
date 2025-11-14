import { DurableObject } from 'cloudflare:workers'

import { and, coalesce, desc, eq, inArray, lte, notInArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import {
	characterCorporationRoles,
	corporationAssets,
	corporationConfig,
	corporationContracts,
	corporationIndustryJobs,
	corporationKillmails,
	corporationMembers,
	corporationMemberTracking,
	corporationOrders,
	corporationPublicInfo,
	corporationStructures,
	corporationWalletJournal,
	corporationWallets,
	corporationWalletTransactions,
} from './db/schema'
import { DirectorManager } from './services/director-manager'
import * as esiFetch from './services/esi-fetch'

import type {
	CharacterCorporationRolesData,
	CorporationAccessVerification,
	CorporationAssetData,
	CorporationAssetsData,
	CorporationConfigData,
	CorporationContractData,
	CorporationCoreData,
	CorporationFinancialData,
	CorporationIndustryJobData,
	CorporationKillmailData,
	CorporationMarketData,
	CorporationMemberData,
	CorporationMemberTrackingData,
	CorporationNeedingRefreshData,
	CorporationOrderData,
	CorporationPublicData,
	CorporationRole,
	CorporationStructureData,
	CorporationType,
	CorporationWalletData,
	CorporationWalletJournalData,
	CorporationWalletTransactionData,
	DirectorHealth,
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EveCorporationData,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

type CorporationConfigRow = typeof corporationConfig.$inferSelect

function minutesAgo(minutes: number): Date {
	return new Date(Date.now() - minutes * 60 * 1000)
}

/**
 * EveCorporationData Durable Object
 *
 * Each corporation gets its own Durable Object instance for data isolation.
 * Uses PostgreSQL for persistent storage and eve-token-store for ESI access.
 *
 * Instance ID pattern: `{corporationId}`
 * Example: `98000001`
 */
export class EveCorporationDataDO extends DurableObject<Env> implements EveCorporationData {
	private db: ReturnType<typeof createDb>
	private readonly DIRECTORS_CACHE_TTL = 30 * 60 // 30 minutes in seconds (KV expirationTtl)

	/**
	 * Initialize the Durable Object with database connection
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	/**
	 * Get a stub for the EveTokenStore Durable Object
	 */
	private getEveTokenStoreStub() {
		return getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
	}

	/**
	 * Invalidate directors cache for a corporation
	 */
	private async invalidateDirectorsCache(corporationId: string): Promise<void> {
		const cacheKey = `directors:${corporationId}`
		try {
			await this.env.CACHE.delete(cacheKey)
		} catch (error) {
			logger.warn('[Directors Cache] Failed to invalidate cache', { corporationId, error })
		}
	}

	/**
	 * Invalidate members cache for a corporation
	 */
	private async invalidateMembersCache(corporationId: string): Promise<void> {
		const cacheKey = `members:${corporationId}`
		try {
			await this.env.CACHE.delete(cacheKey)
		} catch (error) {
			logger.warn('[Members Cache] Failed to invalidate cache', { corporationId, error })
		}
	}

	/**
	 * Get the configured character ID for this corporation
	 * @deprecated Use DirectorManager.selectDirector() instead for multi-director support
	 * @throws Error if corporation not configured
	 */
	private async getConfiguredCharacter(
		corporationId: string
	): Promise<{ characterId: string; corporationId: string }> {
		// Try to get a healthy director first
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const directorManager = new DirectorManager(
			this.db,

			config.corporationId,

			tokenStoreStub
		)

		const director = await directorManager.selectDirector()

		if (!director) {
			throw new Error('No healthy directors available. Please add or verify directors.')
		}

		return {
			characterId: director.characterId,
			corporationId: config.corporationId,
		}
	}

	/**
	 * Get DirectorManager instance for this corporation
	 */
	private async getDirectorManager(): Promise<DirectorManager> {
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		return new DirectorManager(this.db, config.corporationId, tokenStoreStub)
	}

	/**
	 * Check if character has a required role
	 */
	private async hasRequiredRole(
		characterId: string,
		requiredRole: CorporationRole
	): Promise<boolean> {
		const rolesData = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, characterId),
		})

		if (!rolesData) {
			return false
		}

		// Check all role types
		const allRoles = [
			...(rolesData.roles || []),
			...(rolesData.rolesAtHq || []),
			...(rolesData.rolesAtBase || []),
			...(rolesData.rolesAtOther || []),
		]

		return allRoles.includes(requiredRole)
	}

	/**
	 * Verify character has one of the required roles
	 */
	private async verifyRole(characterId: string, roles: CorporationRole[]): Promise<void> {
		for (const role of roles) {
			if (await this.hasRequiredRole(characterId, role)) {
				return // Has at least one required role
			}
		}

		throw new Error(`Character lacks required role(s): ${roles.join(', ')}`)
	}

	// ========================================================================
	// CONFIGURATION METHODS
	// ========================================================================

	async getCorporationsNeedingRefresh(): Promise<CorporationNeedingRefreshData> {
		const tooOld = minutesAgo(20)
		const transformConfig = (config: CorporationConfigRow): CorporationConfigData => ({
			...config,
			characterId: '',
			characterName: '',
			corporationType: config.corporationType as CorporationType,
			membersLastSync: config.membersLastSync ?? null,
			memberTrackingLastSync: config.memberTrackingLastSync ?? null,
			walletsLastSync: config.walletsLastSync ?? null,
			walletJournalLastSync: config.walletJournalLastSync ?? null,
			walletTransactionsLastSync: config.walletTransactionsLastSync ?? null,
			assetsLastSync: config.assetsLastSync ?? null,
			structuresLastSync: config.structuresLastSync ?? null,
			ordersLastSync: config.ordersLastSync ?? null,
			contractsLastSync: config.contractsLastSync ?? null,
			industryJobsLastSync: config.industryJobsLastSync ?? null,
			killmailsLastSync: config.killmailsLastSync ?? null,
		})

		const results: CorporationNeedingRefreshData = {
			members: [],
			'member-tracking': [],
			wallets: [],
			'wallet-journal': [],
			'wallet-transactions': [],
			assets: [],
			structures: [],
			orders: [],
			contracts: [],
			'industry-jobs': [],
			killmails: [],
		}

		const configs = await this.db.query.corporationConfig.findMany({
			where: and(eq(corporationConfig.includeInBackgroundRefresh, true)),
		})

		const syncTargets = [
			{ bucket: 'members' as const, field: 'membersLastSync' as const },
			{ bucket: 'member-tracking' as const, field: 'memberTrackingLastSync' as const },
			{ bucket: 'wallets' as const, field: 'walletsLastSync' as const },
			{ bucket: 'wallet-journal' as const, field: 'walletJournalLastSync' as const },
			{ bucket: 'wallet-transactions' as const, field: 'walletTransactionsLastSync' as const },
			{ bucket: 'assets' as const, field: 'assetsLastSync' as const },
			{ bucket: 'structures' as const, field: 'structuresLastSync' as const },
			{ bucket: 'orders' as const, field: 'ordersLastSync' as const },
			{ bucket: 'contracts' as const, field: 'contractsLastSync' as const },
			{ bucket: 'industry-jobs' as const, field: 'industryJobsLastSync' as const },
			{ bucket: 'killmails' as const, field: 'killmailsLastSync' as const },
		]

		const isStale = (lastSync: Date | null | undefined, cutoff: Date) =>
			!lastSync || lastSync < cutoff

		for (const corp of configs) {
			const transformed = transformConfig(corp)

			for (const { bucket, field } of syncTargets) {
				if (isStale(corp[field], tooOld)) {
					results[bucket].push(transformed)
				}
			}
		}

		logger.info('[EveCorporationData] getCorporationsNeedingRefresh: Results', { results })

		return results
	}

	/**
	 * Update corporation configuration settings
	 */
	async updateCorporationConfig(
		corporationId: string,
		updates: { includeInBackgroundRefresh?: boolean }
	): Promise<void> {
		// Ensure corporation config exists
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.db.insert(corporationConfig).values({
				corporationId: String(corporationId),
				isVerified: false,
				lastVerified: null,
				includeInBackgroundRefresh: updates.includeInBackgroundRefresh ?? false,
				updatedAt: new Date(),
			})
		} else {
			// Update existing config
			await this.db
				.update(corporationConfig)
				.set({
					...(updates.includeInBackgroundRefresh !== undefined && {
						includeInBackgroundRefresh: updates.includeInBackgroundRefresh,
					}),
					updatedAt: new Date(),
				})
				.where(eq(corporationConfig.corporationId, corporationId))
		}

		logger.info('[EveCorporationData] Updated corporation config', {
			corporationId,
			updates,
		})
	}

	/**
	 * Configure which character to use for API access (legacy method for backwards compatibility)
	 * @deprecated Use addDirector() instead
	 */
	async setCharacter(
		corporationId: string,
		characterId: string,
		characterName: string
	): Promise<void> {
		// Ensure corporation config exists
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			await this.db.insert(corporationConfig).values({
				corporationId: String(corporationId),
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)

		// Check if director already exists
		const directors = await directorManager.getAllDirectors()
		const existingDirector = directors.find((d) => d.characterId === characterId)

		if (!existingDirector) {
			await directorManager.addDirector(characterId, characterName, 100)
		}
	}

	/**
	 * Get the configured character for this corporation
	 * @deprecated Use getDirectors() instead for multi-director support
	 */
	async getConfiguration(): Promise<CorporationConfigData | null> {
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			return null
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, config.corporationId, tokenStoreStub)
		const directors = await directorManager.getAllDirectors()
		const primaryDirector = directors[0] // First director by priority

		return {
			corporationId: config.corporationId,
			characterId: primaryDirector?.characterId || '',
			characterName: primaryDirector?.characterName || '',
			lastVerified: config.lastVerified,
			isVerified: config.isVerified,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
			includeInBackgroundRefresh: config.includeInBackgroundRefresh,
			corporationType: config.corporationType as CorporationType,
			membersLastSync: config.membersLastSync,
			memberTrackingLastSync: config.memberTrackingLastSync,
			walletsLastSync: config.walletsLastSync,
			walletJournalLastSync: config.walletJournalLastSync,
			walletTransactionsLastSync: config.walletTransactionsLastSync,
			assetsLastSync: config.assetsLastSync,
			structuresLastSync: config.structuresLastSync,
			ordersLastSync: config.ordersLastSync,
			contractsLastSync: config.contractsLastSync,
			industryJobsLastSync: config.industryJobsLastSync,
			killmailsLastSync: config.killmailsLastSync,
		}
	}

	/**
	 * Verify that the configured character has access to corporation data
	 * @deprecated Use verifyAllDirectorsHealth() instead for multi-director support
	 */
	async verifyAccess(): Promise<CorporationAccessVerification> {
		console.log('[EveCorporationData] verifyAccess: Starting verification')
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			console.log('[EveCorporationData] verifyAccess: No configuration found')
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				lastVerified: null,
			}
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, config.corporationId, tokenStoreStub)
		const result = await directorManager.verifyAllDirectorsHealth()

		console.log('[EveCorporationData] verifyAccess: Verification complete', {
			verified: result.verified,
			failed: result.failed,
		})

		// Get the first healthy director for backwards compatibility
		const healthyDirectors = await directorManager.getHealthyDirectors()
		const primaryDirector = healthyDirectors[0]

		if (!primaryDirector) {
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				lastVerified: config.lastVerified,
			}
		}

		// Get roles for the primary director
		const rolesData = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, primaryDirector.characterId),
		})

		const verifiedRoles = rolesData
			? [
					...(rolesData.roles || []),
					...(rolesData.rolesAtHq || []),
					...(rolesData.rolesAtBase || []),
					...(rolesData.rolesAtOther || []),
				]
			: []

		return {
			hasAccess: result.verified > 0,
			characterId: primaryDirector.characterId,
			characterName: primaryDirector.characterName,
			verifiedRoles,
			lastVerified: config.lastVerified,
		}
	}

	// ========================================================================
	// DIRECTOR MANAGEMENT METHODS
	// ========================================================================

	/**
	 * Add a new director character for this corporation
	 */
	async addDirector(
		corporationId: string,
		characterId: string,
		characterName: string,
		priority = 100
	): Promise<void> {
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.db.insert(corporationConfig).values({
				corporationId: String(corporationId),
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		await directorManager.addDirector(characterId, characterName, priority)

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Remove a director character from this corporation
	 */
	async removeDirector(corporationId: string, characterId: string): Promise<void> {
		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		await directorManager.removeDirector(characterId)

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Update a director's priority
	 */
	async updateDirectorPriority(
		corporationId: string,
		characterId: string,
		priority: number
	): Promise<void> {
		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		await directorManager.updateDirectorPriority(characterId, priority)

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Get all directors for this corporation
	 * Cached in KV for 30 minutes to reduce database queries
	 */
	async getDirectors(corporationId: string): Promise<DirectorHealth[]> {
		const cacheKey = `directors:${corporationId}`

		// Check KV cache first
		try {
			const cached = await this.env.CACHE.get<DirectorHealth[]>(cacheKey, 'json')
			if (cached) {
				// Convert Date fields from strings back to Date objects
				return cached.map((d) => ({
					...d,
					lastHealthCheck: d.lastHealthCheck ? new Date(d.lastHealthCheck) : null,
					lastUsed: d.lastUsed ? new Date(d.lastUsed) : null,
				}))
			}
		} catch (error) {
			// Cache read failure - log but continue to fetch from DB
			logger.warn('[Directors Cache] Failed to read from KV', { corporationId, error })
		}

		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		const directors = await directorManager.getAllDirectors()

		// Store in KV cache with 30 minute TTL
		try {
			await this.env.CACHE.put(cacheKey, JSON.stringify(directors), {
				expirationTtl: this.DIRECTORS_CACHE_TTL,
			})
		} catch (error) {
			// Cache write failure - log but don't fail the request
			logger.warn('[Directors Cache] Failed to write to KV', { corporationId, error })
		}

		return directors
	}

	/**
	 * Get healthy directors for this corporation
	 */
	async getHealthyDirectors(corporationId: string): Promise<DirectorHealth[]> {
		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		return await directorManager.getHealthyDirectors()
	}

	/**
	 * Verify health of a specific director
	 */
	async verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean> {
		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		return await directorManager.verifyDirectorHealth(directorId)
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(
		corporationId: string
	): Promise<{ verified: number; failed: number }> {
		using tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(this.db, corporationId, tokenStoreStub)
		return await directorManager.verifyAllDirectorsHealth()
	}

	// ========================================================================
	// STORAGE-ONLY METHODS (public) - For use by workflows
	// ========================================================================

	/**
	 * Store public corporation info (workflow-friendly)
	 * Takes pre-fetched data and stores it in the database
	 */
	async storePublicInfo(corporationId: string, publicInfo: any): Promise<void> {
		await this.db
			.insert(corporationPublicInfo)
			.values({
				...publicInfo,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: corporationPublicInfo.corporationId,
				set: {
					name: publicInfo.name,
					ticker: publicInfo.ticker,
					ceoId: publicInfo.ceoId,
					memberCount: publicInfo.memberCount,
					shares: publicInfo.shares,
					taxRate: publicInfo.taxRate,
					url: publicInfo.url,
					allianceId: publicInfo.allianceId,
					factionId: publicInfo.factionId,
					warEligible: publicInfo.warEligible,
					updatedAt: sql`excluded.updated_at`,
				},
			})
	}

	/**
	 * Store corporation members (workflow-friendly)
	 * Handles member additions, updates, and departures
	 * Returns IDs of departed members for HR processing
	 */
	async storeMembers(
		corporationId: string,
		memberIds: string[]
	): Promise<{ departedMemberIds: string[] }> {
		// Fetch existing members to identify departures
		const existingMembers = await this.db
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		const existingMemberIds = new Set(existingMembers.map((m) => m.characterId))
		const currentMemberIds = new Set(memberIds)

		// Identify departed members
		const departedMemberIds = existingMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		try {
			// Remove departed members
			if (departedMemberIds.length > 0) {
				await this.db
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				// Also remove from tracking table
				await this.db
					.delete(corporationMemberTracking)
					.where(
						and(
							eq(corporationMemberTracking.corporationId, corporationId),
							inArray(corporationMemberTracking.characterId, departedMemberIds)
						)
					)

				logger.debug('[storeMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
				})
			}

			// Upsert current members
			if (memberIds.length > 0) {
				const values = memberIds.map((memberId) => ({
					corporationId: String(corporationId),
					characterId: memberId,
				}))

				await this.db
					.insert(corporationMembers)
					.values(values)
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})
			}

			// Invalidate cache
			await this.invalidateMembersCache(corporationId)

			return { departedMemberIds }
		} catch (error) {
			logger.error('[storeMembers] Database operation failed:', {
				error,
				corporationId,
				memberCount: memberIds.length,
			})
			throw error
		}
	}

	/**
	 * Store member tracking data (workflow-friendly)
	 */
	async storeMemberTracking(
		corporationId: string,
		trackingData: Array<{
			character_id: string
			base_id?: string
			location_id?: string
			logoff_date?: string
			logon_date?: string
			ship_type_id?: string
			start_date?: string
		}>
	): Promise<void> {
		// Identify departed members
		const existingTracking = await this.db
			.select({ characterId: corporationMemberTracking.characterId })
			.from(corporationMemberTracking)
			.where(eq(corporationMemberTracking.corporationId, corporationId))

		const currentTrackingIds = new Set(trackingData.map((m) => m.character_id))
		const departedMemberIds = existingTracking
			.filter((m) => !currentTrackingIds.has(m.characterId))
			.map((m) => m.characterId)

		// Remove departed members
		if (departedMemberIds.length > 0) {
			await this.db
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.corporationId, corporationId),
						inArray(corporationMemberTracking.characterId, departedMemberIds)
					)
				)
		}

		// Upsert tracking data
		for (const member of trackingData) {
			await this.db
				.insert(corporationMemberTracking)
				.values({
					corporationId: String(corporationId),
					characterId: member.character_id,
					baseId: member.base_id || null,
					locationId: member.location_id || null,
					logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
					logonDate: member.logon_date ? new Date(member.logon_date) : null,
					shipTypeId: member.ship_type_id || null,
					startDate: member.start_date ? new Date(member.start_date) : null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: member.base_id || null,
						locationId: member.location_id || null,
						logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
						logonDate: member.logon_date ? new Date(member.logon_date) : null,
						shipTypeId: member.ship_type_id || null,
						startDate: member.start_date ? new Date(member.start_date) : null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallets data (workflow-friendly)
	 */
	async storeWallets(
		corporationId: string,
		wallets: Array<{ division: number; balance: string }>
	): Promise<void> {
		for (const wallet of wallets) {
			await this.db
				.insert(corporationWallets)
				.values({
					corporationId: String(corporationId),
					division: wallet.division,
					balance: wallet.balance,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: wallet.balance,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallet journal entries (workflow-friendly)
	 */
	async storeWalletJournal(corporationId: string, division: number, entries: any[]): Promise<void> {
		const BATCH_SIZE = 25
		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			const batch = entries.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((entry) => ({
				corporationId: String(corporationId),
				division,
				journalId: String(entry.id),
				amount: entry.amount !== undefined ? String(entry.amount) : null,
				balance: entry.balance !== undefined ? String(entry.balance) : null,
				contextId: entry.context_id ? String(entry.context_id) : null,
				contextIdType: entry.context_id_type || null,
				date: new Date(entry.date),
				description: entry.description,
				firstPartyId: entry.first_party_id ? String(entry.first_party_id) : null,
				reason: entry.reason || null,
				refType: entry.ref_type,
				secondPartyId: entry.second_party_id ? String(entry.second_party_id) : null,
				tax: entry.tax !== undefined ? String(entry.tax) : null,
				taxReceiverId: entry.tax_receiver_id ? String(entry.tax_receiver_id) : null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationWalletJournal)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [
						corporationWalletJournal.corporationId,
						corporationWalletJournal.division,
						corporationWalletJournal.journalId,
					],
					set: {
						amount: sql`excluded.amount`,
						balance: sql`excluded.balance`,
						contextId: sql`excluded.context_id`,
						contextIdType: sql`excluded.context_id_type`,
						description: sql`excluded.description`,
						reason: sql`excluded.reason`,
						tax: sql`excluded.tax`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallet transactions (workflow-friendly)
	 */
	async storeWalletTransactions(
		corporationId: string,
		division: number,
		transactions: any[]
	): Promise<void> {
		const BATCH_SIZE = 25
		for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
			const batch = transactions.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((tx) => ({
				corporationId: String(corporationId),
				division,
				transactionId: tx.transaction_id,
				clientId: tx.client_id,
				date: new Date(tx.date),
				isBuy: tx.is_buy,
				isPersonal: tx.is_personal,
				journalRefId: tx.journal_ref_id,
				locationId: tx.location_id,
				quantity: tx.quantity,
				typeId: tx.type_id,
				unitPrice: tx.unit_price,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationWalletTransactions)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [
						corporationWalletTransactions.corporationId,
						corporationWalletTransactions.division,
						corporationWalletTransactions.transactionId,
					],
					set: {
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store assets (workflow-friendly)
	 */
	async storeAssets(corporationId: string, assets: any[]): Promise<void> {
		const BATCH_SIZE = 25
		for (let i = 0; i < assets.length; i += BATCH_SIZE) {
			const batch = assets.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((asset) => ({
				corporationId: String(corporationId),
				itemId: asset.item_id,
				isSingleton: asset.is_singleton,
				locationFlag: asset.location_flag,
				locationId: asset.location_id,
				locationType: asset.location_type,
				quantity: asset.quantity,
				typeId: asset.type_id,
				isBlueprintCopy: asset.is_blueprint_copy,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationAssets)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationAssets.corporationId, corporationAssets.itemId],
					set: {
						isSingleton: sql`excluded.is_singleton`,
						locationFlag: sql`excluded.location_flag`,
						locationId: sql`excluded.location_id`,
						locationType: sql`excluded.location_type`,
						quantity: sql`excluded.quantity`,
						typeId: sql`excluded.type_id`,
						isBlueprintCopy: sql`excluded.is_blueprint_copy`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store structures (workflow-friendly)
	 */
	async storeStructures(corporationId: string, structures: any[]): Promise<void> {
		const BATCH_SIZE = 10
		for (let i = 0; i < structures.length; i += BATCH_SIZE) {
			const batch = structures.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((structure) => ({
				corporationId: String(corporationId),
				structureId: structure.structure_id,
				typeId: structure.type_id,
				systemId: structure.system_id,
				profileId: structure.profile_id,
				fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
				nextReinforceApply: structure.next_reinforce_apply
					? new Date(structure.next_reinforce_apply)
					: null,
				nextReinforceHour: structure.next_reinforce_hour ?? null,
				reinforceHour: structure.reinforce_hour ?? null,
				state: structure.state,
				stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
				stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
				unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
				services: structure.services || null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationStructures)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationStructures.corporationId, corporationStructures.structureId],
					set: {
						state: sql`excluded.state`,
						fuelExpires: sql`excluded.fuel_expires`,
						nextReinforceApply: sql`excluded.next_reinforce_apply`,
						nextReinforceHour: sql`excluded.next_reinforce_hour`,
						reinforceHour: sql`excluded.reinforce_hour`,
						stateTimerEnd: sql`excluded.state_timer_end`,
						stateTimerStart: sql`excluded.state_timer_start`,
						unanchorsAt: sql`excluded.unanchors_at`,
						services: sql`excluded.services`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store market orders (workflow-friendly)
	 */
	async storeOrders(corporationId: string, orders: any[]): Promise<void> {
		const BATCH_SIZE = 25
		for (let i = 0; i < orders.length; i += BATCH_SIZE) {
			const batch = orders.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((order) => ({
				corporationId: String(corporationId),
				orderId: order.order_id,
				duration: order.duration,
				escrow: order.escrow?.toString() || null,
				isBuyOrder: order.is_buy_order,
				issued: new Date(order.issued),
				issuedBy: order.issued_by,
				locationId: order.location_id,
				minVolume: order.min_volume ?? null,
				price: order.price.toString(),
				range: order.range,
				regionId: order.region_id,
				typeId: order.type_id,
				volumeRemain: order.volume_remain,
				volumeTotal: order.volume_total,
				walletDivision: order.wallet_division,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationOrders)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationOrders.corporationId, corporationOrders.orderId],
					set: {
						volumeRemain: sql`excluded.volume_remain`,
						price: sql`excluded.price`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store contracts (workflow-friendly)
	 */
	async storeContracts(corporationId: string, contracts: any[]): Promise<void> {
		const BATCH_SIZE = 20
		for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
			const batch = contracts.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((contract) => ({
				corporationId: String(corporationId),
				contractId: contract.contract_id,
				acceptorId: contract.acceptor_id || null,
				assigneeId: contract.assignee_id,
				availability: contract.availability,
				buyout: contract.buyout?.toString() || null,
				collateral: contract.collateral?.toString() || null,
				dateAccepted: contract.date_accepted ? new Date(contract.date_accepted) : null,
				dateCompleted: contract.date_completed ? new Date(contract.date_completed) : null,
				dateExpired: new Date(contract.date_expired),
				dateIssued: new Date(contract.date_issued),
				daysToComplete: contract.days_to_complete ?? null,
				endLocationId: contract.end_location_id || null,
				forCorporation: contract.for_corporation,
				issuerCorporationId: contract.issuer_corporation_id,
				issuerId: contract.issuer_id,
				price: contract.price?.toString() || null,
				reward: contract.reward?.toString() || null,
				startLocationId: contract.start_location_id || null,
				status: contract.status,
				title: contract.title || null,
				type: contract.type,
				volume: contract.volume?.toString() || null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationContracts)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationContracts.corporationId, corporationContracts.contractId],
					set: {
						status: sql`excluded.status`,
						dateAccepted: sql`excluded.date_accepted`,
						dateCompleted: sql`excluded.date_completed`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store industry jobs (workflow-friendly)
	 */
	async storeIndustryJobs(corporationId: string, jobs: any[]): Promise<void> {
		const BATCH_SIZE = 20
		for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
			const batch = jobs.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((job) => ({
				corporationId: String(corporationId),
				jobId: job.job_id,
				installerId: job.installer_id,
				facilityId: job.facility_id,
				locationId: job.location_id,
				activityId: job.activity_id,
				blueprintId: job.blueprint_id,
				blueprintTypeId: job.blueprint_type_id,
				blueprintLocationId: job.blueprint_location_id,
				outputLocationId: job.output_location_id,
				runs: job.runs,
				cost: job.cost?.toString() || null,
				licensedRuns: job.licensed_runs ?? null,
				probability: job.probability?.toString() || null,
				productTypeId: job.product_type_id || null,
				status: job.status,
				duration: job.duration,
				startDate: new Date(job.start_date),
				endDate: new Date(job.end_date),
				pauseDate: job.pause_date ? new Date(job.pause_date) : null,
				completedDate: job.completed_date ? new Date(job.completed_date) : null,
				completedCharacterId: job.completed_character_id || null,
				successfulRuns: job.successful_runs ?? null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationIndustryJobs)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationIndustryJobs.corporationId, corporationIndustryJobs.jobId],
					set: {
						status: sql`excluded.status`,
						pauseDate: sql`excluded.pause_date`,
						completedDate: sql`excluded.completed_date`,
						completedCharacterId: sql`excluded.completed_character_id`,
						successfulRuns: sql`excluded.successful_runs`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store killmails (workflow-friendly)
	 */
	async storeKillmails(corporationId: string, killmails: any[]): Promise<void> {
		const BATCH_SIZE = 50
		for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
			const batch = killmails.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((km) => ({
				corporationId: String(corporationId),
				killmailId: km.killmail_id,
				killmailHash: km.killmail_hash,
				killmailTime: new Date(),
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationKillmails)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	// ========================================================================
	// FETCH AND STORE METHODS (private)
	// ========================================================================

	/**
	 * Fetch and store public corporation information
	 */
	private async fetchAndStorePublicInfo(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const data = await esiFetch.fetchPublicInfo(tokenStore, corporationId)

		await this.db
			.insert(corporationPublicInfo)
			.values({
				...data,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: corporationPublicInfo.corporationId,
				set: {
					name: data.name,
					ticker: data.ticker,
					ceoId: data.ceoId,
					memberCount: data.memberCount,
					shares: data.shares,
					taxRate: data.taxRate,
					url: data.url,
					allianceId: data.allianceId,
					factionId: data.factionId,
					warEligible: data.warEligible,
					updatedAt: sql`excluded.updated_at`,
				},
			})
	}

	/**
	 * Fetch and store corporation members
	 */
	private async fetchAndStoreMembers(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const memberIds: EsiCorporationMembers = await esiFetch.fetchMembers(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing members from database to identify departed members
		const existingMembers = await this.db
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		const existingMemberIds = new Set(existingMembers.map((m) => m.characterId))
		const currentMemberIds = new Set(memberIds)

		// Identify departed members (in database but not in current ESI response)
		const departedMemberIds = existingMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		try {
			// Remove departed members from corporationMembers table
			if (departedMemberIds.length > 0) {
				await this.db
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				logger.debug('[fetchAndStoreMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
					characterIds: departedMemberIds,
				})

				// Also remove from corporationMemberTracking table
				await this.db
					.delete(corporationMemberTracking)
					.where(
						and(
							eq(corporationMemberTracking.corporationId, corporationId),
							inArray(corporationMemberTracking.characterId, departedMemberIds)
						)
					)

				// Send messages to HR service to clean up roles for departed members
				const hrQueue = this.env['hr-member-departed']
				const messages = departedMemberIds.map((characterId) => ({
					body: {
						corporationId,
						characterId,
					},
				}))

				await hrQueue.sendBatch(messages)
				logger.debug('[fetchAndStoreMembers] Sent HR cleanup messages:', {
					corporationId,
					count: messages.length,
				})
			}

			// Upsert current members in batch to improve performance
			if (memberIds.length > 0) {
				const values = memberIds.map((memberId) => ({
					corporationId: String(corporationId),
					characterId: memberId,
				}))

				await this.db
					.insert(corporationMembers)
					.values(values)
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})
			}

			// Invalidate members cache after successful update
			await this.invalidateMembersCache(corporationId)

			// Log summary of changes
			const addedCount = memberIds.filter((id) => !existingMemberIds.has(id)).length
			if (addedCount > 0 || departedMemberIds.length > 0) {
				logger.debug('[fetchAndStoreMembers] Member sync completed:', {
					corporationId,
					added: addedCount,
					removed: departedMemberIds.length,
					total: memberIds.length,
				})
			}
		} catch (error) {
			logger.error('[fetchAndStoreMembers] Database operation failed:', {
				error,
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
				errorName: error instanceof Error ? error.name : undefined,
				errorCause: error instanceof Error ? error.cause : undefined,
				corporationId: String(corporationId),
				memberCount: memberIds.length,
				departedCount: departedMemberIds.length,
			})
			throw error
		}
	}

	/**
	 * Fetch and store member tracking data
	 */
	private async fetchAndStoreMemberTracking(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const trackingData: EsiCorporationMemberTracking[] = await esiFetch.fetchMemberTracking(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing tracking records to identify departed members
		const existingTracking = await this.db
			.select({ characterId: corporationMemberTracking.characterId })
			.from(corporationMemberTracking)
			.where(eq(corporationMemberTracking.corporationId, corporationId))

		const currentTrackingIds = new Set(trackingData.map((m) => m.character_id))

		// Identify departed members (in database but not in current ESI response)
		const departedMemberIds = existingTracking
			.filter((m) => !currentTrackingIds.has(m.characterId))
			.map((m) => m.characterId)

		// Remove departed members from tracking table
		if (departedMemberIds.length > 0) {
			await this.db
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.corporationId, corporationId),
						inArray(corporationMemberTracking.characterId, departedMemberIds)
					)
				)

			logger.debug('[fetchAndStoreMemberTracking] Removed departed members:', {
				corporationId,
				count: departedMemberIds.length,
				characterIds: departedMemberIds,
			})
		}

		// Update tracking data for current members
		for (const member of trackingData) {
			await this.db
				.insert(corporationMemberTracking)
				.values({
					corporationId: String(corporationId),
					characterId: member.character_id,
					baseId: member.base_id || null,
					locationId: member.location_id || null,
					logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
					logonDate: member.logon_date ? new Date(member.logon_date) : null,
					shipTypeId: member.ship_type_id || null,
					startDate: member.start_date ? new Date(member.start_date) : null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: member.base_id || null,
						locationId: member.location_id || null,
						logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
						logonDate: member.logon_date ? new Date(member.logon_date) : null,
						shipTypeId: member.ship_type_id || null,
						startDate: member.start_date ? new Date(member.start_date) : null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation wallets
	 */
	private async fetchAndStoreWallets(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const wallets = await esiFetch.fetchWallets(tokenStore, corporationId, characterId)

		for (const wallet of wallets) {
			await this.db
				.insert(corporationWallets)
				.values({
					corporationId: String(corporationId),
					division: wallet.division,
					balance: wallet.balance,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: wallet.balance,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store wallet journal for a division
	 */
	private async fetchAndStoreWalletJournal(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Starting wallet journal fetch')

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const entries = await esiFetch.fetchWalletJournal(
			tokenStore,
			corporationId,
			division,
			characterId
		)

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Fetched wallet journal from ESI', {
				totalEntries: entries.length,
			})

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Starting database insertion', {
				entriesToInsert: entries.length,
			})

		// Batch insert to avoid hitting Cloudflare's 50 subrequest limit
		// Insert 25 entries at a time to be safe
		const BATCH_SIZE = 25
		let insertedCount = 0

		try {
			for (let i = 0; i < entries.length; i += BATCH_SIZE) {
				const batch = entries.slice(i, i + BATCH_SIZE)
				const valuesToInsert = batch.map((entry) => ({
					corporationId: String(corporationId),
					division,
					journalId: entry.id,
					amount: entry.amount,
					balance: entry.balance,
					contextId: entry.context_id,
					contextIdType: entry.context_id_type,
					date: new Date(entry.date),
					description: entry.description,
					firstPartyId: entry.first_party_id,
					reason: entry.reason,
					refType: entry.ref_type,
					secondPartyId: entry.second_party_id,
					tax: entry.tax,
					taxReceiverId: entry.tax_receiver_id,
					updatedAt: new Date(),
				}))

				await this.db
					.insert(corporationWalletJournal)
					.values(valuesToInsert)
					.onConflictDoUpdate({
						target: [
							corporationWalletJournal.corporationId,
							corporationWalletJournal.division,
							corporationWalletJournal.journalId,
						],
						set: {
							amount: sql`excluded.amount`,
							balance: sql`excluded.balance`,
							contextId: sql`excluded.context_id`,
							contextIdType: sql`excluded.context_id_type`,
							description: sql`excluded.description`,
							reason: sql`excluded.reason`,
							tax: sql`excluded.tax`,
							updatedAt: sql`excluded.updated_at`,
						},
					})

				insertedCount += batch.length
			}
		} catch (error) {
			logger
				.withTags({
					corporationId,
					division,
					operation: 'fetch_wallet_journal',
				})
				.error('Failed to insert journal entries', {
					insertedSoFar: insertedCount,
					totalEntries: entries.length,
					error: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
				})

			// Clear cache for this division so next attempt fetches fresh data
			const path = `/corporations/${corporationId}/wallets/${division}/journal`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_journal',
					})
					.debug('Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_journal',
					})
					.error('Failed to clear cache', {
						error: clearError instanceof Error ? clearError.message : String(clearError),
					})
			}

			throw error
		}

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Completed wallet journal fetch and store', {
				totalInserted: insertedCount,
				totalEntries: entries.length,
			})
	}

	/**
	 * Fetch and store wallet transactions for a division
	 */
	private async fetchAndStoreWalletTransactions(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Starting wallet transactions fetch')

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const transactions: EsiCorporationWalletTransaction[] = await esiFetch.fetchWalletTransactions(
			tokenStore,
			corporationId,
			division,
			characterId
		)

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Fetched wallet transactions from ESI', {
				totalTransactions: transactions.length,
			})

		// Batch insert to avoid hitting Cloudflare's 50 subrequest limit
		const BATCH_SIZE = 25
		let insertedCount = 0

		try {
			for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
				const batch = transactions.slice(i, i + BATCH_SIZE)
				const valuesToInsert = batch.map((tx) => ({
					corporationId: String(corporationId),
					division,
					transactionId: tx.transaction_id,
					clientId: tx.client_id,
					date: new Date(tx.date),
					isBuy: tx.is_buy,
					isPersonal: tx.is_personal,
					journalRefId: tx.journal_ref_id,
					locationId: tx.location_id,
					quantity: tx.quantity,
					typeId: tx.type_id,
					unitPrice: tx.unit_price,
					updatedAt: new Date(),
				}))

				await this.db
					.insert(corporationWalletTransactions)
					.values(valuesToInsert)
					.onConflictDoUpdate({
						target: [
							corporationWalletTransactions.corporationId,
							corporationWalletTransactions.division,
							corporationWalletTransactions.transactionId,
						],
						set: {
							updatedAt: sql`excluded.updated_at`,
						},
					})

				insertedCount += batch.length
			}
		} catch (error) {
			logger
				.withTags({
					corporationId,
					division,
					operation: 'fetch_wallet_transactions',
				})
				.error('Failed to insert transactions', {
					insertedSoFar: insertedCount,
					totalTransactions: transactions.length,
					error: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
				})

			// Clear cache for this division so next attempt fetches fresh data
			const path = `/corporations/${corporationId}/wallets/${division}/transactions`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_transactions',
					})
					.debug('Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_transactions',
					})
					.error('Failed to clear cache', {
						error: clearError instanceof Error ? clearError.message : String(clearError),
					})
			}

			throw error
		}

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Completed wallet transactions fetch and store', {
				totalInserted: insertedCount,
				totalTransactions: transactions.length,
			})
	}

	/**
	 * Fetch and store corporation assets (paginated)
	 */
	private async fetchAndStoreAssets(corporationId: string, _forceRefresh = false): Promise<void> {
		logger.debug('[fetchAndStoreAssets] Starting asset fetch', { corporationId })

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const assets: EsiCorporationAsset[] = await esiFetch.fetchAssets(
			tokenStore,
			corporationId,
			characterId
		)

		logger.debug('[fetchAndStoreAssets] Fetched assets from ESI', {
			corporationId,
			totalAssets: assets.length,
		})

		// Batch insert to avoid hitting Cloudflare's subrequest limits and prevent timeouts
		// Insert 25 assets at a time (conservative to stay well below the 50 subrequest limit)
		const BATCH_SIZE = 25
		let insertedCount = 0

		try {
			for (let i = 0; i < assets.length; i += BATCH_SIZE) {
				const batch = assets.slice(i, i + BATCH_SIZE)
				const valuesToInsert = batch.map((asset) => ({
					corporationId: String(corporationId),
					itemId: asset.item_id,
					isSingleton: asset.is_singleton,
					locationFlag: asset.location_flag,
					locationId: asset.location_id,
					locationType: asset.location_type,
					quantity: asset.quantity,
					typeId: asset.type_id,
					isBlueprintCopy: asset.is_blueprint_copy,
					updatedAt: new Date(),
				}))

				await this.db
					.insert(corporationAssets)
					.values(valuesToInsert)
					.onConflictDoUpdate({
						target: [corporationAssets.corporationId, corporationAssets.itemId],
						set: {
							isSingleton: sql`excluded.is_singleton`,
							locationFlag: sql`excluded.location_flag`,
							locationId: sql`excluded.location_id`,
							locationType: sql`excluded.location_type`,
							quantity: sql`excluded.quantity`,
							typeId: sql`excluded.type_id`,
							isBlueprintCopy: sql`excluded.is_blueprint_copy`,
							updatedAt: sql`excluded.updated_at`,
						},
					})

				insertedCount += batch.length

				// Log progress for large datasets
				if (insertedCount % 100 === 0 || insertedCount === assets.length) {
					logger.debug('[fetchAndStoreAssets] Insert progress', {
						corporationId,
						inserted: insertedCount,
						total: assets.length,
						percentage: Math.round((insertedCount / assets.length) * 100),
					})
				}
			}
		} catch (error) {
			logger.error('[fetchAndStoreAssets] Failed to insert assets', {
				corporationId,
				insertedSoFar: insertedCount,
				totalAssets: assets.length,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})

			// Clear cache for this endpoint so next attempt fetches fresh data
			const path = `/corporations/${corporationId}/assets`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger.debug('[fetchAndStoreAssets] Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger.error('[fetchAndStoreAssets] Failed to clear cache', {
					error: clearError instanceof Error ? clearError.message : String(clearError),
				})
			}

			throw error
		}

		logger.debug('[fetchAndStoreAssets] Completed asset fetch and store', {
			corporationId,
			totalInserted: insertedCount,
			totalAssets: assets.length,
		})
	}

	/**
	 * Fetch and store corporation structures
	 */
	private async fetchAndStoreStructures(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Station_Manager'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const structures: EsiCorporationStructure[] = await esiFetch.fetchStructures(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 10 // Structures have more fields, use smaller batch
		for (let i = 0; i < structures.length; i += BATCH_SIZE) {
			const batch = structures.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((structure) => ({
				corporationId: String(corporationId),
				structureId: structure.structure_id,
				typeId: structure.type_id,
				systemId: structure.system_id,
				profileId: structure.profile_id,
				fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
				nextReinforceApply: structure.next_reinforce_apply
					? new Date(structure.next_reinforce_apply)
					: null,
				nextReinforceHour: structure.next_reinforce_hour ?? null,
				reinforceHour: structure.reinforce_hour ?? null,
				state: structure.state,
				stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
				stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
				unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
				services: structure.services || null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationStructures)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationStructures.corporationId, corporationStructures.structureId],
					set: {
						state: sql`excluded.state`,
						fuelExpires: sql`excluded.fuel_expires`,
						nextReinforceApply: sql`excluded.next_reinforce_apply`,
						nextReinforceHour: sql`excluded.next_reinforce_hour`,
						reinforceHour: sql`excluded.reinforce_hour`,
						stateTimerEnd: sql`excluded.state_timer_end`,
						stateTimerStart: sql`excluded.state_timer_start`,
						unanchorsAt: sql`excluded.unanchors_at`,
						services: sql`excluded.services`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation market orders
	 */
	private async fetchAndStoreOrders(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant', 'Trader'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const orders: EsiCorporationOrder[] = await esiFetch.fetchOrders(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 25
		for (let i = 0; i < orders.length; i += BATCH_SIZE) {
			const batch = orders.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((order) => ({
				corporationId: String(corporationId),
				orderId: order.order_id,
				duration: order.duration,
				escrow: order.escrow?.toString() || null,
				isBuyOrder: order.is_buy_order,
				issued: new Date(order.issued),
				issuedBy: order.issued_by,
				locationId: order.location_id,
				minVolume: order.min_volume ?? null,
				price: order.price.toString(),
				range: order.range,
				regionId: order.region_id,
				typeId: order.type_id,
				volumeRemain: order.volume_remain,
				volumeTotal: order.volume_total,
				walletDivision: order.wallet_division,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationOrders)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationOrders.corporationId, corporationOrders.orderId],
					set: {
						volumeRemain: sql`excluded.volume_remain`,
						price: sql`excluded.price`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation contracts
	 */
	private async fetchAndStoreContracts(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const contracts: EsiCorporationContract[] = await esiFetch.fetchContracts(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 20 // Contracts have many fields, use smaller batch
		for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
			const batch = contracts.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((contract) => ({
				corporationId: String(corporationId),
				contractId: contract.contract_id,
				acceptorId: contract.acceptor_id || null,
				assigneeId: contract.assignee_id,
				availability: contract.availability,
				buyout: contract.buyout?.toString() || null,
				collateral: contract.collateral?.toString() || null,
				dateAccepted: contract.date_accepted ? new Date(contract.date_accepted) : null,
				dateCompleted: contract.date_completed ? new Date(contract.date_completed) : null,
				dateExpired: new Date(contract.date_expired),
				dateIssued: new Date(contract.date_issued),
				daysToComplete: contract.days_to_complete ?? null,
				endLocationId: contract.end_location_id || null,
				forCorporation: contract.for_corporation,
				issuerCorporationId: contract.issuer_corporation_id,
				issuerId: contract.issuer_id,
				price: contract.price?.toString() || null,
				reward: contract.reward?.toString() || null,
				startLocationId: contract.start_location_id || null,
				status: contract.status,
				title: contract.title || null,
				type: contract.type,
				volume: contract.volume?.toString() || null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationContracts)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationContracts.corporationId, corporationContracts.contractId],
					set: {
						status: sql`excluded.status`,
						dateAccepted: sql`excluded.date_accepted`,
						dateCompleted: sql`excluded.date_completed`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation industry jobs
	 */
	private async fetchAndStoreIndustryJobs(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Factory_Manager'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const jobs: EsiCorporationIndustryJob[] = await esiFetch.fetchIndustryJobs(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 20 // Industry jobs have many fields, use smaller batch
		for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
			const batch = jobs.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((job) => ({
				corporationId: String(corporationId),
				jobId: job.job_id,
				installerId: job.installer_id,
				facilityId: job.facility_id,
				locationId: job.location_id,
				activityId: job.activity_id,
				blueprintId: job.blueprint_id,
				blueprintTypeId: job.blueprint_type_id,
				blueprintLocationId: job.blueprint_location_id,
				outputLocationId: job.output_location_id,
				runs: job.runs,
				cost: job.cost?.toString() || null,
				licensedRuns: job.licensed_runs ?? null,
				probability: job.probability?.toString() || null,
				productTypeId: job.product_type_id || null,
				status: job.status,
				duration: job.duration,
				startDate: new Date(job.start_date),
				endDate: new Date(job.end_date),
				pauseDate: job.pause_date ? new Date(job.pause_date) : null,
				completedDate: job.completed_date ? new Date(job.completed_date) : null,
				completedCharacterId: job.completed_character_id || null,
				successfulRuns: job.successful_runs ?? null,
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationIndustryJobs)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationIndustryJobs.corporationId, corporationIndustryJobs.jobId],
					set: {
						status: sql`excluded.status`,
						pauseDate: sql`excluded.pause_date`,
						completedDate: sql`excluded.completed_date`,
						completedCharacterId: sql`excluded.completed_character_id`,
						successfulRuns: sql`excluded.successful_runs`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation killmails
	 */
	private async fetchAndStoreKillmails(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const killmails: EsiCorporationKillmail[] = await esiFetch.fetchKillmails(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 50 // Killmails have few fields, can use larger batch
		for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
			const batch = killmails.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((km) => ({
				corporationId: String(corporationId),
				killmailId: km.killmail_id,
				killmailHash: km.killmail_hash,
				killmailTime: new Date(), // ESI doesn't provide time in this endpoint
				updatedAt: new Date(),
			}))

			await this.db
				.insert(corporationKillmails)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	// ========================================================================
	// FETCH ORCHESTRATION METHODS (public)
	// ========================================================================

	/**
	 * Fetch all accessible corporation data in parallel
	 */
	async fetchAllCorporationData(corporationId: string, forceRefresh = false): Promise<void> {
		logger.debug('[EveCorporationData] fetchAllCorporationData: Starting', {
			corporationId,
			forceRefresh,
		})

		// Public data
		logger.debug('[EveCorporationData] fetchAllCorporationData: Fetching public data')
		await this.fetchPublicData(corporationId, forceRefresh)
		logger.debug('[EveCorporationData] fetchAllCorporationData: Public data fetched')

		// Try to fetch all other data, but don't fail if role verification fails
		logger.debug('[EveCorporationData] fetchAllCorporationData: Starting parallel fetches')
		const fetchPromises = [
			this.fetchCoreData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch core data:', e)
			),
			this.fetchFinancialData(corporationId, undefined, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch financial data:', e)
			),
			this.fetchAssetsData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch assets data:', e)
			),
			this.fetchMarketData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch market data:', e)
			),
			this.fetchKillmails(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch killmails:', e)
			),
		]

		const results = await Promise.allSettled(fetchPromises)
		logger.debug('[EveCorporationData] fetchAllCorporationData: All fetches completed', {
			fulfilled: results.filter((r) => r.status === 'fulfilled').length,
			rejected: results.filter((r) => r.status === 'rejected').length,
		})
	}

	/**
	 * Fetch public corporation data
	 */
	async fetchPublicData(corporationId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStorePublicInfo(corporationId, forceRefresh)
	}

	/**
	 * Fetch core corporation data (members, tracking)
	 */
	async fetchCoreData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreMembers(corporationId, forceRefresh),
			this.fetchAndStoreMemberTracking(corporationId, forceRefresh).catch((e) =>
				logger.error('Member tracking failed:', e)
			),
		])
	}

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 */
	async fetchFinancialData(
		corporationId: string,
		division?: number,
		forceRefresh = false
	): Promise<void> {
		// Fetch wallets first
		await this.fetchAndStoreWallets(corporationId, forceRefresh)

		// Fetch journal and transactions for specified division(s)
		const divisions = division ? [division] : [1, 2, 3, 4, 5, 6, 7]

		logger
			.withTags({
				corporationId,
				operation: 'fetch_financial_data',
			})
			.debug('Fetching wallet journal and transactions for divisions', {
				divisions,
				totalDivisions: divisions.length,
			})

		const promises = divisions.flatMap((div) => [
			this.fetchAndStoreWalletJournal(corporationId, div, forceRefresh).catch((e) => {
				logger
					.withTags({
						corporationId,
						division: div,
						operation: 'fetch_financial_data',
					})
					.error('Failed to fetch journal for division', {
						division: div,
						error: e instanceof Error ? e.message : String(e),
					})
			}),
			this.fetchAndStoreWalletTransactions(corporationId, div, forceRefresh).catch((e) => {
				logger
					.withTags({
						corporationId,
						division: div,
						operation: 'fetch_financial_data',
					})
					.error('Failed to fetch transactions for division', {
						division: div,
						error: e instanceof Error ? e.message : String(e),
					})
			}),
		])

		const results = await Promise.allSettled(promises)

		// Count successes and failures
		const successful = results.filter((r) => r.status === 'fulfilled').length
		const failed = results.filter((r) => r.status === 'rejected').length

		logger
			.withTags({
				corporationId,
				operation: 'fetch_financial_data',
			})
			.debug('Completed financial data fetch', {
				divisions,
				totalOperations: results.length,
				successful,
				failed,
			})
	}

	/**
	 * Fetch assets and structures
	 */
	async fetchAssetsData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreAssets(corporationId, forceRefresh),
			this.fetchAndStoreStructures(corporationId, forceRefresh).catch((e) =>
				logger.error('Structures fetch failed:', e)
			),
		])
	}

	/**
	 * Fetch market and industry data
	 */
	async fetchMarketData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreOrders(corporationId, forceRefresh).catch((e) =>
				logger.error('Orders fetch failed:', e)
			),
			this.fetchAndStoreContracts(corporationId, forceRefresh).catch((e) =>
				logger.error('Contracts fetch failed:', e)
			),
			this.fetchAndStoreIndustryJobs(corporationId, forceRefresh).catch((e) =>
				logger.error('Industry jobs fetch failed:', e)
			),
		])
	}

	/**
	 * Fetch killmails
	 */
	async fetchKillmails(corporationId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreKillmails(corporationId, forceRefresh)
	}

	// ========================================================================
	// GETTER METHODS (public)
	// ========================================================================

	/**
	 * Get corporation public information
	 */
	async getCorporationInfo(corporationId: string): Promise<CorporationPublicData | null> {
		const result = await this.db.query.corporationPublicInfo.findFirst({
			where: eq(corporationPublicInfo.corporationId, corporationId),
		})

		if (!result) {
			return null
		}

		return {
			corporationId: result.corporationId,
			name: result.name,
			ticker: result.ticker,
			ceoId: result.ceoId,
			creatorId: result.creatorId,
			dateFounded: result.dateFounded,
			description: result.description,
			homeStationId: result.homeStationId,
			memberCount: result.memberCount,
			shares: result.shares,
			taxRate: result.taxRate,
			url: result.url,
			allianceId: result.allianceId,
			factionId: result.factionId,
			warEligible: result.warEligible,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Get corporation members list
	 */
	async getMembers(corporationId: string): Promise<CorporationMemberData[]> {
		const cacheKey = `members:${corporationId}`

		// Check KV cache first
		try {
			const cached = await this.env.CACHE.get<CorporationMemberData[]>(cacheKey, 'json')
			if (cached) {
				// Convert updatedAt from string back to Date object
				return cached.map((m) => ({
					...m,
					updatedAt: new Date(m.updatedAt),
				}))
			}
		} catch (error) {
			// Cache read failure - log but continue to fetch from DB
			logger.warn('[Members Cache] Failed to read from KV', { corporationId, error })
		}

		// Cache miss or error - fetch from database
		const results = await this.db.query.corporationMembers.findMany({
			where: eq(corporationMembers.corporationId, corporationId),
		})

		const members = results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			characterId: r.characterId,
			updatedAt: r.updatedAt,
		}))

		// Store in KV cache with 30 minute TTL
		try {
			await this.env.CACHE.put(cacheKey, JSON.stringify(members), {
				expirationTtl: this.DIRECTORS_CACHE_TTL, // 30 * 60 seconds
			})
		} catch (error) {
			// Cache write failure - log but don't fail the request
			logger.warn('[Members Cache] Failed to write to KV', { corporationId, error })
		}

		return members
	}

	/**
	 * Get corporation member tracking data
	 */
	async getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]> {
		const results = await this.db.query.corporationMemberTracking.findMany({
			where: eq(corporationMemberTracking.corporationId, corporationId),
		})

		return results.map((r) => ({
			...r,
		}))
	}

	/**
	 * Clean up stale member data by syncing with current ESI member list
	 * This is a one-time operation to remove members who are no longer in the corporation
	 * Returns the number of members removed
	 */
	async cleanupStaleMemberData(corporationId: string): Promise<{
		membersRemoved: number
		characterIds: string[]
	}> {
		// Fetch current members from ESI
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		using tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const response = await tokenStore.fetchEsi<number[]>(
			`/corporations/${corporationId}/members`,
			characterId
		)

		const currentMemberIds = new Set(response.data.map(String))

		// Fetch all members from database
		const dbMembers = await this.db
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		// Identify stale members (in database but not in ESI)
		const staleMemberIds = dbMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		if (staleMemberIds.length === 0) {
			logger.debug('[cleanupStaleMemberData] No stale members found:', { corporationId })
			return { membersRemoved: 0, characterIds: [] }
		}

		// Remove stale members from database
		await this.db
			.delete(corporationMembers)
			.where(
				and(
					eq(corporationMembers.corporationId, corporationId),
					inArray(corporationMembers.characterId, staleMemberIds)
				)
			)

		// Remove stale member tracking
		await this.db
			.delete(corporationMemberTracking)
			.where(
				and(
					eq(corporationMemberTracking.corporationId, corporationId),
					inArray(corporationMemberTracking.characterId, staleMemberIds)
				)
			)

		// Send HR cleanup messages
		const hrQueue = this.env['hr-member-departed']
		const messages = staleMemberIds.map((characterId) => ({
			body: {
				corporationId,
				characterId,
			},
		}))

		await hrQueue.sendBatch(messages)

		// Invalidate cache
		await this.invalidateMembersCache(corporationId)

		logger.debug('[cleanupStaleMemberData] Cleanup completed:', {
			corporationId,
			membersRemoved: staleMemberIds.length,
			characterIds: staleMemberIds,
		})

		return {
			membersRemoved: staleMemberIds.length,
			characterIds: staleMemberIds,
		}
	}

	/**
	 * Get corporation core data
	 */
	async getCoreData(corporationId: string): Promise<CorporationCoreData | null> {
		const [publicInfo, members, memberTracking] = await Promise.all([
			this.getCorporationInfo(corporationId),
			this.getMembers(corporationId),
			this.getMemberTracking(corporationId),
		])

		if (!publicInfo) {
			return null
		}

		return {
			publicInfo,
			members,
			memberTracking,
		}
	}

	/**
	 * Get corporation wallets
	 */
	async getWallets(corporationId: string, division?: number): Promise<CorporationWalletData[]> {
		const results = division
			? await this.db.query.corporationWallets.findMany({
					where: and(
						eq(corporationWallets.corporationId, corporationId),
						eq(corporationWallets.division, division)
					),
				})
			: await this.db.query.corporationWallets.findMany({
					where: eq(corporationWallets.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			balance: r.balance,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet journal entries
	 */
	async getWalletJournal(
		corporationId: string,
		division?: number,
		limit = 1000
	): Promise<CorporationWalletJournalData[]> {
		const results = division
			? await this.db.query.corporationWalletJournal.findMany({
					where: and(
						eq(corporationWalletJournal.corporationId, corporationId),
						eq(corporationWalletJournal.division, division)
					),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})
			: await this.db.query.corporationWalletJournal.findMany({
					where: eq(corporationWalletJournal.corporationId, corporationId),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			journalId: r.journalId,
			amount: r.amount,
			balance: r.balance,
			contextId: r.contextId,
			contextIdType: r.contextIdType,
			date: r.date,
			description: r.description,
			firstPartyId: r.firstPartyId,
			reason: r.reason,
			refType: r.refType,
			secondPartyId: r.secondPartyId,
			tax: r.tax,
			taxReceiverId: r.taxReceiverId,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet transactions
	 */
	async getWalletTransactions(
		corporationId: string,
		division?: number,
		limit = 1000
	): Promise<CorporationWalletTransactionData[]> {
		const results = division
			? await this.db.query.corporationWalletTransactions.findMany({
					where: and(
						eq(corporationWalletTransactions.corporationId, corporationId),
						eq(corporationWalletTransactions.division, division)
					),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})
			: await this.db.query.corporationWalletTransactions.findMany({
					where: eq(corporationWalletTransactions.corporationId, corporationId),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			transactionId: r.transactionId,
			clientId: r.clientId,
			date: r.date,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			locationId: r.locationId,
			quantity: r.quantity,
			typeId: r.typeId,
			unitPrice: r.unitPrice,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete financial data
	 */
	async getFinancialData(
		corporationId: string,
		division?: number
	): Promise<CorporationFinancialData | null> {
		const [wallets, journalEntries, transactions] = await Promise.all([
			this.getWallets(corporationId, division),
			this.getWalletJournal(corporationId, division),
			this.getWalletTransactions(corporationId, division),
		])

		if (wallets.length === 0 && journalEntries.length === 0 && transactions.length === 0) {
			return null
		}

		return {
			wallets,
			journalEntries,
			transactions,
		}
	}

	/**
	 * Get corporation assets
	 */
	async getAssets(corporationId: string, limit = 10000): Promise<CorporationAssetData[]> {
		const results = await this.db.query.corporationAssets.findMany({
			where: eq(corporationAssets.corporationId, corporationId),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			itemId: r.itemId,
			isSingleton: r.isSingleton,
			locationFlag: r.locationFlag,
			locationId: r.locationId,
			locationType: r.locationType,
			quantity: r.quantity,
			typeId: r.typeId,
			isBlueprintCopy: r.isBlueprintCopy,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation structures
	 */
	async getStructures(corporationId: string): Promise<CorporationStructureData[]> {
		const results = await this.db.query.corporationStructures.findMany({
			where: eq(corporationStructures.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			structureId: r.structureId,
			typeId: r.typeId,
			systemId: r.systemId,
			profileId: r.profileId,
			fuelExpires: r.fuelExpires,
			nextReinforceApply: r.nextReinforceApply,
			nextReinforceHour: r.nextReinforceHour,
			reinforceHour: r.reinforceHour,
			state: r.state,
			stateTimerEnd: r.stateTimerEnd,
			stateTimerStart: r.stateTimerStart,
			unanchorsAt: r.unanchorsAt,
			services: r.services,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete assets data
	 */
	async getAssetsData(corporationId: string): Promise<CorporationAssetsData | null> {
		const [assets, structures] = await Promise.all([
			this.getAssets(corporationId),
			this.getStructures(corporationId),
		])

		if (assets.length === 0 && structures.length === 0) {
			return null
		}

		return {
			assets,
			structures,
		}
	}

	/**
	 * Get corporation market orders
	 */
	async getOrders(corporationId: string): Promise<CorporationOrderData[]> {
		const results = await this.db.query.corporationOrders.findMany({
			where: eq(corporationOrders.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			orderId: r.orderId,
			duration: r.duration,
			escrow: r.escrow,
			isBuyOrder: r.isBuyOrder,
			issued: r.issued,
			issuedBy: r.issuedBy,
			locationId: r.locationId,
			minVolume: r.minVolume,
			price: r.price,
			range: r.range,
			regionId: r.regionId,
			typeId: r.typeId,
			volumeRemain: r.volumeRemain,
			volumeTotal: r.volumeTotal,
			walletDivision: r.walletDivision,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation contracts
	 */
	async getContracts(corporationId: string, status?: string): Promise<CorporationContractData[]> {
		const results = status
			? await this.db.query.corporationContracts.findMany({
					where: and(
						eq(corporationContracts.corporationId, corporationId),
						eq(corporationContracts.status, status)
					),
				})
			: await this.db.query.corporationContracts.findMany({
					where: eq(corporationContracts.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			contractId: r.contractId,
			acceptorId: r.acceptorId,
			assigneeId: r.assigneeId,
			availability: r.availability,
			buyout: r.buyout,
			collateral: r.collateral,
			dateAccepted: r.dateAccepted,
			dateCompleted: r.dateCompleted,
			dateExpired: r.dateExpired,
			dateIssued: r.dateIssued,
			daysToComplete: r.daysToComplete,
			endLocationId: r.endLocationId,
			forCorporation: r.forCorporation,
			issuerCorporationId: r.issuerCorporationId,
			issuerId: r.issuerId,
			price: r.price,
			reward: r.reward,
			startLocationId: r.startLocationId,
			status: r.status,
			title: r.title,
			type: r.type,
			volume: r.volume,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation industry jobs
	 */
	async getIndustryJobs(
		corporationId: string,
		status?: string
	): Promise<CorporationIndustryJobData[]> {
		const results = status
			? await this.db.query.corporationIndustryJobs.findMany({
					where: and(
						eq(corporationIndustryJobs.corporationId, corporationId),
						eq(corporationIndustryJobs.status, status)
					),
				})
			: await this.db.query.corporationIndustryJobs.findMany({
					where: eq(corporationIndustryJobs.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			jobId: r.jobId,
			installerId: r.installerId,
			facilityId: r.facilityId,
			locationId: r.locationId,
			activityId: r.activityId,
			blueprintId: r.blueprintId,
			blueprintTypeId: r.blueprintTypeId,
			blueprintLocationId: r.blueprintLocationId,
			outputLocationId: r.outputLocationId,
			runs: r.runs,
			cost: r.cost,
			licensedRuns: r.licensedRuns,
			probability: r.probability,
			productTypeId: r.productTypeId,
			status: r.status,
			duration: r.duration,
			startDate: r.startDate,
			endDate: r.endDate,
			pauseDate: r.pauseDate,
			completedDate: r.completedDate,
			completedCharacterId: r.completedCharacterId,
			successfulRuns: r.successfulRuns,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete market data
	 */
	async getMarketData(corporationId: string): Promise<CorporationMarketData | null> {
		const [orders, contracts, industryJobs] = await Promise.all([
			this.getOrders(corporationId),
			this.getContracts(corporationId),
			this.getIndustryJobs(corporationId),
		])

		if (orders.length === 0 && contracts.length === 0 && industryJobs.length === 0) {
			return null
		}

		return {
			orders,
			contracts,
			industryJobs,
		}
	}

	/**
	 * Get corporation killmails
	 */
	async getKillmails(corporationId: string, limit = 100): Promise<CorporationKillmailData[]> {
		const results = await this.db.query.corporationKillmails.findMany({
			where: eq(corporationKillmails.corporationId, corporationId),
			orderBy: desc(corporationKillmails.killmailTime),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			killmailId: r.killmailId,
			killmailHash: r.killmailHash,
			killmailTime: r.killmailTime,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get character's corporation roles
	 */
	async getCharacterRoles(characterId: string): Promise<CharacterCorporationRolesData | null> {
		const result = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, characterId),
		})

		if (!result) {
			return null
		}

		return {
			id: result.id,
			corporationId: result.corporationId,
			characterId: result.characterId,
			roles: result.roles,
			rolesAtHq: result.rolesAtHq || undefined,
			rolesAtBase: result.rolesAtBase || undefined,
			rolesAtOther: result.rolesAtOther || undefined,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Fetch handler for HTTP requests (minimal implementation)
	 */
	async fetch(_request: Request): Promise<Response> {
		return new Response('EveCorporationData Durable Object', { status: 200 })
	}
}
