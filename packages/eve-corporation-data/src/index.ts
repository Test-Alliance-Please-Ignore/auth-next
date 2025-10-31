/**
 * @repo/eve-corporation-data
 *
 * Shared types and interfaces for the EveCorporationData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

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
	balance: number
}

/**
 * ESI Corporation Wallet Journal Entry
 * GET /corporations/{corporation_id}/wallets/{division}/journal
 */
export interface EsiCorporationWalletJournalEntry {
	id: string
	amount?: number
	balance?: number
	context_id?: string
	context_id_type?: string
	date: string
	description: string
	first_party_id?: string
	reason?: string
	ref_type: string
	second_party_id?: string
	tax?: number
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

/**
 * Corporation configuration data
 */
export interface CorporationConfigData {
	corporationId: string
	characterId: string
	characterName: string
	lastVerified: Date | null
	isVerified: boolean
	createdAt: Date
	updatedAt: Date
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
 * Corporation structure data
 */
export interface CorporationStructureData {
	id: string
	corporationId: string
	structureId: string
	typeId: string
	systemId: string
	profileId: string
	fuelExpires: Date | null
	nextReinforceApply: Date | null
	nextReinforceHour: number | null
	reinforceHour: number | null
	state: string
	stateTimerEnd: Date | null
	stateTimerStart: Date | null
	unanchorsAt: Date | null
	services: Array<{ name: string; state: string }> | null
	updatedAt: Date
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
	corporationId: string
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
	isHealthy: boolean
	lastHealthCheck: Date | null
	lastUsed: Date | null
	failureCount: number
	lastFailureReason: string | null
	priority: number
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
 * const verification = await stub.verifyAccess()
 * if (verification.hasAccess) {
 *   await stub.fetchAllCorporationData(corporationId)
 * }
 * ```
 */
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
	verifyAccess(): Promise<CorporationAccessVerification>

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
	 * Verify health of a specific director
	 * @param corporationId - The corporation ID
	 * @param directorId - The director's character ID
	 * @returns True if healthy, false otherwise
	 */
	verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean>

	/**
	 * Verify health of all directors
	 * @param corporationId - The corporation ID
	 * @returns Count of verified and failed directors
	 */
	verifyAllDirectorsHealth(corporationId: string): Promise<{ verified: number; failed: number }>

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
	 * Fetch assets and structures
	 * Requires: esi-assets.read_corporation_assets.v1, esi-corporations.read_structures.v1
	 * Requires role: Director (assets), Station_Manager (structures)
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAssetsData(corporationId: string, forceRefresh?: boolean): Promise<void>

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
	 * Get corporation member tracking data
	 * @param corporationId - The corporation ID
	 * @returns Array of member tracking data
	 */
	getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]>

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
	 * Get corporation structures
	 * @param corporationId - The corporation ID
	 * @returns Array of structure data
	 */
	getStructures(corporationId: string): Promise<CorporationStructureData[]>

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
	 * @param characterId - The character ID
	 * @returns Roles data or null if not found
	 */
	getCharacterRoles(characterId: string): Promise<CharacterCorporationRolesData | null>
}
