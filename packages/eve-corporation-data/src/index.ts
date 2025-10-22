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
	corporation_id: number
	name: string
	ticker: string
	ceo_id: number
	creator_id: number
	date_founded?: string // ISO 8601 date
	description?: string
	home_station_id?: number
	member_count: number
	shares?: number
	tax_rate: number
	url?: string
	alliance_id?: number
	faction_id?: number
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
export type EsiCorporationMembers = number[]

/**
 * ESI Corporation Member Tracking Response
 * GET /corporations/{corporation_id}/membertracking
 */
export interface EsiCorporationMemberTracking {
	character_id: number
	base_id?: number
	location_id?: number
	logoff_date?: string
	logon_date?: string
	ship_type_id?: number
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
	id: number
	amount?: number
	balance?: number
	context_id?: number
	context_id_type?: string
	date: string
	description: string
	first_party_id?: number
	reason?: string
	ref_type: string
	second_party_id?: number
	tax?: number
	tax_receiver_id?: number
}

/**
 * ESI Corporation Wallet Transaction
 * GET /corporations/{corporation_id}/wallets/{division}/transactions
 */
export interface EsiCorporationWalletTransaction {
	transaction_id: number
	client_id: number
	date: string
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: number
	location_id: number
	quantity: number
	type_id: number
	unit_price: number
}

/**
 * ESI Corporation Asset
 * GET /corporations/{corporation_id}/assets
 */
export interface EsiCorporationAsset {
	item_id: number
	is_singleton: boolean
	location_flag: string
	location_id: number
	location_type: string
	quantity: number
	type_id: number
	is_blueprint_copy?: boolean
}

/**
 * ESI Corporation Structure
 * GET /corporations/{corporation_id}/structures
 */
export interface EsiCorporationStructure {
	structure_id: number
	type_id: number
	system_id: number
	profile_id: number
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
	order_id: number
	duration: number
	escrow?: number
	is_buy_order: boolean
	issued: string
	issued_by: number
	location_id: number
	min_volume?: number
	price: number
	range: string
	region_id: number
	type_id: number
	volume_remain: number
	volume_total: number
	wallet_division: number
}

/**
 * ESI Corporation Contract
 * GET /corporations/{corporation_id}/contracts
 */
export interface EsiCorporationContract {
	contract_id: number
	acceptor_id?: number
	assignee_id: number
	availability: string
	buyout?: number
	collateral?: number
	date_accepted?: string
	date_completed?: string
	date_expired: string
	date_issued: string
	days_to_complete?: number
	end_location_id?: number
	for_corporation: boolean
	issuer_corporation_id: number
	issuer_id: number
	price?: number
	reward?: number
	start_location_id?: number
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
	job_id: number
	installer_id: number
	facility_id: number
	location_id: number
	activity_id: number
	blueprint_id: number
	blueprint_type_id: number
	blueprint_location_id: number
	output_location_id: number
	runs: number
	cost?: number
	licensed_runs?: number
	probability?: number
	product_type_id?: number
	status: string
	duration: number
	start_date: string
	end_date: string
	pause_date?: string
	completed_date?: string
	completed_character_id?: number
	successful_runs?: number
}

/**
 * ESI Corporation Killmail
 * GET /corporations/{corporation_id}/killmails/recent
 */
export interface EsiCorporationKillmail {
	killmail_id: number
	killmail_hash: string
}

// ============================================================================
// DATABASE TYPES (camelCase, match our schema)
// ============================================================================

/**
 * Corporation configuration data
 */
export interface CorporationConfigData {
	corporationId: number
	characterId: number
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
	corporationId: number
	characterId: number
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
	corporationId: number
	name: string
	ticker: string
	ceoId: number
	creatorId: number
	dateFounded: Date | null
	description: string | null
	homeStationId: number | null
	memberCount: number
	shares: bigint | null
	taxRate: string
	url: string | null
	allianceId: number | null
	factionId: number | null
	warEligible: boolean | null
	updatedAt: Date
}

/**
 * Corporation member data
 */
export interface CorporationMemberData {
	id: string
	corporationId: number
	characterId: number
	updatedAt: Date
}

/**
 * Corporation member tracking data
 */
export interface CorporationMemberTrackingData {
	id: string
	corporationId: number
	characterId: number
	baseId: number | null
	locationId: bigint | null
	logoffDate: Date | null
	logonDate: Date | null
	shipTypeId: number | null
	startDate: Date | null
	updatedAt: Date
}

/**
 * Corporation wallet data
 */
export interface CorporationWalletData {
	id: string
	corporationId: number
	division: number
	balance: string
	updatedAt: Date
}

/**
 * Corporation wallet journal entry data
 */
export interface CorporationWalletJournalData {
	id: string
	corporationId: number
	division: number
	journalId: bigint
	amount: string | null
	balance: string | null
	contextId: bigint | null
	contextIdType: string | null
	date: Date
	description: string
	firstPartyId: number | null
	reason: string | null
	refType: string
	secondPartyId: number | null
	tax: string | null
	taxReceiverId: number | null
	updatedAt: Date
}

/**
 * Corporation wallet transaction data
 */
export interface CorporationWalletTransactionData {
	id: string
	corporationId: number
	division: number
	transactionId: bigint
	clientId: number
	date: Date
	isBuy: boolean
	isPersonal: boolean
	journalRefId: bigint
	locationId: bigint
	quantity: number
	typeId: number
	unitPrice: string
	updatedAt: Date
}

/**
 * Corporation asset data
 */
export interface CorporationAssetData {
	id: string
	corporationId: number
	itemId: bigint
	isSingleton: boolean
	locationFlag: string
	locationId: bigint
	locationType: string
	quantity: number
	typeId: number
	isBlueprintCopy: boolean | null
	updatedAt: Date
}

/**
 * Corporation structure data
 */
export interface CorporationStructureData {
	id: string
	corporationId: number
	structureId: bigint
	typeId: number
	systemId: number
	profileId: number
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
	corporationId: number
	orderId: bigint
	duration: number
	escrow: string | null
	isBuyOrder: boolean
	issued: Date
	issuedBy: number
	locationId: bigint
	minVolume: number | null
	price: string
	range: string
	regionId: number
	typeId: number
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
	corporationId: number
	contractId: number
	acceptorId: number | null
	assigneeId: number
	availability: string
	buyout: string | null
	collateral: string | null
	dateAccepted: Date | null
	dateCompleted: Date | null
	dateExpired: Date
	dateIssued: Date
	daysToComplete: number | null
	endLocationId: bigint | null
	forCorporation: boolean
	issuerCorporationId: number
	issuerId: number
	price: string | null
	reward: string | null
	startLocationId: bigint | null
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
	corporationId: number
	jobId: number
	installerId: number
	facilityId: bigint
	locationId: bigint
	activityId: number
	blueprintId: bigint
	blueprintTypeId: number
	blueprintLocationId: bigint
	outputLocationId: bigint
	runs: number
	cost: string | null
	licensedRuns: number | null
	probability: string | null
	productTypeId: number | null
	status: string
	duration: number
	startDate: Date
	endDate: Date
	pauseDate: Date | null
	completedDate: Date | null
	completedCharacterId: number | null
	successfulRuns: number | null
	updatedAt: Date
}

/**
 * Corporation killmail data
 */
export interface CorporationKillmailData {
	id: string
	corporationId: number
	killmailId: number
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
	characterId: number | null
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
 * const stub = getStub<EveCorporationData>(
 *   env.EVE_CORPORATION_DATA,
 *   'corp-98000001'
 * )
 *
 * // Configure which character to use for API access
 * await stub.setCharacter(98000001, 2119123456, 'Character Name')
 *
 * // Verify access and fetch data
 * const verification = await stub.verifyAccess()
 * if (verification.hasAccess) {
 *   await stub.fetchAllCorporationData()
 * }
 * ```
 */
export interface EveCorporationData extends DurableObject {
	// ========================================================================
	// CONFIGURATION METHODS
	// ========================================================================

	/**
	 * Configure which character to use for API access for this corporation
	 * @param corporationId - The corporation ID
	 * @param characterId - The character ID with corporation permissions
	 * @param characterName - The character's name
	 */
	setCharacter(corporationId: number, characterId: number, characterName: string): Promise<void>

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
	// FETCH ORCHESTRATION METHODS (fetch and store data from ESI)
	// ========================================================================

	/**
	 * Fetch all accessible corporation data in parallel
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAllCorporationData(forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch public corporation data (no authentication required)
	 * @param corporationId - The corporation ID
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchPublicData(corporationId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch core corporation data (members, tracking)
	 * Requires: esi-corporations.read_corporation_membership.v1
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchCoreData(forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 * Requires: esi-wallet.read_corporation_wallets.v1
	 * Requires role: Accountant or Junior_Accountant
	 * @param division - Wallet division (1-7), or fetch all if not specified
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchFinancialData(division?: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch assets and structures
	 * Requires: esi-assets.read_corporation_assets.v1, esi-corporations.read_structures.v1
	 * Requires role: Director (assets), Station_Manager (structures)
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchAssetsData(forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch market and industry data (orders, contracts, jobs)
	 * Requires various scopes and roles
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchMarketData(forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch killmails
	 * Requires: esi-killmails.read_corporation_killmails.v1
	 * Requires role: Director
	 * @param forceRefresh - Skip cache and fetch fresh data
	 */
	fetchKillmails(forceRefresh?: boolean): Promise<void>

	// ========================================================================
	// GETTER METHODS (query database for stored data)
	// ========================================================================

	/**
	 * Get corporation public information
	 * @returns Public corporation data or null if not found
	 */
	getCorporationInfo(): Promise<CorporationPublicData | null>

	/**
	 * Get corporation members list
	 * @returns Array of member data
	 */
	getMembers(): Promise<CorporationMemberData[]>

	/**
	 * Get corporation member tracking data
	 * @returns Array of member tracking data
	 */
	getMemberTracking(): Promise<CorporationMemberTrackingData[]>

	/**
	 * Get corporation core data (public info + members)
	 * @returns Core data or null if not found
	 */
	getCoreData(): Promise<CorporationCoreData | null>

	/**
	 * Get corporation wallets
	 * @param division - Specific division (1-7) or all if not specified
	 * @returns Array of wallet data
	 */
	getWallets(division?: number): Promise<CorporationWalletData[]>

	/**
	 * Get wallet journal entries
	 * @param division - Specific division or all if not specified
	 * @param limit - Maximum number of entries to return
	 * @returns Array of journal entries
	 */
	getWalletJournal(division?: number, limit?: number): Promise<CorporationWalletJournalData[]>

	/**
	 * Get wallet transactions
	 * @param division - Specific division or all if not specified
	 * @param limit - Maximum number of transactions to return
	 * @returns Array of transaction data
	 */
	getWalletTransactions(division?: number, limit?: number): Promise<CorporationWalletTransactionData[]>

	/**
	 * Get complete financial data
	 * @param division - Specific division or all if not specified
	 * @returns Financial data or null if not found
	 */
	getFinancialData(division?: number): Promise<CorporationFinancialData | null>

	/**
	 * Get corporation assets
	 * @param limit - Maximum number of assets to return
	 * @returns Array of asset data
	 */
	getAssets(limit?: number): Promise<CorporationAssetData[]>

	/**
	 * Get corporation structures
	 * @returns Array of structure data
	 */
	getStructures(): Promise<CorporationStructureData[]>

	/**
	 * Get complete assets data
	 * @returns Assets data or null if not found
	 */
	getAssetsData(): Promise<CorporationAssetsData | null>

	/**
	 * Get corporation market orders
	 * @returns Array of order data
	 */
	getOrders(): Promise<CorporationOrderData[]>

	/**
	 * Get corporation contracts
	 * @param status - Filter by contract status
	 * @returns Array of contract data
	 */
	getContracts(status?: string): Promise<CorporationContractData[]>

	/**
	 * Get corporation industry jobs
	 * @param status - Filter by job status
	 * @returns Array of industry job data
	 */
	getIndustryJobs(status?: string): Promise<CorporationIndustryJobData[]>

	/**
	 * Get complete market data
	 * @returns Market data or null if not found
	 */
	getMarketData(): Promise<CorporationMarketData | null>

	/**
	 * Get corporation killmails
	 * @param limit - Maximum number of killmails to return
	 * @returns Array of killmail data
	 */
	getKillmails(limit?: number): Promise<CorporationKillmailData[]>

	/**
	 * Get character's corporation roles
	 * @param characterId - The character ID
	 * @returns Roles data or null if not found
	 */
	getCharacterRoles(characterId: number): Promise<CharacterCorporationRolesData | null>
}
