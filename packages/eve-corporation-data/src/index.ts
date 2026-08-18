/**
 * @repo/eve-corporation-data
 *
 * Shared types and interfaces for the EveCorporationData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// ============================================================================
// SYNC WORKFLOW TYPES
// ============================================================================

/**
 * Supported data types for corporation synchronization workflows.
 */
export type EveCorporationSyncDataType =
	| 'public-info'
	| 'members'
	| 'member-tracking'
	| 'wallets'
	| 'wallet-journal'
	| 'wallet-transactions'
	| 'assets'
	| 'structures'
	| 'skyhooks'
	| 'orders'
	| 'contracts'
	| 'industry-jobs'
	| 'killmails'

// ============================================================================
// ESI RESPONSE TYPES (match EVE Online API - snake_case)
// ============================================================================

/**
 * ESI Corporation Public Info Response
 * GET /corporations/{corporation_id}
 */
export interface EsiCorporationPublicInfo {
	corporation_id: string
	name: string
	ticker: string
	ceo_id: string
	creator_id: string
	date_founded?: string // ISO 8601 date
	description?: string
	home_station_id?: string
	member_count: number
	shares?: number
	tax_rate: number
	url?: string
	alliance_id?: string
	faction_id?: string
	war_eligible?: boolean
}

/**
 * ESI Corporation Roles Response
 * GET /characters/{character_id}/roles
 */
export interface EsiCharacterRoles {
	roles?: string[]
	roles_at_hq?: string[]
	roles_at_base?: string[]
	roles_at_other?: string[]
}

/**
 * ESI Corporation Members Response
 * GET /corporations/{corporation_id}/members
 */
export type EsiCorporationMembers = string[]

/**
 * ESI Corporation Member Tracking Response
 * GET /corporations/{corporation_id}/membertracking
 */
export interface EsiCorporationMemberTracking {
	character_id: string
	base_id?: string
	location_id?: string
	logoff_date?: string
	logon_date?: string
	ship_type_id?: string
	start_date?: string
}

/**
 * ESI Corporation Wallets Response
 * GET /corporations/{corporation_id}/wallets
 */
export interface EsiCorporationWallet {
	division: number
	balance: string // String to avoid bigint precision issues with large ISK amounts
}

/**
 * ESI Corporation Wallet Journal Entry
 * GET /corporations/{corporation_id}/wallets/{division}/journal
 */
export interface EsiCorporationWalletJournalEntry {
	id: string
	amount?: string // String to avoid bigint precision issues
	balance?: string // String to avoid bigint precision issues
	context_id?: string
	context_id_type?: string
	date: string
	description: string
	first_party_id?: string
	reason?: string
	ref_type: string
	second_party_id?: string
	tax?: string // String to avoid bigint precision issues
	tax_receiver_id?: string
}

/**
 * ESI Corporation Wallet Transaction
 * GET /corporations/{corporation_id}/wallets/{division}/transactions
 */
export interface EsiCorporationWalletTransaction {
	transaction_id: string
	client_id: string
	date: string
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: string
	location_id: string
	quantity: number
	type_id: string
	unit_price: string
}

/**
 * ESI Corporation Asset
 * GET /corporations/{corporation_id}/assets
 */
export interface EsiCorporationAsset {
	item_id: string
	is_singleton: boolean
	location_flag: string
	location_id: string
	location_type: string
	quantity: number
	type_id: string
	is_blueprint_copy?: boolean
}

/**
 * ESI Corporation Structure
 * GET /corporations/{corporation_id}/structures
 */
export interface EsiCorporationStructure {
	structure_id: string
	corporation_id: string
	type_id: string
	system_id: string
	profile_id: string
	fuel_expires?: string
	next_reinforce_apply?: string
	next_reinforce_hour?: number
	reinforce_hour?: number
	state: string
	state_timer_end?: string
	state_timer_start?: string
	unanchors_at?: string
	services?: Array<{
		name: string
		state: string
	}>
}

/**
 * ESI Sovereignty system claim details
 * GET /sovereignty/systems
 *
 * The OpenAPI response nests the current claim under `claim`.
 */
export interface EsiSovereigntySystem {
	system_id: string
	system_name?: string | null
	claim_type: 'alliance' | 'faction' | 'unclaimed'
	alliance_id?: string | null
	corporation_id?: string | null
	faction_id?: string | null
	claimed_since?: string | null
	is_capital_system?: boolean | null
	sovereignty_hub_structure_id?: string | null
	vulnerability_window?: {
		start: string
		end: string
	} | null
	activity_defense_multiplier?: string | number | null
	military_level?: number | null
	industrial_level?: number | null
	strategic_level?: number | null
}

/**
 * ESI sovereignty hub details from the corporation sovereignty hub endpoint.
 * Solar-system display metadata is resolved during persistence.
 */
export interface EsiSovereigntyHub {
	structure_id: string
	corporation_id: string
	system_id: string
	system_name?: string | null
	type_id: string
	controller_alliance_id?: string | null
	fuel_access_list_id: string | null
	reagent_bay: {
		last_updated: string
		reagents: Array<{
			type_id: string
			amount: number
			burning_per_hour: number
			last_cycle: string
		}>
	}
	resources: {
		power: {
			allocated: number
			available: number
		}
		workforce: {
			allocated: number
			available: number
		}
	}
	upgrades: Array<{
		type_id: string
		power_state: string
	}>
	vulnerability_window: {
		start: string
		end: string
	} | null
	workforce_transport: {
		configuration:
			| {
					import: {
						sources: Array<{
							solar_system_id: number
						}>
					}
			  }
			| {
					export: {
						amount: number
						solar_system_id?: number
					}
			  }
			| {
					transit: boolean | null
			  }
		state:
			| {
					import: {
						sources: Array<{
							amount: number
							solar_system_id: number
						}>
					}
			  }
			| {
					export: {
						amount: number
						solar_system_id?: number
					}
			  }
			| {
					transit: boolean | null
			  }
	}
	raw: Record<string, unknown>
}

/**
 * ESI corporation skyhook snapshot.
 * GET /corporations/{corporation_id}/structures/skyhooks
 * GET /corporations/{corporation_id}/structures/skyhooks/{skyhook_id}
 */
export interface EsiCorporationSkyhook {
	structure_id: string
	planet_id: string
	corporation_id: string
	state: string
	is_active: boolean
	effective_workforce: number | null
	reagents: Array<{
		type_id: string
		secured_stock: number
		unsecured_stock: number
		last_cycle: string
	}>
	reinforcement_timer: {
		end: string
	} | null
	theft_vulnerability: {
		start: string
		end: string
	} | null
	raw: Record<string, unknown>
}

/**
 * ESI corporation mining extraction state for refinery-based mining citadels.
 * GET /corporation/{corporation_id}/mining/extractions
 */
export interface EsiCorporationMiningExtraction {
	structure_id: string
	moon_id: string
	extraction_start_time?: string | null
	chunk_arrival_time?: string | null
	natural_decay_time?: string | null
	raw?: Record<string, unknown>
}

/**
 * ESI Corporation Market Order
 * GET /corporations/{corporation_id}/orders
 */
export interface EsiCorporationOrder {
	order_id: string
	duration: number
	escrow?: number
	is_buy_order: boolean
	issued: string
	issued_by: string
	location_id: string
	min_volume?: number
	price: number
	range: string
	region_id: string
	type_id: string
	volume_remain: number
	volume_total: number
	wallet_division: number
}

/**
 * ESI Corporation Contract
 * GET /corporations/{corporation_id}/contracts
 */
export interface EsiCorporationContract {
	contract_id: string
	acceptor_id?: string
	assignee_id: string
	availability: string
	buyout?: number
	collateral?: number
	date_accepted?: string
	date_completed?: string
	date_expired: string
	date_issued: string
	days_to_complete?: number
	end_location_id?: string
	for_corporation: boolean
	issuer_corporation_id: string
	issuer_id: string
	price?: number
	reward?: number
	start_location_id?: string
	status: string
	title?: string
	type: string
	volume?: number
}

/**
 * ESI Corporation Industry Job
 * GET /corporations/{corporation_id}/industry/jobs
 */
export interface EsiCorporationIndustryJob {
	job_id: string
	installer_id: string
	facility_id: string
	location_id: string
	activity_id: string
	blueprint_id: string
	blueprint_type_id: string
	blueprint_location_id: string
	output_location_id: string
	runs: number
	cost?: number
	licensed_runs?: number
	probability?: number
	product_type_id?: string
	status: string
	duration: number
	start_date: string
	end_date: string
	pause_date?: string
	completed_date?: string
	completed_character_id?: string
	successful_runs?: number
}

/**
 * ESI Corporation Killmail
 * GET /corporations/{corporation_id}/killmails/recent
 */
export interface EsiCorporationKillmail {
	killmail_id: string
	killmail_hash: string
}

// ============================================================================
// DATABASE TYPES (camelCase, match our schema)
// ============================================================================

export enum CorporationType {
	Member = 'member',
	Alt = 'alt',
	SpecialPurpose = 'special_purpose',
}

export interface CorporationLastSyncData {
	membersLastSync: Date | null
	memberTrackingLastSync: Date | null
	walletsLastSync: Date | null
	walletJournalLastSync: Date | null
	walletTransactionsLastSync: Date | null
	assetsLastSync: Date | null
	structuresLastSync: Date | null
	ordersLastSync: Date | null
	contractsLastSync: Date | null
	industryJobsLastSync: Date | null
	killmailsLastSync: Date | null
}

export interface WalletJournalStoreResult {
	persistedNewRows: number
}

export interface WalletJournalWatermark {
	maxJournalId: string | null
	maxJournalDate: Date | null
}

export interface WalletTransactionsStoreResult {
	persistedNewRows: number
}

export interface WalletTransactionWatermark {
	maxTransactionId: string | null
	maxTransactionDate: Date | null
}

export interface SkyhookStoreResult {
	prunedCount: number
}

export interface StructureSyncPriority {
	structureId: string
	lastAttemptedSyncAt: Date | null
	lastSyncedAt: Date | null
}

export type SkyhookSyncPriority = StructureSyncPriority

export type SovereigntyHubSyncPriority = StructureSyncPriority

export type MoonDrillSyncPriority = StructureSyncPriority

export type MiningCitadelSyncPriority = StructureSyncPriority

export interface StructurePriorityQueue {
	newStructureIds: string[]
	pruneCandidateIds: string[]
	syncPriorities: StructureSyncPriority[]
}

export type StructureSyncFailureTarget =
	| 'structures'
	| 'sovereignty'
	| 'skyhooks'
	| 'moon-drills'
	| 'mining-extractions'

/**
 * Targets for live-list based structure-priority queries.
 */
export type StructureSyncPriorityTarget =
	| 'sovereignty'
	| 'skyhooks'
	| 'moon-drills'
	| 'mining-extractions'

/**
 * A compact structure-priority queue entry used by enrichment batching.
 */
export interface StructurePriorityQueueEntry<
	P extends StructureSyncPriority = StructureSyncPriority,
> {
	entry: { id: string | number }
	index: number
	priority: P | null
}

export interface StructurePriorityQueueResult<
	T extends { id: string | number },
	P extends StructureSyncPriority = StructureSyncPriority,
> {
	entries: Array<StructurePriorityQueueEntry<P> & { entry: T }>
	pruneCandidateIds: string[]
}

/**
 * Corporation configuration data
 */
export interface CorporationConfigData extends CorporationLastSyncData {
	corporationId: string
	characterId: string
	characterName: string
	lastVerified: Date | null
	isVerified: boolean
	createdAt: Date
	updatedAt: Date
	includeInBackgroundRefresh: boolean
	includeInStructureAssetSync: boolean
	corporationType: CorporationType
}

export interface CorporationSyncConfigData {
	includeInBackgroundRefresh: boolean
	includeInStructureAssetSync: boolean
	assetsLastSync: Date | null
	structuresLastSync: Date | null
}

export interface CorporationNeedingRefreshData {
	members: CorporationConfigData[]
	'member-tracking': CorporationConfigData[]
	wallets: CorporationConfigData[]
	'wallet-journal': CorporationConfigData[]
	'wallet-transactions': CorporationConfigData[]
	assets: CorporationConfigData[]
	structures: CorporationConfigData[]
	orders: CorporationConfigData[]
	contracts: CorporationConfigData[]
	'industry-jobs': CorporationConfigData[]
	killmails: CorporationConfigData[]
}

/**
 * Character corporation roles data
 */
export interface CharacterCorporationRolesData {
	id: string
	corporationId: string
	characterId: string
	roles: string[]
	rolesAtHq?: string[]
	rolesAtBase?: string[]
	rolesAtOther?: string[]
	updatedAt: Date
}

/**
 * Corporation public information data
 */
export interface CorporationPublicData {
	corporationId: string
	name: string
	ticker: string
	ceoId: string
	creatorId: string
	dateFounded: Date | null
	description: string | null
	homeStationId: string | null
	memberCount: number
	shares: string | null
	taxRate: string
	url: string | null
	allianceId: string | null
	factionId: string | null
	warEligible: boolean | null
	updatedAt: Date
}

/**
 * Corporation member data
 */
export interface CorporationMemberData {
	id: string
	corporationId: string
	characterId: string
	updatedAt: Date
}

export interface CorporationMemberPageItemData {
	characterId: string
	role: 'CEO' | 'Director' | 'Member'
	joinDate: Date | null
	lastLogin: Date | null
	lastEsiUpdate: Date
	activityStatus: 'active' | 'inactive' | 'unknown'
}

export interface CorporationMembersPageData {
	items: CorporationMemberPageItemData[]
	pagination: {
		page: number
		limit: number
		totalItems: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	summary: {
		total: number
		active: number
		inactive: number
		directors: number
	}
}

/**
 * Corporation member tracking data
 */
export interface CorporationMemberTrackingData {
	id: string
	corporationId: string
	characterId: string
	baseId: string | null
	locationId: string | null
	logoffDate: Date | null
	logonDate: Date | null
	shipTypeId: string | null
	startDate: Date | null
	updatedAt: Date
}

/**
 * Corporation wallet data
 */
export interface CorporationWalletData {
	id: string
	corporationId: string
	division: number
	balance: string
	updatedAt: Date
}

/**
 * Corporation wallet journal entry data
 */
export interface CorporationWalletJournalData {
	id: string
	corporationId: string
	division: number
	journalId: string
	amount: string | null
	balance: string | null
	contextId: string | null
	contextIdType: string | null
	date: Date
	description: string
	firstPartyId: string | null
	reason: string | null
	refType: string
	secondPartyId: string | null
	tax: string | null
	taxReceiverId: string | null
	updatedAt: Date
}

/**
 * Corporation wallet transaction data
 */
export interface CorporationWalletTransactionData {
	id: string
	corporationId: string
	division: number
	transactionId: string
	clientId: string
	date: Date
	isBuy: boolean
	isPersonal: boolean
	journalRefId: string
	locationId: string
	quantity: number
	typeId: string
	unitPrice: string
	updatedAt: Date
}

/**
 * Corporation asset data
 */
export interface CorporationAssetData {
	id: string
	corporationId: string
	itemId: string
	isSingleton: boolean
	locationFlag: string
	locationId: string
	locationType: string
	quantity: number
	typeId: string
	isBlueprintCopy: boolean | null
	updatedAt: Date
}

/**
 * Corporation structure inventory data
 */
export interface CorporationStructureInventoryData {
	id: string
	corporationId: string
	structureId: string
	itemId: string
	isSingleton: boolean
	locationFlag: string
	locationType: string
	quantity: number
	typeId: string
	updatedAt: Date
}

/**
 * Corporation structure data
 */
export interface CorporationStructureData {
	id: string
	corporationId: string
	structureId: string
	name: string | null
	typeId: string
	typeName: string | null
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	profileId: string
	fuelExpires: Date | null
	fuelAmount: number | null
	fuelBurnRate: string | null
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
}

/**
 * Targets for structure-enrichment sync status updates.
 */
export type StructureEnrichmentSyncTarget = 'sovereignty-hubs' | 'skyhooks'

/**
 * Filters supported by corporation structure snapshot reads.
 */
export interface CorporationStructureQuery {
	lowPower?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
}

/**
 * Corporation market order data
 */
export interface CorporationOrderData {
	id: string
	corporationId: string
	orderId: string
	duration: number
	escrow: string | null
	isBuyOrder: boolean
	issued: Date
	issuedBy: string
	locationId: string
	minVolume: number | null
	price: string
	range: string
	regionId: string
	typeId: string
	volumeRemain: number
	volumeTotal: number
	walletDivision: number
	updatedAt: Date
}

/**
 * Corporation contract data
 */
export interface CorporationContractData {
	id: string
	contractId: string
	acceptorId: string | null
	assigneeId: string
	availability: string
	buyout: string | null
	collateral: string | null
	dateAccepted: Date | null
	dateCompleted: Date | null
	dateExpired: Date
	dateIssued: Date
	daysToComplete: number | null
	endLocationId: string | null
	forCorporation: boolean
	issuerCorporationId: string
	issuerId: string
	price: string | null
	reward: string | null
	startLocationId: string | null
	status: string
	title: string | null
	type: string
	volume: string | null
	updatedAt: Date
}

/**
 * Supported sort keys for alliance courier contract listings.
 */
export type CorporationContractSortBy =
	| 'pickup'
	| 'dropoff'
	| 'volume'
	| 'reward'
	| 'collateral'
	| 'daysToComplete'
	| 'expires'

/**
 * Paged alliance courier contracts result.
 */
export interface CorporationContractsPageData {
	items: CorporationContractData[]
	pagination: {
		page: number
		limit: number
		totalItems: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
}

/**
 * Leaderboard entry for courier contracts
 */
export interface CourierLeaderboardEntry {
	acceptorId: string
	contractsCompleted: number
	totalVolume: number
	totalReward: number
}

/**
 * Leaderboard result with metadata
 */
export interface CourierLeaderboard {
	entries: CourierLeaderboardEntry[]
	oldestContractDate: Date | null
}

/**
 * Corporation industry job data
 */
export interface CorporationIndustryJobData {
	id: string
	corporationId: string
	jobId: string
	installerId: string
	facilityId: string
	locationId: string
	activityId: string
	blueprintId: string
	blueprintTypeId: string
	blueprintLocationId: string
	outputLocationId: string
	runs: number
	cost: string | null
	licensedRuns: number | null
	probability: string | null
	productTypeId: string | null
	status: string
	duration: number
	startDate: Date
	endDate: Date
	pauseDate: Date | null
	completedDate: Date | null
	completedCharacterId: string | null
	successfulRuns: number | null
	updatedAt: Date
}

/**
 * Corporation killmail data
 */
export interface CorporationKillmailData {
	id: string
	corporationId: string
	killmailId: string
	killmailHash: string
	killmailTime: Date
	updatedAt: Date
}

// ============================================================================
// AGGREGATE TYPES (combine multiple data types)
// ============================================================================

/**
 * Complete corporation financial data
 */
export interface CorporationFinancialData {
	wallets: CorporationWalletData[]
	journalEntries: CorporationWalletJournalData[]
	transactions: CorporationWalletTransactionData[]
}

/**
 * Complete corporation assets data
 */
export interface CorporationAssetsData {
	assets: CorporationAssetData[]
	structures: CorporationStructureData[]
	structureInventory: CorporationStructureInventoryData[]
}

/**
 * Complete corporation market data
 */
export interface CorporationMarketData {
	orders: CorporationOrderData[]
	contracts: CorporationContractData[]
	industryJobs: CorporationIndustryJobData[]
}

/**
 * Complete corporation core data
 */
export interface CorporationCoreData {
	publicInfo: CorporationPublicData | null
	members: CorporationMemberData[]
	memberTracking: CorporationMemberTrackingData[]
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Corporation access verification result
 */
export interface CorporationAccessVerification {
	hasAccess: boolean
	characterId: string | null
	characterName: string | null
	verifiedRoles: string[]
	missingRoles?: string[]
	lastVerified: Date | null
}

/**
 * Required role for specific operations
 */
export type CorporationRole =
	| 'Director'
	| 'Accountant'
	| 'Junior_Accountant'
	| 'Station_Manager'
	| 'Trader'
	| 'Factory_Manager'

/**
 * Director health status
 */
export interface DirectorHealth {
	directorId: string
	characterId: string
	characterName: string
	userId?: string | null
	isHealthy: boolean
	lastHealthCheck: Date | null
	lastUsed: Date | null
	failureCount: number
	lastFailureReason: string | null
	priority: number
}

export interface SearchAssetsFilters
	extends Partial<
		Pick<
			CorporationAssetData,
			| 'itemId'
			| 'isSingleton'
			| 'locationFlag'
			| 'locationId'
			| 'locationType'
			| 'quantity'
			| 'typeId'
			| 'isBlueprintCopy'
		>
	> {
	limit?: number
}

export interface WalletJournalWindowFilters {
	division?: number
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	fromDate?: Date
	toDate?: Date
	minAmount?: string
	maxAmount?: string
	limit?: number
	offset?: number
}

export interface WalletTransactionWindowFilters {
	division?: number
	clientId?: string
	journalRefId?: string
	fromDate?: Date
	toDate?: Date
	minUnitPrice?: string
	maxUnitPrice?: string
	limit?: number
	offset?: number
}

export interface CorporationTaxMetadata {
	corporationId: string
	inGameTaxRateBps: number | null
	ceoId: string | null
	memberCount: number | null
	allianceId: string | null
	updatedAt: Date | null
}

export interface CorporationSyncHealth {
	corporationId: string
	isConfigured: boolean
	lastVerified: Date | null
	sync: CorporationLastSyncData
}

export interface CorporationAuthStatus {
	corporationId: string
	isConfigured: boolean
	isVerified: boolean
	lastVerified: Date | null
	directorCount: number
	healthyDirectorCount: number
	requiredScopes: string[]
	missingRequiredScopes: string[]
	hasRequiredScopes: boolean
	hasCorporationWalletScope: boolean
	hasCharacterWalletScope: boolean
	hasCorporationMembershipScope: boolean
	grantedScopeCount: number
}

// ============================================================================
// PUBLIC RPC INTERFACE
// ============================================================================

/**
 * Public RPC interface for EveCorporationData Durable Object
 *
 * Each corporation has its own Durable Object instance identified by corporation ID.
 *
 * @example
 * ```ts
 * import type { EveCorporationData } from '@repo/eve-corporation-data'
 * import { getStub } from '@repo/do-utils'
 *
 * // Access corporation 98000001's data
 * const corporationId = '98000001'
 * const stub = getStub<EveCorporationData>(
 *   env.EVE_CORPORATION_DATA,
 *   corporationId
 * )
 *
 * // Configure which character to use for API access
 * await stub.setCharacter(corporationId, '2119123456', 'Character Name')
 *
 * // Verify access and fetch data
 * const verification = await stub.verifyAccess(corporationId)
 * if (verification.hasAccess) {
 *   await stub.fetchAllCorporationData(corporationId)
 * }
 * ```
 */
export interface StructureInventorySyncResult {
	assetsCount: number
	snapshotUpdated: boolean
	skipReason: 'cooldown' | 'no-owned-structures' | null
	ownedStructureCount: number | null
	fetchedAssetCount: number
	inventoryRowCount: number
}

export interface EveCorporationData {
	// ========================================================================
	// CONFIGURATION METHODS
	// ========================================================================

	/**
	 * Configure which character to use for API access for this corporation
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID with corporation permissions
	 * @param characterName - The character's name
	 */
	setCharacter(corporationId: string, characterId: string, characterName: string): Promise<void>

	/**
	 * Get the configured character for this corporation
	 * @returns Configuration data or null if not configured
	 */
	getConfiguration(): Promise<CorporationConfigData | null>

	/**
	 * Verify that the configured character has access to corporation data
	 * Fetches character roles from ESI and caches them
	 * @returns Verification result with roles and access status
	 */
	verifyAccess(corporationId: string): Promise<CorporationAccessVerification>

	/**
	 * Update corporation sync timestamp for a specific property
	 * Updates the corporationConfig table with the current timestamp for the specified sync property
	 * @param corporationId - The corporation ID
	 * @param syncProperty - The sync property to update (e.g., 'membersLastSync', 'assetsLastSync')
	 */
	updateCorporationSyncTimestamp(corporationId: string, syncProperty: string): Promise<void>

	/**
	 * Batch update corporation sync timestamps for multiple properties
	 * Updates the corporationConfig table with the current timestamp for all specified sync properties
	 * @param corporationId - The corporation ID
	 * @param syncProperties - Array of sync property names to update (e.g., ['membersLastSync', 'assetsLastSync'])
	 */
	batchUpdateCorporationSyncTimestamps(
		corporationId: string,
		syncProperties: string[]
	): Promise<void>

	// ========================================================================
	// DIRECTOR MANAGEMENT METHODS
	// ========================================================================

	/**
	 * Add a new director character for this corporation
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID with Director role
	 * @param characterName - The character's name
	 * @param priority - Priority for failover (higher = preferred), default 100
	 */
	addDirector(
		corporationId: string,
		characterId: string,
		characterName: string,
		priority?: number
	): Promise<void>

	/**
	 * Remove a director character from this corporation
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID to remove
	 */
	removeDirector(corporationId: string, characterId: string): Promise<void>

	/**
	 * Update a director's priority
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID
	 * @param priority - New priority value (higher = preferred)
	 */
	updateDirectorPriority(
		corporationId: string,
		characterId: string,
		priority: number
	): Promise<void>

	/**
	 * Get a load-balanced director for this corporation
	 * @param corporationId - The corporation ID
	 * @returns A load-balanced director or null if no healthy directors are available
	 */
	getLoadBalancedDirector(corporationId: string): Promise<string | null>

	/**
	 * Get all directors for this corporation
	 * @param corporationId - The corporation ID
	 * @returns Array of directors with health status
	 */
	getDirectors(corporationId: string): Promise<DirectorHealth[]>

	/**
	 * Get healthy directors for this corporation
	 * @param corporationId - The corporation ID
	 * @returns Array of healthy directors
	 */
	getHealthyDirectors(corporationId: string): Promise<DirectorHealth[]>

	/**
	 * Get the number of healthy directors for this corporation
	 * @param corporationId - The corporation ID
	 * @returns Number of healthy directors
	 */
	getHealthyDirectorCount(corporationId: string): Promise<number>

	/**
	 * Verify health of a specific director
	 * @param corporationId - The corporation ID
	 * @param directorId - The director's character ID
	 * @returns True if healthy, false otherwise
	 */
	verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean>

	/**
	 * Verify health of all directors
	 * @param corporationId - The corporation ID
	 * @param options - Verification behavior flags
	 * @returns Count of verified and failed directors
	 */
	verifyAllDirectorsHealth(
		corporationId: string,
		options?: { includePermanent?: boolean; bypassPermanentFailures?: boolean }
	): Promise<{ verified: number; failed: number }>

	// ========================================================================
	// STORAGE-ONLY METHODS (for workflow use)
	// ========================================================================

	/**
	 * Store public corporation info (workflow-friendly)
	 * Takes pre-fetched data and stores it in the database
	 * @param corporationId - The corporation ID
	 * @param publicInfo - Pre-fetched public info from ESI
	 */
	storePublicInfo(corporationId: string, publicInfo: any): Promise<void>

	/**
	 * Store corporation members (workflow-friendly)
	 * Handles member additions, updates, and departures
	 * @param corporationId - The corporation ID
	 * @param memberIds - Array of member character IDs
	 * @returns Object with departed and added member IDs for downstream processing
	 */
	storeMembers(
		corporationId: string,
		memberIds: string[]
	): Promise<{ departedMemberIds: string[]; addedMemberIds: string[] }>

	/**
	 * Reconcile one character's membership rows using authoritative affiliation.
	 *
	 * Removes stale memberships from any corporation that no longer matches
	 * the provided corporation ID, and opportunistically inserts membership for
	 * the provided corporation when that corporation is configured.
	 *
	 * @param characterId - Character ID to reconcile
	 * @param corporationId - Authoritative corporation ID, or null when unknown/deleted
	 */
	reconcileCharacterCorporationMembership(
		characterId: string,
		corporationId: string | null
	): Promise<{
		removedFromCorporationIds: string[]
		addedToCorporationId: string | null
	}>

	/**
	 * Store member tracking data (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param trackingData - Pre-fetched tracking data from ESI
	 */
	storeMemberTracking(
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
	): Promise<void>

	/**
	 * Store wallets data (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param wallets - Pre-fetched wallet data from ESI
	 */
	storeWallets(
		corporationId: string,
		wallets: Array<{ division: number; balance: string }>
	): Promise<void>

	/**
	 * Store wallet journal entries (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param division - Wallet division (1-7)
	 * @param entries - Pre-fetched journal entries from ESI
	 */
	storeWalletJournal(
		corporationId: string,
		division: number,
		entries: any[],
		watermark?: WalletJournalWatermark
	): Promise<WalletJournalStoreResult>

	/** Read compact journal watermarks for all wallet divisions. */
	getWalletJournalWatermarks(
		corporationId: string
	): Promise<Array<{ division: number; watermark: WalletJournalWatermark }>>

	/**
	 * Store wallet transactions (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param division - Wallet division (1-7)
	 * @param transactions - Pre-fetched transactions from ESI
	 */
	storeWalletTransactions(
		corporationId: string,
		division: number,
		transactions: any[],
		watermark?: WalletTransactionWatermark
	): Promise<WalletTransactionsStoreResult>

	/**
	 * Read the compact transaction watermarks for all wallet divisions.
	 * This is used to bound ESI from_id pagination without loading existing rows.
	 */
	getWalletTransactionWatermarks(
		corporationId: string
	): Promise<Array<{ division: number; watermark: WalletTransactionWatermark }>>

	/**
	 * Store assets (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param assets - Pre-fetched assets from ESI
	 */
	storeAssets(corporationId: string, assets: any[]): Promise<void>

	/**
	 * Store structure inventory rows derived from corp assets.
	 * @param corporationId - The corporation ID
	 * @param inventory - Pre-filtered structure inventory rows
	 */
	storeStructureInventory(
		corporationId: string,
		inventory: Array<{
			structureId: string
			itemId: string
			isSingleton: boolean
			locationFlag: string
			locationType: string
			quantity: number
			typeId: string
		}>
	): Promise<void>

	/**
	 * Rebuild the stored inventory snapshot for a single structure from already-ingested assets.
	 * This avoids a live ESI fetch and only refreshes the targeted structure rows.
	 */
	rebuildStructureInventorySnapshot(
		corporationId: string,
		structureId: string
	): Promise<{ inventoryCount: number }>

	/**
	 * Fetch and store corporation assets using a specific director character.
	 * Designed for workflow usage to avoid large asset payloads crossing RPC boundaries.
	 *
	 * @param corporationId - The corporation ID
	 * @param directorCharacterId - Character ID to authenticate ESI requests
	 * @returns Snapshot outcome and asset/inventory counts
	 */
	syncAssetsWithDirector(
		corporationId: string,
		directorCharacterId: string
	): Promise<StructureInventorySyncResult>

	/**
	 * Store structures (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param structures - Pre-fetched structures from ESI
	 */
	storeStructures(corporationId: string, structures: any[]): Promise<void>

	/**
	 * Store sovereignty system snapshots (workflow-friendly)
	 */
	storeSovereigntySystems(corporationId: string, systems: EsiSovereigntySystem[]): Promise<void>

	/**
	 * Store the shared sovereignty system snapshot used during workflow fan-out.
	 */
	storeSharedSovereigntySystems(systems: EsiSovereigntySystem[]): Promise<void>

	/**
	 * Acquire a short-lived refresh lease for the shared sovereignty snapshot.
	 * Returns a token when acquired, or null when another refresh is already in progress.
	 */
	acquireSharedSovereigntySystemsRefreshLease(leaseSeconds?: number): Promise<string | null>

	/**
	 * Release a previously acquired shared sovereignty refresh lease.
	 */
	releaseSharedSovereigntySystemsRefreshLease(leaseToken: string): Promise<void>

	/**
	 * Read the complete fresh shared sovereignty snapshot slice owned by a corporation.
	 */
	getSharedSovereigntySystemsForCorporation(
		corporationId: string,
		maxAgeSeconds?: number
	): Promise<EsiSovereigntySystem[] | null>

	/**
	 * Read the entire shared sovereignty system snapshot if it is still fresh.
	 */
	getSharedSovereigntySystemsSnapshot(
		maxAgeSeconds?: number
	): Promise<EsiSovereigntySystem[] | null>

	/**
	 * Check whether a completed shared sovereignty snapshot is still fresh.
	 * This reads only the snapshot metadata, not the cached system rows.
	 */
	hasFreshSharedSovereigntySystems(maxAgeSeconds?: number): Promise<boolean>

	/**
	 * Get a cached sovereignty system snapshot if it is still fresh enough.
	 *
	 * @param corporationId - The corporation ID
	 * @param maxAgeSeconds - Maximum acceptable age for the cached snapshot
	 * @returns Cached snapshot or null when missing/stale
	 */
	getSovereigntySystems(
		corporationId: string,
		maxAgeSeconds?: number
	): Promise<EsiSovereigntySystem[] | null>

	/**
	 * Store sovereignty hub snapshots (workflow-friendly)
	 */
	storeSovereigntyHubs(
		corporationId: string,
		hubs: EsiSovereigntyHub[],
		options?: {
			pruneCandidateIds?: readonly string[]
		}
	): Promise<void>

	/**
	 * Read the current sovereignty hub sync priority order for a corporation.
	 */
	getSovereigntyHubSyncPriorities(corporationId: string): Promise<SovereigntyHubSyncPriority[]>

	/**
	 * Return the sovereignty hub IDs that are missing from the live listing.
	 */
	getMissingStructureIdsForPriorityQueue(
		corporationId: string,
		target: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<string[]>

	/**
	 * Build the new, prune, and due-refresh sets from one complete live listing.
	 */
	getStructurePriorityQueue(
		corporationId: string,
		target: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<StructurePriorityQueue>

	/**
	 * Return persisted structure IDs that are absent from a complete live listing.
	 *
	 * This is intentionally separate from the sync-priority queue: a structure
	 * can be on cooldown and must not be treated as a prune candidate merely
	 * because another structure was selected for enrichment.
	 */
	getStructureIdsMissingFromLiveListing(
		corporationId: string,
		target: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<string[]>

	/**
	 * Read the current sovereignty hub structure IDs for a corporation.
	 */
	getSovereigntyHubStructureIds(corporationId: string): Promise<string[]>

	/**
	 * Read the current moon-drill sync priority order for a corporation.
	 */
	getMoonDrillSyncPriorities(corporationId: string): Promise<MoonDrillSyncPriority[]>

	/**
	 * Read the current moon-drill structure IDs for a corporation.
	 */
	getMoonDrillStructureIds(corporationId: string): Promise<string[]>

	/**
	 * Mark a structure-enrichment snapshot as failed without discarding the last good data.
	 */
	markStructureEnrichmentSyncFailure(
		corporationId: string,
		target: StructureEnrichmentSyncTarget,
		failureReason: string
	): Promise<void>

	/**
	 * Mark individual live structure enrichment failures without overwriting their last good data.
	 */
	markStructureEnrichmentFailures(
		corporationId: string,
		target: Extract<StructureEnrichmentSyncTarget, 'sovereignty-hubs' | 'skyhooks'>,
		failures: Array<{ structureId: string; failureReason: string }>
	): Promise<void>

	/**
	 * Mark a structure ingest snapshot as failed without discarding the last good data.
	 */
	markStructureSyncFailureReason(
		corporationId: string,
		target: StructureSyncFailureTarget,
		failureReason: string
	): Promise<void>

	/**
	 * Store skyhook snapshots (workflow-friendly)
	 */
	storeSkyhooks(
		corporationId: string,
		skyhooks: EsiCorporationSkyhook[],
		options?: {
			pruneCandidateIds?: readonly string[]
		}
	): Promise<SkyhookStoreResult>

	/**
	 * Read the current skyhook sync priority order for a corporation.
	 */
	getSkyhookSyncPriorities(corporationId: string): Promise<SkyhookSyncPriority[]>

	/**
	 * Read the current skyhook structure IDs for a corporation.
	 */
	getSkyhookStructureIds(corporationId: string): Promise<string[]>

	/**
	 * Read the current mining-citadel sync priority order for a corporation.
	 */
	getMiningCitadelSyncPriorities(corporationId: string): Promise<MiningCitadelSyncPriority[]>

	/**
	 * Read the current mining-citadel structure IDs for a corporation.
	 */
	getMiningCitadelStructureIds(corporationId: string): Promise<string[]>

	/**
	 * Store mining extraction snapshots (workflow-friendly)
	 */
	storeMiningExtractions(
		corporationId: string,
		extractions: EsiCorporationMiningExtraction[],
		options?: {
			pruneCandidateIds?: readonly string[]
			historyExtractions?: readonly EsiCorporationMiningExtraction[]
		}
	): Promise<void>

	/**
	 * Store market orders (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param orders - Pre-fetched orders from ESI
	 */
	storeOrders(corporationId: string, orders: any[]): Promise<void>

	/**
	 * Store contracts (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param contracts - Pre-fetched contracts from ESI
	 */
	storeContracts(corporationId: string, contracts: any[]): Promise<void>

	/**
	 * Store industry jobs (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param jobs - Pre-fetched industry jobs from ESI
	 */
	storeIndustryJobs(corporationId: string, jobs: any[]): Promise<void>

	/**
	 * Store killmails (workflow-friendly)
	 * @param corporationId - The corporation ID
	 * @param killmails - Pre-fetched killmails from ESI
	 */
	storeKillmails(corporationId: string, killmails: any[]): Promise<void>

	// ========================================================================
	// FETCH ORCHESTRATION METHODS (fetch and store data from ESI)
	// ========================================================================

	/**
	 * Fetch all accessible corporation data in parallel
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAllCorporationData(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch public corporation data (no authentication required)
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchPublicData(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch core corporation data (members, tracking)
	 * Requires: esi-corporations.read_corporation_membership.v1
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchCoreData(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 * Requires: esi-wallet.read_corporation_wallets.v1
	 * Requires role: Accountant or Junior_Accountant
	 * @param corporationId - The corporation ID
	 * @param division - Wallet division (1-7), or fetch all if not specified
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchFinancialData(
		corporationId: string,
		division?: number,
		forceRefresh?: boolean
	): Promise<void>

	/**
	 * Search assets
	 * @param corporationId - The corporation ID
	 * @param filters - Filters to apply to the search
	 * @returns Array of assets
	 */
	searchAssets(
		corporationId: string,
		filters?: SearchAssetsFilters
	): Promise<CorporationAssetData[]>

	/**
	 * Fetch and store corporation assets using a specific director character.
	 * Requires: esi-assets.read_corporation_assets.v1
	 * Requires role: Director
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAssets(corporationId: string, forceRefresh?: boolean): Promise<{ assetsCount: number }>

	/**
	 * Fetch assets and structures
	 * Requires: esi-assets.read_corporation_assets.v1, esi-corporations.read_structures.v1
	 * Requires role: Director (assets), Station_Manager (structures)
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAssetsData(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch corporation structures only.
	 * Requires: esi-corporations.read_structures.v1
	 * Requires role: Station_Manager
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchStructures(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch market and industry data (orders, contracts, jobs)
	 * Requires various scopes and roles
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchMarketData(corporationId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch killmails
	 * Requires: esi-killmails.read_corporation_killmails.v1
	 * Requires role: Director
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchKillmails(corporationId: string, forceRefresh?: boolean): Promise<void>

	// ========================================================================
	// GETTER METHODS (query database for stored data)
	// ========================================================================

	/**
	 * Get corporation public information
	 * @param corporationId Corporation ID to fetch info for
	 * @returns Public corporation data or null if not found
	 */
	getCorporationInfo(corporationId: string): Promise<CorporationPublicData | null>

	/**
	 * Get corporation members list
	 * @param corporationId - The corporation ID
	 * @returns Array of member data
	 */
	getMembers(corporationId: string): Promise<CorporationMemberData[]>

	/**
	 * Get corporation members list as a backend-paginated page
	 * Ordered by role (CEO, Director, Member) then character ID.
	 * @param corporationId - The corporation ID
	 * @param page - 1-indexed page number
	 * @param limit - Number of members per page
	 */
	getMembersPaginated(
		corporationId: string,
		page: number,
		limit: number
	): Promise<CorporationMembersPageData>

	/**
	 * Get corporation IDs for a list of character IDs
	 * Queries the corporation_members table to find which corporations each character belongs to
	 * @param characterIds - Array of character IDs to look up
	 * @returns Record mapping characterId to corporationId (only includes characters that exist in corporation_members)
	 */
	getCorporationIdsByCharacterIds(characterIds: string[]): Promise<Record<string, string>>

	/**
	 * Get corporation member tracking data
	 * @param corporationId - The corporation ID
	 * @returns Array of member tracking data
	 */
	getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]>

	/**
	 * Clean up stale member data by syncing with current ESI member list
	 * This removes members who are no longer in the corporation and triggers HR cleanup
	 * @param corporationId - The corporation ID
	 * @returns Cleanup result with count and character IDs of removed members
	 */
	cleanupStaleMemberData(corporationId: string): Promise<{
		membersRemoved: number
		characterIds: string[]
	}>

	/**
	 * Get corporation core data (public info + members)
	 * @param corporationId - The corporation ID
	 * @returns Core data or null if not found
	 */
	getCoreData(corporationId: string): Promise<CorporationCoreData | null>

	/**
	 * Get corporation wallets
	 * @param corporationId - The corporation ID
	 * @param division - Specific division (1-7) or all if not specified
	 * @returns Array of wallet data
	 */
	getWallets(corporationId: string, division?: number): Promise<CorporationWalletData[]>

	/**
	 * Get wallet journal entries
	 * @param corporationId - The corporation ID
	 * @param division - Specific division or all if not specified
	 * @param limit - Maximum number of entries to return
	 * @returns Array of journal entries
	 */
	getWalletJournal(
		corporationId: string,
		division?: number,
		limit?: number
	): Promise<CorporationWalletJournalData[]>

	/**
	 * Get wallet transactions
	 * @param corporationId - The corporation ID
	 * @param division - Specific division or all if not specified
	 * @param limit - Maximum number of transactions to return
	 * @returns Array of transaction data
	 */
	getWalletTransactions(
		corporationId: string,
		division?: number,
		limit?: number
	): Promise<CorporationWalletTransactionData[]>

	/**
	 * Get wallet journal entries constrained to a filter window.
	 */
	getWalletJournalWindow(
		corporationId: string,
		filters?: WalletJournalWindowFilters
	): Promise<CorporationWalletJournalData[]>

	/**
	 * Get wallet transactions constrained to a filter window.
	 */
	getWalletTransactionsWindow(
		corporationId: string,
		filters?: WalletTransactionWindowFilters
	): Promise<CorporationWalletTransactionData[]>

	/**
	 * Get available wallet divisions for a corporation.
	 */
	getWalletDivisions(corporationId: string): Promise<number[]>

	/**
	 * Get tax-relevant corporation metadata.
	 */
	getCorporationTaxMetadata(corporationId: string): Promise<CorporationTaxMetadata | null>

	/**
	 * Get synchronization health for corporation financial sources.
	 */
	getCorporationSyncHealth(corporationId: string): Promise<CorporationSyncHealth>

	/**
	 * Get configuration and director auth status for corporation API access.
	 */
	getCorporationAuthStatus(corporationId: string): Promise<CorporationAuthStatus>

	/**
	 * Get complete financial data
	 * @param corporationId - The corporation ID
	 * @param division - Specific division or all if not specified
	 * @returns Financial data or null if not found
	 */
	getFinancialData(
		corporationId: string,
		division?: number
	): Promise<CorporationFinancialData | null>

	/**
	 * Get corporation assets
	 * @param corporationId - The corporation ID
	 * @param limit - Maximum number of assets to return
	 * @returns Array of asset data
	 */
	getAssets(corporationId: string, limit?: number): Promise<CorporationAssetData[]>

	/**
	 * Get corp structure inventory rows derived from assets.
	 * @param corporationId - The corporation ID
	 * @param structureId - Optional structure ID to narrow the result set
	 * @param limit - Maximum number of rows to return
	 */
	getStructureInventory(
		corporationId: string,
		structureId?: string,
		limit?: number
	): Promise<CorporationStructureInventoryData[]>

	/**
	 * Get corporation structures
	 * @param corporationId - The corporation ID
	 * @param filters - Optional server-side filters for the returned snapshot
	 * @returns Array of structure data
	 */
	getStructures(
		corporationId: string,
		filters?: CorporationStructureQuery
	): Promise<CorporationStructureData[]>

	/**
	 * Get structure details from the synced corporation snapshot.
	 * @param corporationId - The corporation ID
	 * @param structureId - The structure ID
	 * @returns The stored structure snapshot, or null if not found
	 */
	getStructureDetails(
		corporationId: string,
		structureId: string
	): Promise<CorporationStructureData | null>

	/**
	 * Get complete assets data
	 * @param corporationId - The corporation ID
	 * @returns Assets data or null if not found
	 */
	getAssetsData(corporationId: string): Promise<CorporationAssetsData | null>

	/**
	 * Get corporation market orders
	 * @param corporationId - The corporation ID
	 * @returns Array of order data
	 */
	getOrders(corporationId: string): Promise<CorporationOrderData[]>

	/**
	 * Get corporation contracts
	 * @param corporationId - The corporation ID
	 * @param status - Filter by contract status
	 * @returns Array of contract data
	 */
	getContracts(corporationId: string, status?: string): Promise<CorporationContractData[]>

	/**
	 * Get a paged list of alliance courier contracts by assignee ID
	 * @param allianceId - The alliance ID (assignee_id on the contract)
	 * @param status - Filter by contract status
	 * @returns Paged courier contract data assigned to the alliance
	 */
	getAllianceCourierContracts(
		allianceId: string,
		status?: string,
		page?: number,
		limit?: number,
		sortBy?: CorporationContractSortBy,
		sortDirection?: 'asc' | 'desc'
	): Promise<CorporationContractsPageData>

	/**
	 * Get leaderboard for completed courier contracts assigned to an alliance
	 * @param allianceId - The alliance ID
	 * @param options - Optional date window filters
	 * @returns Leaderboard entries sorted by contracts completed descending
	 */
	getCourierLeaderboard(
		allianceId: string,
		options?: {
			since?: Date
			before?: Date
		}
	): Promise<CourierLeaderboard>

	/**
	 * Get corporation industry jobs
	 * @param corporationId - The corporation ID
	 * @param status - Filter by job status
	 * @returns Array of industry job data
	 */
	getIndustryJobs(corporationId: string, status?: string): Promise<CorporationIndustryJobData[]>

	/**
	 * Get complete market data
	 * @param corporationId - The corporation ID
	 * @returns Market data or null if not found
	 */
	getMarketData(corporationId: string): Promise<CorporationMarketData | null>

	/**
	 * Get corporation killmails
	 * @param corporationId - The corporation ID
	 * @param limit - Maximum number of killmails to return
	 * @returns Array of killmail data
	 */
	getKillmails(corporationId: string, limit?: number): Promise<CorporationKillmailData[]>

	/**
	 * Get character's corporation roles
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID
	 * @returns Roles data or null if not found
	 */
	getCharacterRoles(
		corporationId: string,
		characterId: string
	): Promise<CharacterCorporationRolesData | null>

	/**
	 * Get corporations that need to be refreshed
	 * @returns Array of corporation IDs that need refresh
	 */
	getCorporationsNeedingRefresh(): Promise<string[]>

	/**
	 * Get the lightweight corporation sync configuration for gating workflow steps
	 * @param corporationId - The corporation ID
	 */
	getCorporationSyncConfig(corporationId: string): Promise<CorporationSyncConfigData | null>

	/**
	 * Update corporation configuration settings
	 * @param corporationId - The corporation ID
	 * @param updates - Partial configuration updates
	 */
	updateCorporationConfig(
		corporationId: string,
		updates: { includeInBackgroundRefresh?: boolean; includeInStructureAssetSync?: boolean }
	): Promise<void>
}

/**
 * RPC service methods exposed by the Eve Corporation Data worker entrypoint.
 */
export interface EveCorporationDataWorker {
	/**
	 * Read healthy director counts for a page of corporations with bounded
	 * concurrency and per-corporation failure isolation.
	 */
	getHealthyDirectorCounts(corporationIds: string[]): Promise<Record<string, number | null>>
}
