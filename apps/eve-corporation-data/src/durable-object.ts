import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, gt, gte, inArray, lte, notInArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import { createDb } from './db'
import {
	characterCorporationRoles,
	corporationAssets,
	corporationConfig,
	corporationContracts,
	corporationDirectors,
	corporationIndustryJobs,
	corporationKillmails,
	corporationMembers,
	corporationMemberTracking,
	corporationOrders,
	corporationPublicInfo,
	corporationStructureInventory,
	structureFuelLog,
	corporationStructures,
	corporationWalletJournal,
	corporationWallets,
	corporationWalletTransactions,
	structureMiningStates,
	structureSkyhookStates,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from './db/schema'
import { syncAssetsPaged } from './services/assets-paging-sync'
import { DirectorManager } from './services/director-manager'
import * as esiFetch from './services/esi-fetch'

import type { SQL } from 'drizzle-orm'
import type { RawEsiAsset } from './services/assets-paging-sync'
import type {
	CharacterCorporationRolesData,
	CorporationAccessVerification,
	CorporationAssetData,
	CorporationAssetsData,
	CorporationAuthStatus,
	CorporationConfigData,
	CorporationContractData,
	CorporationContractSortBy,
	CorporationContractsPageData,
	CourierLeaderboard,
	CorporationCoreData,
	CorporationFinancialData,
	CorporationIndustryJobData,
	CorporationKillmailData,
	CorporationMarketData,
	CorporationMemberData,
	CorporationMembersPageData,
	CorporationMemberTrackingData,
	CorporationOrderData,
	CorporationPublicData,
	CorporationStructureInventoryData,
	CorporationStructureQuery,
	CorporationRole,
	CorporationStructureData,
	CorporationSyncHealth,
	CorporationTaxMetadata,
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
	EsiCorporationSkyhook,
	EsiCorporationStructure,
	EsiCorporationMiningState,
	EsiSovereigntyHub,
	EsiSovereigntySystem,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EveCorporationData,
	SearchAssetsFilters,
	WalletJournalWindowFilters,
	WalletTransactionWindowFilters,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId, EveStructureId } from '@repo/eve-types'
import type { Universe, UniverseSolarSystem } from '@repo/universe'
import type { Env } from './context'
import {
	filterStructureInventoryAssets,
	summarizeFuelBlockUnitsByStructure,
	type StructureInventoryRowInput,
} from './services/structure-inventory'

type CorporationConfigRow = typeof corporationConfig.$inferSelect

function minutesAgo(minutes: number): Date {
	return new Date(Date.now() - minutes * 60 * 1000)
}

type SortDirection = 'asc' | 'desc'

const REQUIRED_CORPORATION_WALLET_SCOPE = 'esi-wallet.read_corporation_wallets.v1'
const CHARACTER_WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1'
const CORPORATION_MEMBERSHIP_SCOPE = 'esi-corporations.read_corporation_membership.v1'
const NPC_CORPORATION_ID_MIN = 1_000_000
const NPC_CORPORATION_ID_MAX = 1_999_999
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY = 'shared:sovereignty-systems:observed-at'
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX = 'shared:sovereignty-systems:row:'
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS = 300

function parseNumberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') {
		return null
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}
	const parsed = Number.parseFloat(String(value))
	return Number.isFinite(parsed) ? parsed : null
}

function addHours(date: Date, hours: number): Date {
	return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function hoursBetween(start: Date, end: Date): number {
	return (end.getTime() - start.getTime()) / (60 * 60 * 1000)
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
	private readonly DIRECTORS_CACHE_TTL = 30 * 60 // 30 minutes in seconds (KV expirationTtl)

	private isNpcCorporationId(corporationId: string): boolean {
		const parsed = Number(corporationId)
		if (!Number.isFinite(parsed)) return false
		const id = Math.trunc(parsed)
		return id >= NPC_CORPORATION_ID_MIN && id <= NPC_CORPORATION_ID_MAX
	}

	private assertNonNpcCorporation(corporationId: string): void {
		if (!this.isNpcCorporationId(corporationId)) return
		throw new Error(`NPC corporation ${corporationId} is not supported by eve-corporation-data`)
	}

	private compareNullableString(left: string | null, right: string | null): number {
		if (left === right) return 0
		if (left === null || left === '') return 1
		if (right === null || right === '') return -1
		return left.localeCompare(right)
	}

	private compareNullableNumber(left: number | null, right: number | null): number {
		if (left === right) return 0
		if (left === null || left === undefined) return 1
		if (right === null || right === undefined) return -1
		return left - right
	}

	private compareNullableNumericString(left: string | null, right: string | null): number {
		if (left === right) return 0
		if (left === null || left === '') return 1
		if (right === null || right === '') return -1
		const leftValue = Number.parseFloat(left)
		const rightValue = Number.parseFloat(right)
		if (!Number.isFinite(leftValue) && !Number.isFinite(rightValue)) return 0
		if (!Number.isFinite(leftValue)) return 1
		if (!Number.isFinite(rightValue)) return -1
		return leftValue - rightValue
	}

	private compareAllianceCourierContracts(
		left: CorporationContractData,
		right: CorporationContractData,
		sortBy: CorporationContractSortBy,
		sortDirection: SortDirection
	) {
		let comparison = 0
		switch (sortBy) {
			case 'pickup': {
				comparison = this.compareNullableString(left.startLocationId, right.startLocationId)
				break
			}
			case 'dropoff': {
				comparison = this.compareNullableString(left.endLocationId, right.endLocationId)
				break
			}
			case 'volume': {
				comparison = this.compareNullableNumericString(left.volume, right.volume)
				break
			}
			case 'reward': {
				comparison = this.compareNullableNumericString(left.reward, right.reward)
				break
			}
			case 'collateral': {
				comparison = this.compareNullableNumericString(left.collateral, right.collateral)
				break
			}
			case 'daysToComplete': {
				comparison = this.compareNullableNumber(left.daysToComplete, right.daysToComplete)
				break
			}
			case 'expires':
			default:
				comparison = left.dateExpired.getTime() - right.dateExpired.getTime()
				break
		}

		if (comparison !== 0) {
			return sortDirection === 'asc' ? comparison : -comparison
		}

		const issuedComparison = right.dateIssued.getTime() - left.dateIssued.getTime()
		if (issuedComparison !== 0) return issuedComparison

		return right.contractId.localeCompare(left.contractId)
	}

	private mapAllianceCourierContract(row: typeof corporationContracts.$inferSelect): CorporationContractData {
		return {
			id: row.id,
			corporationId: row.corporationId,
			contractId: row.contractId,
			acceptorId: row.acceptorId,
			assigneeId: row.assigneeId,
			availability: row.availability,
			buyout: row.buyout,
			collateral: row.collateral,
			dateAccepted: row.dateAccepted,
			dateCompleted: row.dateCompleted,
			dateExpired: row.dateExpired,
			dateIssued: row.dateIssued,
			daysToComplete: row.daysToComplete,
			endLocationId: row.endLocationId,
			forCorporation: row.forCorporation,
			issuerCorporationId: row.issuerCorporationId,
			issuerId: row.issuerId,
			price: row.price,
			reward: row.reward,
			startLocationId: row.startLocationId,
			status: row.status,
			title: row.title,
			type: row.type,
			volume: row.volume,
			updatedAt: row.updatedAt,
		}
	}

	/**
	 * Initialize the Durable Object with database connection
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	private getDb(): ReturnType<typeof createDb> {
		return createDb(this.env.DATABASE_URL)
	}
	/**
	 * Get a stub for the EveTokenStore Durable Object
	 */
	private getEveTokenStoreStub() {
		return getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
	}

	private async onDirectorAffiliationMismatch(
		characterId: string,
		expectedCorporationId: string,
		actualCorporationId: string | null
	): Promise<void> {
		try {
			await this.env.CORE.handleCharacterAffiliationChanges([characterId], {
				source: `director-affiliation-mismatch:${expectedCorporationId}:${actualCorporationId ?? 'unknown'}`,
				bypassThrottle: true,
			})
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to propagate director affiliation mismatch', {
				characterId,
				expectedCorporationId,
				actualCorporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
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
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const directorManager = new DirectorManager(
			this.getDb(),

			config.corporationId,

			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
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
		const config = await this.getDb().query.corporationConfig.findFirst()

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		return new DirectorManager(
			this.getDb(),
			config.corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
	}

	/**
	 * Check if character has a required role
	 */
	private async hasRequiredRole(
		characterId: string,
		requiredRole: CorporationRole
	): Promise<boolean> {
		logger.info('[EveCorporationData] hasRequiredRole: Checking role', {
			characterId,
			requiredRole,
		})

		const rolesData = await this.getDb().query.characterCorporationRoles.findFirst({
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

	async getCorporationsNeedingRefresh(): Promise<string[]> {
		const tooOld = minutesAgo(20)
		const assetsTooOld = minutesAgo(60)

		const configs = await this.getDb().query.corporationConfig.findMany({
			where: and(eq(corporationConfig.includeInBackgroundRefresh, true)),
		})

		const syncTargets = [
			{ field: 'membersLastSync' as const, cutoff: tooOld },
			{ field: 'memberTrackingLastSync' as const, cutoff: tooOld },
			{ field: 'walletsLastSync' as const, cutoff: tooOld },
			{ field: 'walletJournalLastSync' as const, cutoff: tooOld },
			{ field: 'walletTransactionsLastSync' as const, cutoff: tooOld },
			{ field: 'assetsLastSync' as const, cutoff: assetsTooOld },
			{ field: 'structuresLastSync' as const, cutoff: tooOld },
			{ field: 'ordersLastSync' as const, cutoff: tooOld },
			{ field: 'contractsLastSync' as const, cutoff: tooOld },
			{ field: 'industryJobsLastSync' as const, cutoff: tooOld },
			{ field: 'killmailsLastSync' as const, cutoff: tooOld },
		]

		const isStale = (lastSync: Date | null | undefined, cutoff: Date) =>
			!lastSync || lastSync < cutoff

		// Collect unique corporation IDs that need refresh (any data type)
		const corporationIds = new Set<string>()

		for (const corp of configs) {
			// Check if any data type needs refresh
			for (const { field, cutoff } of syncTargets) {
				if (isStale(corp[field], cutoff)) {
					corporationIds.add(corp.corporationId)
					break // No need to check other fields for this corporation
				}
			}
		}

		const result = Array.from(corporationIds)

		logger.info('[EveCorporationData] getCorporationsNeedingRefresh: Results', {
			count: result.length,
			corporationIds: result,
		})

		return result
	}

	/**
	 * Update corporation configuration settings
	 */
	async updateCorporationConfig(
		corporationId: string,
		updates: { includeInBackgroundRefresh?: boolean }
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		// Ensure corporation config exists
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					includeInBackgroundRefresh: updates.includeInBackgroundRefresh ?? false,
					updatedAt: new Date(),
				})
		} else {
			// Update existing config
			await this.getDb()
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
	 * Update corporation sync timestamp for a specific property
	 * Updates the corporationConfig table with the current timestamp for the specified sync property
	 */
	async updateCorporationSyncTimestamp(corporationId: string, syncProperty: string): Promise<void> {
		logger.debug('[EveCorporationData] Updating sync timestamp', {
			corporationId,
			syncProperty,
		})

		try {
			const timestamp = new Date()

			await this.getDb()
				.update(corporationConfig)
				.set({
					[syncProperty]: timestamp,
				})
				.where(eq(corporationConfig.corporationId, corporationId))

			logger.debug('[EveCorporationData] Sync timestamp updated successfully', {
				corporationId,
				syncProperty,
				timestamp: timestamp.toISOString(),
			})
		} catch (error) {
			logger.error('[EveCorporationData] Failed to update sync timestamp', {
				corporationId,
				syncProperty,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Batch update corporation sync timestamps for multiple properties
	 * Updates the corporationConfig table with the current timestamp for all specified sync properties
	 * @param corporationId - The corporation ID
	 * @param syncProperties - Array of sync property names to update (e.g., ['membersLastSync', 'assetsLastSync'])
	 */
	async batchUpdateCorporationSyncTimestamps(
		corporationId: string,
		syncProperties: string[]
	): Promise<void> {
		if (syncProperties.length === 0) {
			return
		}

		logger.debug('[EveCorporationData] Batch updating sync timestamps', {
			corporationId,
			syncProperties,
			count: syncProperties.length,
		})

		try {
			const timestamp = new Date()

			// Build update object with all sync properties
			const updateData: Record<string, Date> = {}
			for (const syncProperty of syncProperties) {
				updateData[syncProperty] = timestamp
			}

			await this.getDb()
				.update(corporationConfig)
				.set(updateData)
				.where(eq(corporationConfig.corporationId, corporationId))

			logger.debug('[EveCorporationData] Batch sync timestamps updated successfully', {
				corporationId,
				syncProperties,
				count: syncProperties.length,
				timestamp: timestamp.toISOString(),
			})
		} catch (error) {
			logger.error('[EveCorporationData] Failed to batch update sync timestamps', {
				corporationId,
				syncProperties,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
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
		this.assertNonNpcCorporation(corporationId)

		// Ensure corporation config exists
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					updatedAt: new Date(),
				})
		}

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)

		// Check if director already exists
		const directors = await directorManager.getAllDirectors()
		const existingDirector = directors.find((d) => d.characterId === characterId)

		if (!existingDirector) {
			await directorManager.addDirector(characterId, characterName, 100)

			const inserted = (await directorManager.getAllDirectors()).find(
				(d) => d.characterId === characterId
			)
			if (inserted) {
				await directorManager.verifyDirectorHealth(inserted.directorId)
			}
		}
	}

	/**
	 * Get the configured character for this corporation
	 * @deprecated Use getDirectors() instead for multi-director support
	 */
	async getConfiguration(): Promise<CorporationConfigData | null> {
		const config = await this.getDb().query.corporationConfig.findFirst()

		if (!config) {
			return null
		}

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			config.corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
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
		const config = await this.getDb().query.corporationConfig.findFirst()

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

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			config.corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
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
		const rolesData = await this.getDb().query.characterCorporationRoles.findFirst({
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
	 * Get a load-balanced director character ID for this corporation
	 * @param corporationId - The corporation ID
	 * @returns A load-balanced director character ID or null if no healthy directors are available
	 */
	async getLoadBalancedDirector(corporationId: string): Promise<string | null> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		const selected = await directorManager.selectDirector()
		logger.info('[EveCorporationData] getLoadBalancedDirector: Selected director', {
			corporationId,
			selected,
		})
		if (!selected) {
			logger.error('[EveCorporationData] getLoadBalancedDirector: No director selected', {
				corporationId,
			})
			return null
		}
		return String(selected.characterId)
	}

	/**
	 * Add a new director character for this corporation
	 */
	async addDirector(
		corporationId: string,
		characterId: string,
		characterName: string,
		priority = 100
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					updatedAt: new Date(),
				})
		}

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		await directorManager.addDirector(characterId, characterName, priority)

		const inserted = (await directorManager.getAllDirectors()).find(
			(d) => d.characterId === characterId
		)
		if (inserted) {
			await directorManager.verifyDirectorHealth(inserted.directorId)
		}

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Remove a director character from this corporation
	 */
	async removeDirector(corporationId: string, characterId: string): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
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
		this.assertNonNpcCorporation(corporationId)

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
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

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
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
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		return await directorManager.getHealthyDirectors()
	}

	/**
	 * Verify health of a specific director
	 */
	async verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		const result = await directorManager.verifyDirectorHealth(directorId)

		// Invalidate cache so next fetch returns fresh data
		await this.invalidateDirectorsCache(corporationId)

		return result
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(
		corporationId: string,
		options?: { includePermanent?: boolean; bypassPermanentFailures?: boolean }
	): Promise<{ verified: number; failed: number }> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		const result = await directorManager.verifyAllDirectorsHealth(options)

		// Invalidate cache so next fetch returns fresh data
		await this.invalidateDirectorsCache(corporationId)

		return result
	}

	// ========================================================================
	// STORAGE-ONLY METHODS (public) - For use by workflows
	// ========================================================================

	/**
	 * Store public corporation info (workflow-friendly)
	 * Takes pre-fetched data and stores it in the database
	 */
	async storePublicInfo(corporationId: string, publicInfo: any): Promise<void> {
		await this.getDb()
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
	 * Handles member additions, updates, and departures.
	 * Automatically removes members from the database if they are no longer in the corporation.
	 * Returns IDs of departed members for HR processing.
	 */
	async storeMembers(
		corporationId: string,
		memberIds: string[]
	): Promise<{ departedMemberIds: string[]; addedMemberIds: string[] }> {
		// Fetch existing members to identify departures
		const existingMembers = await this.getDb()
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
			// Remove departed members (those in database but not in current ESI response)
			if (departedMemberIds.length > 0) {
				await this.getDb()
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				// Also remove from tracking table
				await this.getDb()
					.delete(corporationMemberTracking)
					.where(
						and(
							eq(corporationMemberTracking.corporationId, corporationId),
							inArray(corporationMemberTracking.characterId, departedMemberIds)
						)
					)

				logger.info('[storeMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
					characterIds: departedMemberIds,
				})
			}

			// Upsert current members
			if (memberIds.length > 0) {
				const values = memberIds.map((memberId) => ({
					corporationId: String(corporationId),
					characterId: memberId,
				}))

				await this.getDb()
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

			// Identify added members
			const addedMemberIds = memberIds.filter((id) => !existingMemberIds.has(id))
			if (addedMemberIds.length > 0 || departedMemberIds.length > 0) {
				logger.debug('[storeMembers] Member sync completed:', {
					corporationId,
					added: addedMemberIds.length,
					removed: departedMemberIds.length,
					total: memberIds.length,
				})
			}

			return { departedMemberIds, addedMemberIds }
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
	 * Reconcile a single character's corporation membership rows using
	 * authoritative affiliation data from character sync.
	 */
	async reconcileCharacterCorporationMembership(
		characterId: string,
		corporationId: string | null
	): Promise<{
		removedFromCorporationIds: string[]
		addedToCorporationId: string | null
	}> {
		const normalizedCharacterId = String(characterId)
		const authoritativeCorporationId = corporationId ? String(corporationId) : null

		const existingRows = await this.getDb().query.corporationMembers.findMany({
			where: eq(corporationMembers.characterId, normalizedCharacterId),
			columns: {
				corporationId: true,
				characterId: true,
			},
		})

		const existingCorporationIds = new Set(existingRows.map((row) => row.corporationId))
		const removedFromCorporationIds = Array.from(existingCorporationIds).filter(
			(existingCorporationId) => existingCorporationId !== authoritativeCorporationId
		)

		if (removedFromCorporationIds.length > 0) {
			await this.getDb()
				.delete(corporationMembers)
				.where(
					and(
						eq(corporationMembers.characterId, normalizedCharacterId),
						inArray(corporationMembers.corporationId, removedFromCorporationIds)
					)
				)

			await this.getDb()
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.characterId, normalizedCharacterId),
						inArray(corporationMemberTracking.corporationId, removedFromCorporationIds)
					)
				)

			await this.getDb()
				.delete(corporationDirectors)
				.where(
					and(
						eq(corporationDirectors.characterId, normalizedCharacterId),
						inArray(corporationDirectors.corporationId, removedFromCorporationIds)
					)
				)

			for (const removedCorporationId of removedFromCorporationIds) {
				await this.invalidateMembersCache(removedCorporationId)
				await this.invalidateDirectorsCache(removedCorporationId)
			}

			const departedMessages = removedFromCorporationIds.map((removedCorporationId) => ({
				body: {
					corporationId: removedCorporationId,
					characterId: normalizedCharacterId,
				},
			}))

			if (departedMessages.length > 0) {
				await this.env['hr-member-departed'].sendBatch(departedMessages)
			}
		}

		let addedToCorporationId: string | null = null
		if (authoritativeCorporationId && !existingCorporationIds.has(authoritativeCorporationId)) {
			const corporationExists = await this.getDb().query.corporationConfig.findFirst({
				where: eq(corporationConfig.corporationId, authoritativeCorporationId),
				columns: {
					corporationId: true,
				},
			})

			if (corporationExists) {
				await this.getDb()
					.insert(corporationMembers)
					.values({
						corporationId: authoritativeCorporationId,
						characterId: normalizedCharacterId,
					})
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})

				await this.invalidateMembersCache(authoritativeCorporationId)
				addedToCorporationId = authoritativeCorporationId
			}
		}

		return {
			removedFromCorporationIds,
			addedToCorporationId,
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
		const existingTracking = await this.getDb()
			.select({ characterId: corporationMemberTracking.characterId })
			.from(corporationMemberTracking)
			.where(eq(corporationMemberTracking.corporationId, corporationId))

		const currentTrackingIds = new Set(trackingData.map((m) => m.character_id))
		const departedMemberIds = existingTracking
			.filter((m) => !currentTrackingIds.has(m.characterId))
			.map((m) => m.characterId)

		// Remove departed members
		if (departedMemberIds.length > 0) {
			await this.getDb()
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.corporationId, corporationId),
						inArray(corporationMemberTracking.characterId, departedMemberIds)
					)
				)
		}

		// Upsert tracking data in batch
		if (trackingData.length > 0) {
			const values = trackingData.map((member) => ({
				corporationId: String(corporationId),
				characterId: member.character_id,
				baseId: member.base_id || null,
				locationId: member.location_id || null,
				logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
				logonDate: member.logon_date ? new Date(member.logon_date) : null,
				shipTypeId: member.ship_type_id || null,
				startDate: member.start_date ? new Date(member.start_date) : null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationMemberTracking)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: sql`excluded.base_id`,
						locationId: sql`excluded.location_id`,
						logoffDate: sql`excluded.logoff_date`,
						logonDate: sql`excluded.logon_date`,
						shipTypeId: sql`excluded.ship_type_id`,
						startDate: sql`excluded.start_date`,
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
		if (wallets.length > 0) {
			const values = wallets.map((wallet) => ({
				corporationId: String(corporationId),
				division: wallet.division,
				balance: wallet.balance,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationWallets)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: sql`excluded.balance`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallet journal entries (workflow-friendly)
	 */
	async storeWalletJournal(
		corporationId: string,
		division: number,
		entries: any[]
	): Promise<{ persistedNewRows: number }> {
		let persistedNewRows = 0
		const BATCH_SIZE = 25
		for (let i = 0; i < entries.length; i += BATCH_SIZE) {
			const batch = entries.slice(i, i + BATCH_SIZE)
			const batchJournalIds = batch.map((entry) => String(entry.id))
			const existingRows =
				batchJournalIds.length > 0
					? await this.getDb().query.corporationWalletJournal.findMany({
						where: and(
							eq(corporationWalletJournal.corporationId, String(corporationId)),
							eq(corporationWalletJournal.division, division),
							inArray(corporationWalletJournal.journalId, batchJournalIds)
						),
						columns: {
							journalId: true,
						},
					})
					: []
			const existingJournalIds = new Set(existingRows.map((row) => row.journalId))
			persistedNewRows += batchJournalIds.filter((id) => !existingJournalIds.has(id)).length
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

			await this.getDb()
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

		return { persistedNewRows }
	}

	/**
	 * Store wallet transactions (workflow-friendly)
	 */
	async storeWalletTransactions(
		corporationId: string,
		division: number,
		transactions: any[]
	): Promise<{ persistedNewRows: number }> {
		let persistedNewRows = 0
		const BATCH_SIZE = 25
		for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
			const batch = transactions.slice(i, i + BATCH_SIZE)
			const dedupedBatchByTransactionId = new Map<string, any>()
			for (const tx of batch) {
				dedupedBatchByTransactionId.set(String(tx.transaction_id), tx)
			}
			const dedupedBatch = [...dedupedBatchByTransactionId.values()]
			const batchTransactionIds = [...dedupedBatchByTransactionId.keys()]
			const existingRows =
				batchTransactionIds.length > 0
					? await this.getDb().query.corporationWalletTransactions.findMany({
						where: and(
							eq(corporationWalletTransactions.corporationId, String(corporationId)),
							eq(corporationWalletTransactions.division, division),
							inArray(corporationWalletTransactions.transactionId, batchTransactionIds)
						),
						columns: {
							transactionId: true,
						},
					})
					: []
			const existingTransactionIds = new Set(existingRows.map((row) => row.transactionId))
			persistedNewRows += batchTransactionIds.filter((id) => !existingTransactionIds.has(id)).length
			const valuesToInsert = dedupedBatch.map((tx) => ({
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

			await this.getDb()
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

		return { persistedNewRows }
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

			await this.getDb()
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

	private async getOwnedStructureIds(corporationId: string): Promise<Set<string>> {
		const rows = await this.getDb().query.corporationStructures.findMany({
			where: eq(corporationStructures.corporationId, corporationId),
			columns: {
				structureId: true,
			},
		})

		return new Set(rows.map((row) => row.structureId))
	}

	async storeStructureInventory(
		corporationId: string,
		inventory: Array<StructureInventoryRowInput>
	): Promise<void> {
		const observedAt = new Date()
		const ownedStructureIds = await this.getOwnedStructureIds(corporationId)
		const fuelBlockUnitsByStructure = summarizeFuelBlockUnitsByStructure(ownedStructureIds, inventory)
		const previousFuelRows = ownedStructureIds.size
			? await this.getDb().query.structureFuelLog.findMany({
					where: and(
						eq(structureFuelLog.corporationId, corporationId),
						inArray(structureFuelLog.structureId, [...ownedStructureIds])
					),
					orderBy: desc(structureFuelLog.observedAt),
				})
			: []
		const previousFuelBlockUnitsByStructure = new Map<string, number>()
		for (const row of previousFuelRows) {
			if (previousFuelBlockUnitsByStructure.has(row.structureId)) {
				continue
			}
			previousFuelBlockUnitsByStructure.set(row.structureId, row.fuelBlockUnits)
		}
		const refilledStructureIds = Array.from(fuelBlockUnitsByStructure.entries())
			.filter(([structureId, fuelBlockUnits]) => {
				const previousFuelBlockUnits = previousFuelBlockUnitsByStructure.get(structureId)
				return previousFuelBlockUnits !== undefined && fuelBlockUnits > previousFuelBlockUnits
			})
			.map(([structureId]) => structureId)

		await this.getDb().transaction(async (tx) => {
			await tx
				.delete(corporationStructureInventory)
				.where(eq(corporationStructureInventory.corporationId, corporationId))

			const BATCH_SIZE = 100
			for (let i = 0; i < inventory.length; i += BATCH_SIZE) {
				const batch = inventory.slice(i, i + BATCH_SIZE)
				const valuesToInsert = batch.map((row) => ({
					corporationId: String(corporationId),
					structureId: row.structureId,
					itemId: row.itemId,
					isSingleton: row.isSingleton,
					locationFlag: row.locationFlag,
					locationType: row.locationType,
					quantity: row.quantity,
					typeId: row.typeId,
					updatedAt: observedAt,
				}))

				await tx.insert(corporationStructureInventory).values(valuesToInsert)
			}

			if (ownedStructureIds.size > 0) {
				const fuelHistoryRows = Array.from(fuelBlockUnitsByStructure.entries()).map(
					([structureId, fuelBlockUnits]) => ({
						corporationId: String(corporationId),
						structureId,
						fuelBlockUnits,
						observedAt,
						updatedAt: observedAt,
					})
				)

				await tx.insert(structureFuelLog).values(fuelHistoryRows)
			}

			if (refilledStructureIds.length > 0) {
				await tx
					.update(corporationStructures)
					.set({ lastRefilledAt: observedAt })
					.where(
						and(
							eq(corporationStructures.corporationId, corporationId),
							inArray(corporationStructures.structureId, refilledStructureIds)
						)
					)
			}

			await tx
				.delete(structureFuelLog)
				.where(
					and(
						eq(structureFuelLog.corporationId, corporationId),
						lte(structureFuelLog.observedAt, new Date(observedAt.getTime() - 30 * 24 * 60 * 60 * 1000))
					)
				)
		})
	}

	private async getStructureInventoryNextAllowedAt(
		corporationId: string
	): Promise<Date | null> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		if (!config?.assetsLastSync) {
			return null
		}

		const nextAllowedAt = addHours(config.assetsLastSync, 1)
		return nextAllowedAt > new Date() ? nextAllowedAt : null
	}

	/**
	 * Fetch and store structure inventory using a specific director character.
	 * This avoids transferring large asset arrays across RPC boundaries.
	 */
	async syncAssetsWithDirector(
		corporationId: string,
		directorCharacterId: string
	): Promise<{ assetsCount: number }> {
		this.assertNonNpcCorporation(corporationId)
		logger.info('[EveCorporationData] syncAssetsWithDirector invoked', {
			corporationId,
			directorCharacterId,
		})
		const nextAllowedAt = await this.getStructureInventoryNextAllowedAt(corporationId)
		if (nextAllowedAt) {
			logger.info('[EveCorporationData] Skipping structure inventory sync due to cooldown', {
				corporationId,
				nextAllowedAt: nextAllowedAt.toISOString(),
			})
			return { assetsCount: 0 }
		}
		await this.verifyRole(directorCharacterId, ['Director'])
		const assetsCount = await this.fetchAndStoreStructureInventoryByCharacter(
			corporationId,
			directorCharacterId
		)
		return { assetsCount }
	}

	private async hydrateStructureRows(
		corporationId: string,
		structures: EsiCorporationStructure[]
	): Promise<
		Array<{
			corporationId: string
			structureId: string
			name: string
			typeId: string
			typeName: string | null
			systemId: string
			systemName: string | null
			regionId: string | null
			regionName: string | null
			profileId: string
			fuelExpires: Date | null
			fuelAmount: number | null
			nextReinforceApply: Date | null
			nextReinforceHour: number | null
			reinforceHour: number | null
			state: string
			stateTimerEnd: Date | null
			stateTimerStart: Date | null
			unanchorsAt: Date | null
			lowPower: boolean
			syncStatus: 'ok' | 'warning' | 'error'
			syncFailureReason: string | null
			lastSyncedAt: Date | null
			services: Array<{ name: string; state: string }> | null
			updatedAt: Date
		}>
	> {
		if (structures.length === 0) {
			return []
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const directorManager = new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStore,
			this.onDirectorAffiliationMismatch.bind(this)
		)
		const director = await directorManager.selectDirector()
		const characterId = director ? String(director.characterId) : null
		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const systemIds = [...new Set(structures.map((structure) => structure.system_id))]
		const typeIds = [...new Set(structures.map((structure) => structure.type_id))]

		const [systemsById, regionsBySystemId, typeNamesById, structureInfos] = await Promise.all([
			systemIds.length > 0
				? universe.resolveSolarSystemsByIds(systemIds)
				: Promise.resolve({} as Record<string, UniverseSolarSystem | null>),
			systemIds.length > 0
				? universe.getRegionsBySystemIds(systemIds)
				: Promise.resolve({} as Record<string, { regionId: string; regionName: string }>),
			typeIds.length > 0
				? tokenStore.resolveIds(typeIds)
				: Promise.resolve({} as Record<string, string>),
			characterId
				? Promise.all(
						structures.map(async (structure) => {
							try {
								return await universe.getStructureInfo(
									structure.structure_id as EveStructureId,
									characterId as EveCharacterId
								)
							} catch (error) {
								logger.warn('[EveCorporationData] Failed to hydrate structure name', {
									corporationId,
									structureId: structure.structure_id,
									error: error instanceof Error ? error.message : String(error),
								})
								return null
							}
						})
					)
				: Promise.resolve(structures.map(() => null)),
		])

		return structures.map((structure, index) => {
			const structureInfo = structureInfos[index]
			const system = systemsById[structure.system_id]
			const region = regionsBySystemId[structure.system_id]
			const lowPower = !structure.services?.some((service) => service.state === 'online')
			const syncStatus: 'ok' | 'warning' | 'error' = structureInfo ? 'ok' : 'warning'
			const syncFailureReason = structureInfo
				? null
				: 'Structure details could not be fully hydrated during sync'

			return {
				corporationId: String(corporationId),
				structureId: structure.structure_id,
				name: structureInfo?.name ?? structure.structure_id,
				typeId: structure.type_id,
				typeName: typeNamesById[structure.type_id] ?? null,
				systemId: structure.system_id,
				systemName: system?.solarSystemName ?? null,
				regionId: region?.regionId ?? null,
				regionName: region?.regionName ?? null,
				profileId: structure.profile_id,
				fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
				fuelAmount: null,
				nextReinforceApply: structure.next_reinforce_apply
					? new Date(structure.next_reinforce_apply)
					: null,
				nextReinforceHour: structure.next_reinforce_hour ?? null,
				reinforceHour: structure.reinforce_hour ?? null,
				state: structure.state,
				stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
				stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
				unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
				lowPower,
				syncStatus,
				syncFailureReason,
				lastSyncedAt: new Date(),
				services: structure.services || null,
				updatedAt: new Date(),
			}
		})
	}

	/**
	 * Store structures (workflow-friendly)
	 */
	async storeStructures(corporationId: string, structures: any[]): Promise<void> {
		const hydratedStructures = await this.hydrateStructureRows(
			corporationId,
			structures as EsiCorporationStructure[]
		)
		const structureIds = hydratedStructures.map((structure) => structure.structureId)
		if (structureIds.length === 0) {
			await this.getDb()
				.delete(corporationStructures)
				.where(eq(corporationStructures.corporationId, corporationId))
			return
		}
		const BATCH_SIZE = 10

		for (let i = 0; i < hydratedStructures.length; i += BATCH_SIZE) {
			const batch = hydratedStructures.slice(i, i + BATCH_SIZE)

				await this.getDb()
					.insert(corporationStructures)
					.values(batch)
					.onConflictDoUpdate({
						target: corporationStructures.structureId,
						set: {
						name: sql`excluded.name`,
						typeId: sql`excluded.type_id`,
						typeName: sql`excluded.type_name`,
						systemId: sql`excluded.system_id`,
						systemName: sql`excluded.system_name`,
						regionId: sql`excluded.region_id`,
						regionName: sql`excluded.region_name`,
						profileId: sql`excluded.profile_id`,
						fuelExpires: sql`excluded.fuel_expires`,
						fuelAmount: sql`excluded.fuel_amount`,
						nextReinforceApply: sql`excluded.next_reinforce_apply`,
						nextReinforceHour: sql`excluded.next_reinforce_hour`,
						reinforceHour: sql`excluded.reinforce_hour`,
						state: sql`excluded.state`,
						stateTimerEnd: sql`excluded.state_timer_end`,
						stateTimerStart: sql`excluded.state_timer_start`,
						unanchorsAt: sql`excluded.unanchors_at`,
						lowPower: sql`excluded.low_power`,
						syncStatus: sql`excluded.sync_status`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						services: sql`excluded.services`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await this.getDb()
			.delete(corporationStructures)
			.where(
				and(
					eq(corporationStructures.corporationId, corporationId),
					notInArray(corporationStructures.structureId, structureIds)
				)
			)
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

			await this.getDb()
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

			await this.getDb()
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

			await this.getDb()
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

			await this.getDb()
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
		const previousInfo = await this.getDb().query.corporationPublicInfo.findFirst({
			where: eq(corporationPublicInfo.corporationId, corporationId),
			columns: { allianceId: true },
		})

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const data = await esiFetch.fetchPublicInfo(tokenStore, corporationId)

		await this.getDb()
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

		const previousAllianceId = previousInfo?.allianceId ?? null
		const nextAllianceId = data.allianceId ?? null
		if (previousAllianceId !== nextAllianceId) {
			const members = await this.getDb()
				.select({ characterId: corporationMembers.characterId })
				.from(corporationMembers)
				.where(eq(corporationMembers.corporationId, corporationId))
			const characterIds = members.map((row) => row.characterId)

				if (characterIds.length > 0) {
					try {
						const result = await this.env.CORE.addPendingDiscordRefreshesForCharacters(characterIds)
						logger.info('[EveCorporationData] Queued Discord refresh after alliance affiliation change', {
							corporationId,
						previousAllianceId,
						nextAllianceId,
						charactersMatched: characterIds.length,
						usersQueued: result.usersQueued,
							pendingCount: result.pendingCount,
						})
					} catch (error) {
						logger.error(
							'[EveCorporationData] Failed to queue Discord refresh after alliance affiliation change',
							{
								corporationId,
								previousAllianceId,
								nextAllianceId,
								error: error instanceof Error ? error.message : String(error),
							}
						)
					}
				}
			}
		}

	/**
	 * Store sovereignty system snapshots (workflow-friendly)
	 */
	async storeSovereigntySystems(corporationId: string, systems: EsiSovereigntySystem[]): Promise<void> {
		const now = new Date()
		const values = systems.map((system) => {
			const claimedSince = parseDateOrNull(system.claimed_since) ?? null
			const vulnerabilityWindowStart = parseDateOrNull(system.vulnerability_window?.start) ?? null
			const vulnerabilityWindowEnd = parseDateOrNull(system.vulnerability_window?.end) ?? null

			return {
				systemId: system.system_id,
				corporationId,
				claimType: system.claim_type,
				allianceId: system.alliance_id ?? null,
				corporationClaimantId: system.corporation_id ?? null,
				factionId: system.faction_id ?? null,
				claimedSince,
				sovereigntyHubStructureId: system.sovereignty_hub_structure_id ?? null,
				isCapitalSystem: system.is_capital_system ?? null,
				vulnerabilityWindowStart,
				vulnerabilityWindowEnd,
				activityDefenseMultiplier:
					parseNumberOrNull(system.activity_defense_multiplier)?.toString() ?? null,
				militaryLevel: system.military_level ?? null,
				industrialLevel: system.industrial_level ?? null,
				strategicLevel: system.strategic_level ?? null,
				sourceSyncAt: now,
				lastSyncedAt: now,
				rawPayload: system.raw ?? {
					...system,
				},
				updatedAt: now,
			}
		})

		if (values.length === 0) {
			await this.getDb()
				.delete(structureSovereigntySystems)
				.where(eq(structureSovereigntySystems.corporationId, corporationId))
			return
		}

		const BATCH_SIZE = 25
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureSovereigntySystems)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSovereigntySystems.systemId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						claimType: sql`excluded.claim_type`,
						allianceId: sql`excluded.alliance_id`,
						corporationClaimantId: sql`excluded.corporation_claimant_id`,
						factionId: sql`excluded.faction_id`,
						claimedSince: sql`excluded.claimed_since`,
						sovereigntyHubStructureId: sql`excluded.sovereignty_hub_structure_id`,
						isCapitalSystem: sql`excluded.is_capital_system`,
						vulnerabilityWindowStart: sql`excluded.vulnerability_window_start`,
						vulnerabilityWindowEnd: sql`excluded.vulnerability_window_end`,
						activityDefenseMultiplier: sql`excluded.activity_defense_multiplier`,
						militaryLevel: sql`excluded.military_level`,
						industrialLevel: sql`excluded.industrial_level`,
						strategicLevel: sql`excluded.strategic_level`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						rawPayload: sql`excluded.raw_payload`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await this.getDb()
			.delete(structureSovereigntySystems)
			.where(
				and(
					eq(structureSovereigntySystems.corporationId, corporationId),
					notInArray(
						structureSovereigntySystems.systemId,
						values.map((row) => row.systemId)
					)
				)
			)
	}

	/**
	 * Store the shared sovereignty system snapshot used by workflow fan-out.
	 */
	async storeSharedSovereigntySystems(systems: EsiSovereigntySystem[]): Promise<void> {
		const observedAt = new Date().toISOString()
		const rowEntries = Object.fromEntries(
			systems.map((system) => [`${SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX}${system.system_id}`, system])
		)

		await this.state.storage.transaction(async (txn) => {
			const existing = await txn.list<EsiSovereigntySystem>({
				prefix: SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX,
			})
			if (existing.size > 0) {
				await txn.delete([...existing.keys()])
			}
			await txn.put(SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY, observedAt)
			if (systems.length > 0) {
				await txn.put(rowEntries)
			}
		})
	}

	/**
	 * Get shared sovereignty system snapshots for the requested system IDs if they are still within TTL.
	 */
	async getSharedSovereigntySystemsByIds(
		systemIds: string[],
		maxAgeSeconds = SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS
	): Promise<EsiSovereigntySystem[] | null> {
		const observedAtRaw = await this.state.storage.get<string>(SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY)
		if (!observedAtRaw) {
			return null
		}

		const observedAt = parseDateOrNull(observedAtRaw)
		if (!observedAt) {
			return null
		}

		const ageMs = Date.now() - observedAt.getTime()
		if (ageMs > maxAgeSeconds * 1000) {
			return null
		}

		const uniqueSystemIds = [...new Set(systemIds.filter((systemId) => Boolean(systemId)))]
		if (uniqueSystemIds.length === 0) {
			return []
		}

		const rows = await this.state.storage.get<EsiSovereigntySystem>(
			uniqueSystemIds.map((systemId) => `${SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX}${systemId}`)
		)

		return [...rows.values()]
	}

	/**
	 * Get a cached sovereignty system snapshot for a specific corporation if it is still within TTL.
	 */
	async getSovereigntySystems(
		corporationId: string,
		maxAgeSeconds = 300
	): Promise<EsiSovereigntySystem[] | null> {
		const rows = await this.getDb().query.structureSovereigntySystems.findMany({
			where: eq(structureSovereigntySystems.corporationId, corporationId),
		})

		if (rows.length === 0) {
			return null
		}

		const newestSyncAt = rows.reduce<Date | null>((latest, row) => {
			const candidate = row.lastSyncedAt ?? row.sourceSyncAt ?? null
			if (!candidate) return latest
			if (!latest || candidate.getTime() > latest.getTime()) {
				return candidate
			}
			return latest
		}, null)

		if (!newestSyncAt) {
			return null
		}

		const ageMs = Date.now() - newestSyncAt.getTime()
		if (ageMs > maxAgeSeconds * 1000) {
			return null
		}

		return rows.map((row) => ({
			system_id: row.systemId,
			claim_type: row.claimType as EsiSovereigntySystem['claim_type'],
			alliance_id: row.allianceId ?? null,
			corporation_id: row.corporationClaimantId ?? null,
			faction_id: row.factionId ?? null,
			claimed_since: row.claimedSince?.toISOString() ?? null,
			is_capital_system: row.isCapitalSystem ?? null,
			sovereignty_hub_structure_id: row.sovereigntyHubStructureId ?? null,
			vulnerability_window:
				row.vulnerabilityWindowStart !== null || row.vulnerabilityWindowEnd !== null
					? {
							start: row.vulnerabilityWindowStart?.toISOString() ?? '',
							end: row.vulnerabilityWindowEnd?.toISOString() ?? '',
						}
					: null,
			activity_defense_multiplier: row.activityDefenseMultiplier ?? null,
			military_level: row.militaryLevel ?? null,
			industrial_level: row.industrialLevel ?? null,
			strategic_level: row.strategicLevel ?? null,
			raw: row.rawPayload ?? {},
		}))
	}

	/**
	 * Store sovereignty hub snapshots (workflow-friendly)
	 */
	async storeSovereigntyHubs(corporationId: string, hubs: EsiSovereigntyHub[]): Promise<void> {
		const now = new Date()
		const values = hubs.map((hub) => ({
			structureId: hub.structure_id,
			corporationId,
			systemId: hub.system_id,
			name: hub.name,
			ownerId: hub.owner_id,
			typeId: hub.type_id,
			fuelAccessListId: hub.fuel_access_list_id ?? null,
			controllerAllianceId: hub.controller_alliance_id ?? null,
			reagentBayLastUpdated: parseDateOrNull(hub.reagent_bay.last_updated) ?? null,
			reagentBay: {
				lastUpdated: hub.reagent_bay.last_updated,
				reagents: hub.reagent_bay.reagents.map((reagent) => ({
					typeId: reagent.type_id,
					securedStock: reagent.secured_stock,
					unsecuredStock: reagent.unsecured_stock,
					lastCycle: reagent.last_cycle,
				})),
			},
			resources: hub.resources,
			upgrades: hub.upgrades.map((upgrade) => ({
				typeId: upgrade.type_id,
				powerState: upgrade.power_state,
			})),
			vulnerabilityWindowStart: parseDateOrNull(hub.vulnerability_window?.start) ?? null,
			vulnerabilityWindowEnd: parseDateOrNull(hub.vulnerability_window?.end) ?? null,
			workforceTransport: hub.workforce_transport,
			sourceSyncAt: now,
			lastSyncedAt: now,
			rawPayload: hub.raw ?? { ...hub },
			updatedAt: now,
		}))

		if (values.length === 0) {
			await this.getDb()
				.delete(structureSovereigntyHubs)
				.where(eq(structureSovereigntyHubs.corporationId, corporationId))
			return
		}

		const BATCH_SIZE = 25
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureSovereigntyHubs)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSovereigntyHubs.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						systemId: sql`excluded.system_id`,
						name: sql`excluded.name`,
						ownerId: sql`excluded.owner_id`,
						typeId: sql`excluded.type_id`,
						fuelAccessListId: sql`excluded.fuel_access_list_id`,
						controllerAllianceId: sql`excluded.controller_alliance_id`,
						reagentBayLastUpdated: sql`excluded.reagent_bay_last_updated`,
						reagentBay: sql`excluded.reagent_bay`,
						resources: sql`excluded.resources`,
						upgrades: sql`excluded.upgrades`,
						vulnerabilityWindowStart: sql`excluded.vulnerability_window_start`,
						vulnerabilityWindowEnd: sql`excluded.vulnerability_window_end`,
						workforceTransport: sql`excluded.workforce_transport`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						rawPayload: sql`excluded.raw_payload`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await this.getDb()
			.delete(structureSovereigntyHubs)
			.where(
				and(
					eq(structureSovereigntyHubs.corporationId, corporationId),
					notInArray(structureSovereigntyHubs.structureId, values.map((row) => row.structureId))
				)
			)
	}

	/**
	 * Store skyhook snapshots (workflow-friendly)
	 */
	async storeSkyhooks(corporationId: string, skyhooks: EsiCorporationSkyhook[]): Promise<void> {
		const now = new Date()
		const values = skyhooks.map((skyhook) => {
			return {
				structureId: skyhook.structure_id,
				corporationId,
				planetId: skyhook.planet_id,
				systemId: skyhook.system_id,
				name: skyhook.name,
				ownerId: skyhook.owner_id,
				typeId: skyhook.type_id,
				state: skyhook.state,
				isActive: skyhook.is_active,
				effectiveWorkforce: skyhook.effective_workforce ?? null,
				reagents:
					skyhook.reagents.map((reagent) => ({
						typeId: reagent.type_id,
						securedStock: reagent.secured_stock,
						unsecuredStock: reagent.unsecured_stock,
						lastCycle: reagent.last_cycle,
					})) ?? [],
				reinforcementTimerEnd: parseDateOrNull(skyhook.reinforcement_timer?.end) ?? null,
				theftVulnerabilityStart: parseDateOrNull(skyhook.theft_vulnerability?.start) ?? null,
				theftVulnerabilityEnd: parseDateOrNull(skyhook.theft_vulnerability?.end) ?? null,
				isRaidable: skyhook.is_raidable ?? false,
				becomesRaidableAt: parseDateOrNull(skyhook.becomes_raidable_at) ?? null,
				vulnerableAt: parseDateOrNull(skyhook.vulnerable_at) ?? null,
				lastObservedAt: now,
				sourceSyncAt: now,
				lastSyncedAt: now,
				rawPayload: skyhook.raw ?? { ...skyhook },
				updatedAt: now,
			}
		})

		if (values.length === 0) {
			await this.getDb()
				.delete(structureSkyhookStates)
				.where(eq(structureSkyhookStates.corporationId, corporationId))
			return
		}

		const BATCH_SIZE = 25
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureSkyhookStates)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSkyhookStates.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						planetId: sql`excluded.planet_id`,
						systemId: sql`excluded.system_id`,
						name: sql`excluded.name`,
						ownerId: sql`excluded.owner_id`,
						typeId: sql`excluded.type_id`,
						state: sql`excluded.state`,
						isActive: sql`excluded.is_active`,
						effectiveWorkforce: sql`excluded.effective_workforce`,
						reagents: sql`excluded.reagents`,
						reinforcementTimerEnd: sql`excluded.reinforcement_timer_end`,
						theftVulnerabilityStart: sql`excluded.theft_vulnerability_start`,
						theftVulnerabilityEnd: sql`excluded.theft_vulnerability_end`,
						isRaidable: sql`excluded.is_raidable`,
						becomesRaidableAt: sql`excluded.becomes_raidable_at`,
						vulnerableAt: sql`excluded.vulnerable_at`,
						lastObservedAt: sql`excluded.last_observed_at`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						rawPayload: sql`excluded.raw_payload`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await this.getDb()
			.delete(structureSkyhookStates)
			.where(
				and(
					eq(structureSkyhookStates.corporationId, corporationId),
					notInArray(structureSkyhookStates.structureId, values.map((row) => row.structureId))
				)
			)
	}

	/**
	 * Store mining-oriented structure snapshots (workflow-friendly)
	 */
	async storeMiningStates(
		corporationId: string,
		miningStates: EsiCorporationMiningState[]
	): Promise<void> {
		const now = new Date()
		const existingRows = await this.getDb().query.structureMiningStates.findMany({
			where: eq(structureMiningStates.corporationId, corporationId),
		})
		const existingByStructureId = new Map(existingRows.map((row) => [row.structureId, row]))

		const values = miningStates.map((state) => {
			const previous = existingByStructureId.get(state.structure_id)
			const currentVolume = state.current_stock_volume ?? null
			const previousVolume = previous?.lastObservedVolume ?? previous?.currentStockVolume ?? null
			const previousObservedAt = previous?.lastObservedAt ?? previous?.sourceSyncAt ?? null
			const observedAt = now
			const capacityVolume = state.capacity_volume ?? previous?.capacityVolume ?? 30_000
			let fillRatePerHour = previous?.fillRatePerHour ?? null
			let estimatedFullAt = previous?.estimatedFullAt ?? null
			let lastEmptiedAt = previous?.lastEmptiedAt ?? null

			if (currentVolume !== null && previousVolume !== null) {
				if (currentVolume < previousVolume) {
					lastEmptiedAt = observedAt
					fillRatePerHour = null
					estimatedFullAt = null
				} else if (
					currentVolume > previousVolume &&
					previousObservedAt !== null &&
					observedAt.getTime() > previousObservedAt.getTime()
				) {
					const delta = currentVolume - previousVolume
					const elapsedHours = hoursBetween(previousObservedAt, observedAt)
					if (elapsedHours > 0) {
						const rate = delta / elapsedHours
						fillRatePerHour = rate.toFixed(4)
						if (rate > 0 && currentVolume < capacityVolume) {
							const remainingHours = (capacityVolume - currentVolume) / rate
							estimatedFullAt = addHours(observedAt, remainingHours)
						}
					}
				}
			}

			return {
				structureId: state.structure_id,
				corporationId,
				planetId: state.planet_id,
				systemId: state.system_id,
				typeId: state.type_id,
				currentStockVolume: currentVolume,
				capacityVolume,
				fillRatePerHour,
				lastEmptiedAt,
				estimatedFullAt,
				lastObservedVolume: currentVolume,
				lastObservedAt: observedAt,
				sourceSyncAt: observedAt,
				lastSyncedAt: observedAt,
				rawPayload: state.raw ?? { ...state },
				updatedAt: observedAt,
			}
		})

		if (values.length === 0) {
			await this.getDb()
				.delete(structureMiningStates)
				.where(eq(structureMiningStates.corporationId, corporationId))
			return
		}

		const BATCH_SIZE = 25
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureMiningStates)
				.values(batch)
				.onConflictDoUpdate({
					target: structureMiningStates.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						planetId: sql`excluded.planet_id`,
						systemId: sql`excluded.system_id`,
						typeId: sql`excluded.type_id`,
						currentStockVolume: sql`excluded.current_stock_volume`,
						capacityVolume: sql`excluded.capacity_volume`,
						fillRatePerHour: sql`excluded.fill_rate_per_hour`,
						lastEmptiedAt: sql`excluded.last_emptied_at`,
						estimatedFullAt: sql`excluded.estimated_full_at`,
						lastObservedVolume: sql`excluded.last_observed_volume`,
						lastObservedAt: sql`excluded.last_observed_at`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						rawPayload: sql`excluded.raw_payload`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await this.getDb()
			.delete(structureMiningStates)
			.where(
				and(
					eq(structureMiningStates.corporationId, corporationId),
					notInArray(structureMiningStates.structureId, values.map((row) => row.structureId))
				)
			)
	}

	/**
	 * Fetch and store corporation members
	 */
	private async fetchAndStoreMembers(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const memberIds: EsiCorporationMembers = await esiFetch.fetchMembers(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing members from database to identify departed members
		const existingMembers = await this.getDb()
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
			// Remove departed members (those in database but not in current ESI response)
			if (departedMemberIds.length > 0) {
				await this.getDb()
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				logger.info('[fetchAndStoreMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
					characterIds: departedMemberIds,
				})

				// Also remove from corporationMemberTracking table
				await this.getDb()
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

				await this.getDb()
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const trackingData: EsiCorporationMemberTracking[] = await esiFetch.fetchMemberTracking(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing tracking records to identify departed members
		const existingTracking = await this.getDb()
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
			await this.getDb()
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

		// Update tracking data for current members in batch
		if (trackingData.length > 0) {
			const values = trackingData.map((member) => ({
				corporationId: String(corporationId),
				characterId: member.character_id,
				baseId: member.base_id || null,
				locationId: member.location_id || null,
				logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
				logonDate: member.logon_date ? new Date(member.logon_date) : null,
				shipTypeId: member.ship_type_id || null,
				startDate: member.start_date ? new Date(member.start_date) : null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationMemberTracking)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: sql`excluded.base_id`,
						locationId: sql`excluded.location_id`,
						logoffDate: sql`excluded.logoff_date`,
						logonDate: sql`excluded.logon_date`,
						shipTypeId: sql`excluded.ship_type_id`,
						startDate: sql`excluded.start_date`,
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const wallets = await esiFetch.fetchWallets(tokenStore, corporationId, characterId)

		if (wallets.length > 0) {
			const values = wallets.map((wallet) => ({
				corporationId: String(corporationId),
				division: wallet.division,
				balance: wallet.balance,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationWallets)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: sql`excluded.balance`,
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

				await this.getDb()
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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
				const dedupedBatchByTransactionId = new Map<string, EsiCorporationWalletTransaction>()
				for (const tx of batch) {
					dedupedBatchByTransactionId.set(String(tx.transaction_id), tx)
				}
				const dedupedBatch = [...dedupedBatchByTransactionId.values()]
				const valuesToInsert = dedupedBatch.map((tx) => ({
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

				await this.getDb()
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

				insertedCount += dedupedBatch.length
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
		logger.info('[EveCorporationData] fetchAndStoreAssets: Selected character', {
			corporationId,
			characterId,
		})

		await this.verifyRole(characterId, ['Director'])

		logger.info('[EveCorporationData] fetchAndStoreAssets: Role verified', {
			corporationId,
			characterId,
		})

		try {
			const insertedCount = await this.fetchAndStoreAssetsByCharacter(corporationId, characterId)
			logger.debug('[fetchAndStoreAssets] Completed asset fetch and store', {
				corporationId,
				totalInserted: insertedCount,
				totalAssets: insertedCount,
			})
		} catch (error) {
			logger.error('[fetchAndStoreAssets] Failed to insert assets', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})

			// Clear cache for this endpoint so next attempt fetches fresh data
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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
	}

	private async fetchAndStoreAssetsByCharacter(
		corporationId: string,
		characterId: string
	): Promise<number> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const basePath = `/corporations/${corporationId}/assets`
		const result = await syncAssetsPaged({
			fetchPage: (page) =>
				tokenStore.fetchEsi(`${basePath}?page=${page}`, characterId, {
					cacheMode: 'no-store',
				}) as Promise<
					EsiResponse<RawEsiAsset[]>
				>,
			storeAssets: (assets) => this.storeAssets(corporationId, assets),
			onProgress: ({ page, totalPages, totalAssets }) => {
				if (page % 10 === 0 || page === totalPages) {
					logger.debug('[fetchAndStoreAssets] Page progress', {
						corporationId,
						page,
						totalPages,
						totalAssets,
					})
				}
			},
		})

		return result.assetsCount
	}

	private async fetchAndStoreStructureInventory(
		corporationId: string,
		forceRefresh = false
	): Promise<number> {
		if (!forceRefresh) {
			const nextAllowedAt = await this.getStructureInventoryNextAllowedAt(corporationId)
			if (nextAllowedAt) {
				logger.info('[EveCorporationData] Skipping structure inventory refresh due to cooldown', {
					corporationId,
					nextAllowedAt: nextAllowedAt.toISOString(),
				})
				return 0
			}
		}

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		logger.info('[EveCorporationData] fetchAndStoreStructureInventory: Selected character', {
			corporationId,
			characterId,
		})

		await this.verifyRole(characterId, ['Director'])

		logger.info('[EveCorporationData] fetchAndStoreStructureInventory: Role verified', {
			corporationId,
			characterId,
		})

		return await this.fetchAndStoreStructureInventoryByCharacter(corporationId, characterId, {
			forceRefresh,
		})
	}

	private async fetchAndStoreStructureInventoryByCharacter(
		corporationId: string,
		characterId: string,
		options?: { forceRefresh?: boolean }
	): Promise<number> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		if (!options?.forceRefresh && config?.assetsLastSync) {
			const nextAllowedAt = addHours(config.assetsLastSync, 1)
			if (nextAllowedAt > new Date()) {
				logger.info('[EveCorporationData] Skipping structure inventory refresh due to cooldown', {
					corporationId,
					lastSyncAt: config.assetsLastSync.toISOString(),
					nextAllowedAt: nextAllowedAt.toISOString(),
				})
				return 0
			}
		}

		const ownedStructureIds = await this.getOwnedStructureIds(corporationId)
		if (ownedStructureIds.size === 0) {
			logger.info('[EveCorporationData] No owned structures found; clearing structure inventory snapshot', {
				corporationId,
			})
			await this.storeStructureInventory(corporationId, [])
			await this.updateCorporationSyncTimestamp(corporationId, 'assetsLastSync')
			return 0
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const basePath = `/corporations/${corporationId}/assets`
		const inventoryRows: StructureInventoryRowInput[] = []
		try {
			logger.info('[EveCorporationData] fetchAndStoreStructureInventoryByCharacter: Fetching structure inventory', {
				corporationId,
				ownedStructureCount: ownedStructureIds.size,
			})
			const result = await syncAssetsPaged({
				fetchPage: (page) =>
					tokenStore.fetchEsi(`${basePath}?page=${page}`, characterId, {
						cacheMode: 'no-store',
					}) as Promise<EsiResponse<RawEsiAsset[]>>,
				storeAssets: async (assets) => {
					inventoryRows.push(
						...filterStructureInventoryAssets(corporationId, ownedStructureIds, assets)
					)
				},
				onProgress: ({ page, totalPages, totalAssets }) => {
					if (page % 10 === 0 || page === totalPages) {
						logger.debug('[fetchAndStoreStructureInventory] Page progress', {
							corporationId,
							page,
							totalPages,
							totalAssets,
						})
					}
				},
			})

			await this.storeStructureInventory(corporationId, inventoryRows)
			await this.updateCorporationSyncTimestamp(corporationId, 'assetsLastSync')
			logger.info('[EveCorporationData] Stored structure inventory snapshot', {
				corporationId,
				fetchedAssetCount: result.assetsCount,
				storedInventoryCount: inventoryRows.length,
			})

			return inventoryRows.length
		} catch (error) {
			logger.error('[fetchAndStoreStructureInventory] Failed to insert structure inventory', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})

			const path = `/corporations/${corporationId}/assets`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger.debug('[fetchAndStoreStructureInventory] Cleared ESI cache after error', {
					path,
				})
			} catch (clearError) {
				logger.error('[fetchAndStoreStructureInventory] Failed to clear cache', {
					error: clearError instanceof Error ? clearError.message : String(clearError),
				})
			}

			throw error
		}
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const structures: EsiCorporationStructure[] = await esiFetch.fetchStructures(
			tokenStore,
			corporationId,
			characterId
		)

		await this.storeStructures(corporationId, structures)
	}

	/**
	 * Fetch and store corporation market orders
	 */
	private async fetchAndStoreOrders(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant', 'Trader'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

			await this.getDb()
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

			await this.getDb()
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

			await this.getDb()
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

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
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

			await this.getDb()
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
		this.assertNonNpcCorporation(corporationId)

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
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStorePublicInfo(corporationId, forceRefresh)
	}

	/**
	 * Fetch core corporation data (members, tracking)
	 */
	async fetchCoreData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
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
		this.assertNonNpcCorporation(corporationId)

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
	 * Fetch structure inventory and structures
	 */
	async fetchAssetsData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreStructures(corporationId, forceRefresh).catch((e) =>
			logger.error('Structures fetch failed:', e instanceof Error ? e.message : String(e))
		)
		await this.fetchAndStoreStructureInventory(corporationId, forceRefresh).catch((e) =>
			logger.error('Structure inventory fetch failed:', e instanceof Error ? e.message : String(e))
		)
	}

	/**
	 * Fetch corporation structures
	 */
	async fetchStructures(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreStructures(corporationId, forceRefresh)
	}

	/**
	 * Fetch market and industry data
	 */
	async fetchMarketData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
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
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreKillmails(corporationId, forceRefresh)
	}

	// ========================================================================
	// GETTER METHODS (public)
	// ========================================================================

	/**
	 * Get corporation public information
	 */
	async getCorporationInfo(corporationId: string): Promise<CorporationPublicData | null> {
		const result = await this.getDb().query.corporationPublicInfo.findFirst({
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
		const results = await this.getDb().query.corporationMembers.findMany({
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
	 * Get corporation members list as a backend-paginated page.
	 * Ordered by role (CEO, Director, Member) then character ID.
	 */
	async getMembersPaginated(
		corporationId: string,
		page: number,
		limit: number
	): Promise<CorporationMembersPageData> {
		const safePage = Math.max(1, Math.trunc(page))
		const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200)

		const [corpInfo, totalRow] = await Promise.all([
			this.getDb().query.corporationPublicInfo.findFirst({
				where: eq(corporationPublicInfo.corporationId, corporationId),
				columns: {
					ceoId: true,
				},
			}),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.where(eq(corporationMembers.corporationId, corporationId))
				.then((rows) => rows[0] ?? { count: 0 }),
		])

		const totalItems = Number(totalRow.count ?? 0)
		const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit))
		const currentPage = Math.min(safePage, totalPages)
		const pageOffset = (currentPage - 1) * safeLimit

		if (totalItems === 0) {
			return {
				items: [],
				pagination: {
					page: currentPage,
					limit: safeLimit,
					totalItems,
					totalPages,
					hasNextPage: false,
					hasPreviousPage: false,
				},
				summary: {
					total: 0,
					active: 0,
					inactive: 0,
					directors: 0,
				},
			}
		}

		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
		const [activeCountRow, inactiveCountRow, directorCountRow] = await Promise.all([
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationMemberTracking,
					and(
						eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
						eq(corporationMemberTracking.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						gt(corporationMemberTracking.logonDate, sevenDaysAgo)
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationMemberTracking,
					and(
						eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
						eq(corporationMemberTracking.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						lte(corporationMemberTracking.logonDate, sevenDaysAgo)
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationDirectors,
					and(
						eq(corporationDirectors.corporationId, corporationMembers.corporationId),
						eq(corporationDirectors.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						sql`${corporationDirectors.characterId} is not null`,
						corpInfo?.ceoId
							? sql`${corporationMembers.characterId} <> ${corpInfo.ceoId}`
							: sql`1 = 1`
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
		])

		const memberRows = await this.getDb()
			.select({
				characterId: corporationMembers.characterId,
				lastEsiUpdate: corporationMembers.updatedAt,
				joinDate: corporationMemberTracking.startDate,
				lastLogin: corporationMemberTracking.logonDate,
				directorCharacterId: corporationDirectors.characterId,
			})
			.from(corporationMembers)
			.leftJoin(
				corporationMemberTracking,
				and(
					eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
					eq(corporationMemberTracking.characterId, corporationMembers.characterId)
				)
			)
			.leftJoin(
				corporationDirectors,
				and(
					eq(corporationDirectors.corporationId, corporationMembers.corporationId),
					eq(corporationDirectors.characterId, corporationMembers.characterId)
				)
			)
			.where(eq(corporationMembers.corporationId, corporationId))
			.orderBy(
				sql`case
					when ${corpInfo?.ceoId ?? ''} <> '' and ${corporationMembers.characterId} = ${corpInfo?.ceoId ?? ''} then 0
					when ${corporationDirectors.characterId} is not null then 1
					else 2
				end`,
				corporationMembers.characterId
			)
			.limit(safeLimit)
			.offset(pageOffset)

		const now = Date.now()
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

		const items = memberRows.map((row) => {
			const role: 'CEO' | 'Director' | 'Member' =
				corpInfo?.ceoId && row.characterId === corpInfo.ceoId
					? 'CEO'
					: row.directorCharacterId
						? 'Director'
						: 'Member'
			const activityStatus: 'active' | 'inactive' | 'unknown' = row.lastLogin
				? now - row.lastLogin.getTime() < sevenDaysMs
					? 'active'
					: 'inactive'
				: 'unknown'

			return {
				characterId: row.characterId,
				role,
				joinDate: row.joinDate,
				lastLogin: row.lastLogin,
				lastEsiUpdate: row.lastEsiUpdate,
				activityStatus,
			}
		})

		return {
			items,
			pagination: {
				page: currentPage,
				limit: safeLimit,
				totalItems,
				totalPages,
				hasNextPage: currentPage < totalPages,
				hasPreviousPage: currentPage > 1,
			},
			summary: {
				total: totalItems,
				active: Number(activeCountRow.count ?? 0),
				inactive: Number(inactiveCountRow.count ?? 0),
				directors: Number(directorCountRow.count ?? 0),
			},
		}
	}

	/**
	 * Get corporation IDs for a list of character IDs
	 * Queries the corporation_members table across all corporations
	 */
	async getCorporationIdsByCharacterIds(characterIds: string[]): Promise<Record<string, string>> {
		if (characterIds.length === 0) {
			return {}
		}

		logger.debug('[EveCorporationData] getCorporationIdsByCharacterIds: Starting', {
			characterIdsCount: characterIds.length,
		})

		// Query corporation_members table for all matching character IDs
		const results = await this.getDb().query.corporationMembers.findMany({
			where: inArray(corporationMembers.characterId, characterIds),
			columns: {
				characterId: true,
				corporationId: true,
			},
		})

		// Build result map: characterId -> corporationId
		const result: Record<string, string> = {}
		for (const row of results) {
			result[row.characterId] = row.corporationId
		}

		logger.debug('[EveCorporationData] getCorporationIdsByCharacterIds: Completed', {
			characterIdsCount: characterIds.length,
			foundCount: results.length,
			resultCount: Object.keys(result).length,
		})

		return result
	}

	/**
	 * Get corporation member tracking data
	 */
	async getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]> {
		const results = await this.getDb().query.corporationMemberTracking.findMany({
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
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const response = await tokenStore.fetchEsi<number[]>(
			`/corporations/${corporationId}/members`,
			characterId,
			{ cacheMode: 'no-store' }
		)

		const currentMemberIds = new Set(response.data.map(String))

		// Fetch all members from database
		const dbMembers = await this.getDb()
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
		await this.getDb()
			.delete(corporationMembers)
			.where(
				and(
					eq(corporationMembers.corporationId, corporationId),
					inArray(corporationMembers.characterId, staleMemberIds)
				)
			)

		// Remove stale member tracking
		await this.getDb()
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
			? await this.getDb().query.corporationWallets.findMany({
				where: and(
					eq(corporationWallets.corporationId, corporationId),
					eq(corporationWallets.division, division)
				),
			})
			: await this.getDb().query.corporationWallets.findMany({
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
		limit = 10000
	): Promise<CorporationWalletJournalData[]> {
		const results = division
			? await this.getDb().query.corporationWalletJournal.findMany({
				where: and(
					eq(corporationWalletJournal.corporationId, corporationId),
					eq(corporationWalletJournal.division, division)
				),
				orderBy: desc(corporationWalletJournal.date),
				limit,
			})
			: await this.getDb().query.corporationWalletJournal.findMany({
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
		limit = 10000
	): Promise<CorporationWalletTransactionData[]> {
		const results = division
			? await this.getDb().query.corporationWalletTransactions.findMany({
				where: and(
					eq(corporationWalletTransactions.corporationId, corporationId),
					eq(corporationWalletTransactions.division, division)
				),
				orderBy: desc(corporationWalletTransactions.date),
				limit,
			})
			: await this.getDb().query.corporationWalletTransactions.findMany({
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

	async getWalletJournalWindow(
		corporationId: string,
		filters: WalletJournalWindowFilters = {}
	): Promise<CorporationWalletJournalData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions: SQL[] = [eq(corporationWalletJournal.corporationId, corporationId)]
		if (filters.division !== undefined) {
			conditions.push(eq(corporationWalletJournal.division, filters.division))
		}
		if (filters.refTypes && filters.refTypes.length > 0) {
			conditions.push(inArray(corporationWalletJournal.refType, filters.refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(corporationWalletJournal.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(corporationWalletJournal.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(corporationWalletJournal.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(corporationWalletJournal.date, filters.toDate))
		}
		const minAmount = Number(filters.minAmount)
		if (Number.isFinite(minAmount)) {
			conditions.push(sql`CAST(${corporationWalletJournal.amount} AS numeric) >= ${minAmount}`)
		}
		const maxAmount = Number(filters.maxAmount)
		if (Number.isFinite(maxAmount)) {
			conditions.push(sql`CAST(${corporationWalletJournal.amount} AS numeric) <= ${maxAmount}`)
		}

		const rows = await this.getDb().query.corporationWalletJournal.findMany({
			where: and(...conditions),
			orderBy: [desc(corporationWalletJournal.date), desc(corporationWalletJournal.journalId)],
			limit,
			offset,
		})

		return rows.map((r) => ({
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

	async getWalletTransactionsWindow(
		corporationId: string,
		filters: WalletTransactionWindowFilters = {}
	): Promise<CorporationWalletTransactionData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions: SQL[] = [eq(corporationWalletTransactions.corporationId, corporationId)]
		if (filters.division !== undefined) {
			conditions.push(eq(corporationWalletTransactions.division, filters.division))
		}
		if (filters.clientId) {
			conditions.push(eq(corporationWalletTransactions.clientId, filters.clientId))
		}
		if (filters.journalRefId) {
			conditions.push(eq(corporationWalletTransactions.journalRefId, filters.journalRefId))
		}
		if (filters.fromDate) {
			conditions.push(gte(corporationWalletTransactions.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(corporationWalletTransactions.date, filters.toDate))
		}
		const minUnitPrice = Number(filters.minUnitPrice)
		if (Number.isFinite(minUnitPrice)) {
			conditions.push(
				sql`CAST(${corporationWalletTransactions.unitPrice} AS numeric) >= ${minUnitPrice}`
			)
		}
		const maxUnitPrice = Number(filters.maxUnitPrice)
		if (Number.isFinite(maxUnitPrice)) {
			conditions.push(
				sql`CAST(${corporationWalletTransactions.unitPrice} AS numeric) <= ${maxUnitPrice}`
			)
		}

		const rows = await this.getDb().query.corporationWalletTransactions.findMany({
			where: and(...conditions),
			orderBy: [
				desc(corporationWalletTransactions.date),
				desc(corporationWalletTransactions.transactionId),
			],
			limit,
			offset,
		})

		return rows.map((r) => ({
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

	async getWalletDivisions(corporationId: string): Promise<number[]> {
		const wallets = await this.getWallets(corporationId)
		const divisions = new Set<number>()
		for (const wallet of wallets) {
			divisions.add(wallet.division)
		}
		return Array.from(divisions).sort((a, b) => a - b)
	}

	async getCorporationTaxMetadata(corporationId: string): Promise<CorporationTaxMetadata | null> {
		const publicInfo = await this.getCorporationInfo(corporationId)
		if (!publicInfo) {
			return null
		}

		const taxRateDecimal = Number(publicInfo.taxRate)
		return {
			corporationId,
			inGameTaxRateBps: Number.isFinite(taxRateDecimal)
				? Math.round(taxRateDecimal * 10_000)
				: null,
			ceoId: publicInfo.ceoId,
			memberCount: publicInfo.memberCount,
			allianceId: publicInfo.allianceId,
			updatedAt: publicInfo.updatedAt,
		}
	}

	async getCorporationSyncHealth(corporationId: string): Promise<CorporationSyncHealth> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		return {
			corporationId,
			isConfigured: !!config,
			lastVerified: config?.lastVerified ?? null,
			sync: {
				membersLastSync: config?.membersLastSync ?? null,
				memberTrackingLastSync: config?.memberTrackingLastSync ?? null,
				walletsLastSync: config?.walletsLastSync ?? null,
				walletJournalLastSync: config?.walletJournalLastSync ?? null,
				walletTransactionsLastSync: config?.walletTransactionsLastSync ?? null,
				assetsLastSync: config?.assetsLastSync ?? null,
				structuresLastSync: config?.structuresLastSync ?? null,
				ordersLastSync: config?.ordersLastSync ?? null,
				contractsLastSync: config?.contractsLastSync ?? null,
				industryJobsLastSync: config?.industryJobsLastSync ?? null,
				killmailsLastSync: config?.killmailsLastSync ?? null,
			},
		}
	}

	async getCorporationAuthStatus(corporationId: string): Promise<CorporationAuthStatus> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		const directors = config ? await this.getDirectors(corporationId) : []
		const healthyDirectorCount = directors.filter((director) => director.isHealthy).length
		const tokenStoreStub = this.getEveTokenStoreStub()
		const scopeSet = new Set<string>()

		await Promise.all(
			directors.map(async (director) => {
				try {
					const tokenInfo = await tokenStoreStub.getTokenInfo(director.characterId)
					if (!tokenInfo || tokenInfo.isExpired) {
						return
					}
					for (const scope of tokenInfo.scopes) {
						scopeSet.add(scope)
					}
				} catch (error) {
					logger.warn('[EveCorporationData] Failed to resolve director token scopes', {
						corporationId,
						directorCharacterId: director.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		const requiredScopes = [REQUIRED_CORPORATION_WALLET_SCOPE]
		const missingRequiredScopes = requiredScopes.filter((scope) => !scopeSet.has(scope))
		const hasCorporationWalletScope = scopeSet.has(REQUIRED_CORPORATION_WALLET_SCOPE)
		const hasCharacterWalletScope = scopeSet.has(CHARACTER_WALLET_SCOPE)
		const hasCorporationMembershipScope = scopeSet.has(CORPORATION_MEMBERSHIP_SCOPE)

		return {
			corporationId,
			isConfigured: !!config,
			isVerified: config?.isVerified ?? false,
			lastVerified: config?.lastVerified ?? null,
			directorCount: directors.length,
			healthyDirectorCount,
			requiredScopes,
			missingRequiredScopes,
			hasRequiredScopes: missingRequiredScopes.length === 0,
			hasCorporationWalletScope,
			hasCharacterWalletScope,
			hasCorporationMembershipScope,
			grantedScopeCount: scopeSet.size,
		}
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

	private async getCachedAssets(
		corporationId: string,
		filters?: SearchAssetsFilters
	): Promise<CorporationAssetData[]> {
		const where: SQL[] = [eq(corporationAssets.corporationId, corporationId)]
		if (filters?.itemId) {
			where.push(eq(corporationAssets.itemId, filters.itemId))
		}
		if (filters?.isSingleton) {
			where.push(eq(corporationAssets.isSingleton, filters.isSingleton))
		}
		if (filters?.locationFlag) {
			where.push(eq(corporationAssets.locationFlag, filters.locationFlag))
		}
		if (filters?.locationId) {
			where.push(eq(corporationAssets.locationId, filters.locationId))
		}
		if (filters?.locationType) {
			where.push(eq(corporationAssets.locationType, filters.locationType))
		}
		if (filters?.quantity) {
			where.push(eq(corporationAssets.quantity, filters.quantity))
		}
		if (filters?.typeId) {
			where.push(eq(corporationAssets.typeId, filters.typeId))
		}
		if (filters?.isBlueprintCopy) {
			where.push(eq(corporationAssets.isBlueprintCopy, filters.isBlueprintCopy))
		}
		const results = await this.getDb().query.corporationAssets.findMany({
			where: and(...where),
			limit: filters?.limit,
		})
		return results
	}

	async searchAssets(
		corporationId: string,
		filters?: SearchAssetsFilters
	): Promise<CorporationAssetData[]> {
		const results = await this.getCachedAssets(corporationId, filters)
		return results
	}

	/**
	 * Get corporation assets
	 */
	async getAssets(corporationId: string, limit = 10000): Promise<CorporationAssetData[]> {
		const results = await this.getDb().query.corporationAssets.findMany({
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

	async getStructureInventory(
		corporationId: string,
		structureId?: string,
		limit = 10000
	): Promise<CorporationStructureInventoryData[]> {
		const where = structureId
			? and(
				eq(corporationStructureInventory.corporationId, corporationId),
				eq(corporationStructureInventory.structureId, structureId)
			)
			: eq(corporationStructureInventory.corporationId, corporationId)

		const results = await this.getDb().query.corporationStructureInventory.findMany({
			where,
			limit,
		})

		return results.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			structureId: row.structureId,
			itemId: row.itemId,
			isSingleton: row.isSingleton,
			locationFlag: row.locationFlag,
			locationType: row.locationType,
			quantity: row.quantity,
			typeId: row.typeId,
			updatedAt: row.updatedAt,
		}))
	}

	/**
	 * Get corporation structures
	 */
	async getStructures(
		corporationId: string,
		filters?: CorporationStructureQuery
	): Promise<CorporationStructureData[]> {
		const conditions = [eq(corporationStructures.corporationId, corporationId)]
		if (filters?.lowPower === 'true') {
			conditions.push(eq(corporationStructures.lowPower, true))
		} else if (filters?.lowPower === 'false') {
			conditions.push(eq(corporationStructures.lowPower, false))
		}
		if (filters?.regionId) {
			conditions.push(eq(corporationStructures.regionId, filters.regionId))
		}
		if (filters?.systemId) {
			conditions.push(eq(corporationStructures.systemId, filters.systemId))
		}
		if (filters?.state) {
			conditions.push(eq(corporationStructures.state, filters.state))
		}
		if (filters?.typeId) {
			conditions.push(eq(corporationStructures.typeId, filters.typeId))
		}

		const results = await this.getDb().query.corporationStructures.findMany({
			where: conditions.length > 1 ? and(...conditions) : conditions[0],
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			structureId: r.structureId,
			name: r.name,
			typeId: r.typeId,
			typeName: r.typeName,
			systemId: r.systemId,
			systemName: r.systemName,
			regionId: r.regionId,
			regionName: r.regionName,
			profileId: r.profileId,
			fuelExpires: r.fuelExpires,
			fuelAmount: r.fuelAmount,
			nextReinforceApply: r.nextReinforceApply,
			nextReinforceHour: r.nextReinforceHour,
			reinforceHour: r.reinforceHour,
			state: r.state,
			stateTimerEnd: r.stateTimerEnd,
			stateTimerStart: r.stateTimerStart,
			unanchorsAt: r.unanchorsAt,
			lowPower: r.lowPower,
			syncStatus: r.syncStatus,
			syncFailureReason: r.syncFailureReason,
			lastSyncedAt: r.lastSyncedAt,
			services: r.services,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get structure details from the synced corporation snapshot.
	 */
	async getStructureDetails(
		corporationId: string,
		structureId: string
	): Promise<CorporationStructureData | null> {
		const structure = await this.getDb().query.corporationStructures.findFirst({
			where: and(
				eq(corporationStructures.corporationId, corporationId),
				eq(corporationStructures.structureId, structureId)
			),
		})

		if (!structure) {
			return null
		}

		return {
			id: structure.id,
			corporationId: structure.corporationId,
			structureId: structure.structureId,
			name: structure.name,
			typeId: structure.typeId,
			typeName: structure.typeName,
			systemId: structure.systemId,
			systemName: structure.systemName,
			regionId: structure.regionId,
			regionName: structure.regionName,
			profileId: structure.profileId,
			fuelExpires: structure.fuelExpires,
			fuelAmount: structure.fuelAmount,
			nextReinforceApply: structure.nextReinforceApply,
			nextReinforceHour: structure.nextReinforceHour,
			reinforceHour: structure.reinforceHour,
			state: structure.state,
			stateTimerEnd: structure.stateTimerEnd,
			stateTimerStart: structure.stateTimerStart,
			unanchorsAt: structure.unanchorsAt,
			lowPower: structure.lowPower,
			syncStatus: structure.syncStatus,
			syncFailureReason: structure.syncFailureReason,
			lastSyncedAt: structure.lastSyncedAt,
			services: structure.services,
			updatedAt: structure.updatedAt,
		}
	}

	/**
	 * Get complete assets data
	 */
	async getAssetsData(corporationId: string): Promise<CorporationAssetsData | null> {
		const [assets, structures, structureInventory] = await Promise.all([
			this.getAssets(corporationId),
			this.getStructures(corporationId),
			this.getStructureInventory(corporationId),
		])

		if (assets.length === 0 && structures.length === 0 && structureInventory.length === 0) {
			return null
		}

		return {
			assets,
			structures,
			structureInventory,
		}
	}

	/**
	 * Get corporation market orders
	 */
	async getOrders(corporationId: string): Promise<CorporationOrderData[]> {
		const results = await this.getDb().query.corporationOrders.findMany({
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
			? await this.getDb().query.corporationContracts.findMany({
				where: and(
					eq(corporationContracts.corporationId, corporationId),
					eq(corporationContracts.status, status)
				),
			})
			: await this.getDb().query.corporationContracts.findMany({
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
	 * Get alliance courier contracts by assignee ID
	 */
	async getAllianceCourierContracts(
		allianceId: string,
		status?: string,
		page = 1,
		limit = 25,
		sortBy: CorporationContractSortBy = 'expires',
		sortDirection: SortDirection = 'asc'
	): Promise<CorporationContractsPageData> {
		const safePage = Math.max(1, Math.trunc(page))
		const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100)
		const conditions: SQL[] = [
			eq(corporationContracts.assigneeId, allianceId),
			eq(corporationContracts.type, 'courier'),
			gt(corporationContracts.dateExpired, new Date()),
		]
		if (status) {
			conditions.push(eq(corporationContracts.status, status))
		}

		const results = await this.getDb()
			.selectDistinctOn([corporationContracts.contractId])
			.from(corporationContracts)
			.where(and(...conditions))
			.orderBy(corporationContracts.contractId, desc(corporationContracts.dateIssued))

		const mapped = results.map((r) => this.mapAllianceCourierContract(r))
		const sorted = [...mapped].sort((left, right) =>
			this.compareAllianceCourierContracts(left, right, sortBy, sortDirection)
		)

		const totalItems = sorted.length
		const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit))
		const currentPage = Math.min(safePage, totalPages)
		const pageOffset = (currentPage - 1) * safeLimit

		if (totalItems === 0) {
			return {
				items: [],
				pagination: {
					page: currentPage,
					limit: safeLimit,
					totalItems,
					totalPages,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			}
		}

		const pageItems = sorted.slice(pageOffset, pageOffset + safeLimit)

		return {
			items: pageItems,
			pagination: {
				page: currentPage,
				limit: safeLimit,
				totalItems,
				totalPages,
				hasNextPage: currentPage < totalPages,
				hasPreviousPage: currentPage > 1,
			},
		}
	}

	/**
	 * Get leaderboard for completed courier contracts assigned to an alliance
	 */
	async getCourierLeaderboard(allianceId: string, since?: Date): Promise<CourierLeaderboard> {
		const conditions: SQL[] = [
			eq(corporationContracts.assigneeId, allianceId),
			eq(corporationContracts.type, 'courier'),
			eq(corporationContracts.status, 'finished'),
		]
		if (since) {
			conditions.push(gt(corporationContracts.dateCompleted, since))
		}

		const distinct = this.getDb()
			.selectDistinctOn([corporationContracts.contractId], {
				contractId: corporationContracts.contractId,
				acceptorId: corporationContracts.acceptorId,
				volume: corporationContracts.volume,
				reward: corporationContracts.reward,
				dateCompleted: corporationContracts.dateCompleted,
			})
			.from(corporationContracts)
			.where(and(...conditions))
			.as('distinct_contracts')

		const results = await this.getDb()
			.select({
				acceptorId: distinct.acceptorId,
				contractsCompleted: sql<number>`count(*)`.as('contracts_completed'),
				totalVolume: sql<number>`coalesce(sum(cast(${distinct.volume} as numeric)), 0)`.as(
					'total_volume'
				),
				totalReward: sql<number>`coalesce(sum(cast(${distinct.reward} as numeric)), 0)`.as(
					'total_reward'
				),
				oldestContract: sql<Date | null>`min(${distinct.dateCompleted})`.as('oldest_contract'),
			})
			.from(distinct)
			.groupBy(distinct.acceptorId)
			.orderBy(sql`count(*) desc`)

		const entries = results
			.filter((r) => r.acceptorId !== null)
			.map((r) => ({
				acceptorId: r.acceptorId!,
				contractsCompleted: Number(r.contractsCompleted),
				totalVolume: Number(r.totalVolume),
				totalReward: Number(r.totalReward),
			}))

		const oldestContractDate = results.reduce<Date | null>((min, r) => {
			if (!r.oldestContract) return min
			const d = new Date(r.oldestContract)
			return min === null || d < min ? d : min
		}, null)

		return { entries, oldestContractDate }
	}

	/**
	 * Get corporation industry jobs
	 */
	async getIndustryJobs(
		corporationId: string,
		status?: string
	): Promise<CorporationIndustryJobData[]> {
		const results = status
			? await this.getDb().query.corporationIndustryJobs.findMany({
				where: and(
					eq(corporationIndustryJobs.corporationId, corporationId),
					eq(corporationIndustryJobs.status, status)
				),
			})
			: await this.getDb().query.corporationIndustryJobs.findMany({
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
		const results = await this.getDb().query.corporationKillmails.findMany({
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
		const result = await this.getDb().query.characterCorporationRoles.findFirst({
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
