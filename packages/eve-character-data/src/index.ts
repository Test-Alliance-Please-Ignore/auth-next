/**
 * @repo/eve-character-data
 *
 * Shared types and interfaces for the EveCharacterData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import { RpcTarget } from 'cloudflare:workers'

import type { EveAllianceId, EveCharacterId, EveCorporationId } from '@repo/eve-types'

// ============================================================================
// SYNC WORKFLOW TYPES
// ============================================================================

/**
 * Supported data types for character synchronization workflows.
 */
export type EveCharacterSyncDataType =
	| 'public-info'
	| 'authenticated'
	| 'killmails'
	| 'wallet-journal'
	| 'market-transactions'
	| 'market-orders'
	| 'assets'
	| 'contracts'
	| 'fittings'
	| 'mining-ledger'
	| 'open-market-orders'

/**
 * ESI Response Types
 */

/**
 * Character public information from ESI
 * GET /characters/{character_id}
 */
export interface EsiCharacterPublicInfo {
	alliance_id?: number | string
	birthday: string
	bloodline_id: number | string
	corporation_id: number | string
	description?: string
	faction_id?: number | string
	gender: 'male' | 'female'
	name: string
	race_id: number | string
	security_status?: number | string
	title?: string
}

/**
 * Single corporation history entry from ESI
 * GET /characters/{character_id}/corporationhistory
 */
export interface EsiCorporationHistoryEntry {
	corporation_id: number
	is_deleted?: boolean
	record_id: number
	start_date: string
}

/**
 * Character skills from ESI
 * GET /characters/{character_id}/skills
 */
export interface EsiCharacterSkills {
	skills: Array<{
		active_skill_level: number
		skill_id: number
		skillpoints_in_skill: number
		trained_skill_level: number
	}>
	total_sp: number
	unallocated_sp?: number
}

/**
 * Character attributes from ESI
 * GET /characters/{character_id}/attributes
 */
export interface EsiCharacterAttributes {
	accrued_remap_cooldown_date?: string
	bonus_remaps?: number
	charisma: number
	intelligence: number
	last_remap_date?: string
	memory: number
	perception: number
	willpower: number
}

/**
 * Character skill queue from ESI
 * GET /characters/{character_id}/skillqueue
 */
export interface EsiCharacterSkillQueue {
	finish_date?: string
	finished_level: number
	level_end_sp?: number
	level_start_sp?: number
	queue_position: number
	skill_id: number
	start_date?: string
	training_start_sp?: number
}

/**
 * Wallet journal entry from ESI
 * GET /characters/{character_id}/wallet/journal
 */
export interface EsiWalletJournalEntry {
	id: number
	date: string
	ref_type: string
	amount: number
	balance?: number
	description: string
	first_party_id?: number
	second_party_id?: number
	reason?: string
	tax?: number
	tax_receiver_id?: number
	context_id?: number
	context_id_type?: string
}

/**
 * Market transaction from ESI
 * GET /characters/{character_id}/wallet/transactions
 */
export interface EsiMarketTransaction {
	transaction_id: number
	date: string
	type_id: number
	quantity: number
	unit_price: number
	client_id: number
	location_id: number
	is_buy: boolean
	is_personal: boolean
	journal_ref_id: number
}

/**
 * Market order from ESI
 * GET /characters/{character_id}/orders
 */
export interface EsiMarketOrder {
	order_id: number
	type_id: number
	location_id: number
	is_buy_order?: boolean
	price: number
	volume_total: number
	volume_remain: number
	issued: string
	state: 'open' | 'closed' | 'expired' | 'cancelled'
	min_volume?: number
	range: string
	duration: number
	escrow?: number
	region_id: number
}

/**
 * Character corporation roles from ESI
 * GET /characters/{character_id}/roles
 */
export interface EsiCharacterRoles {
	roles?: string[]
	roles_at_hq?: string[]
	roles_at_base?: string[]
	roles_at_other?: string[]
}

/**
 * Database Schema Types
 */

/**
 * Character public data stored in database
 */
export interface CharacterPublicData {
	characterId: EveCharacterId
	name: string
	corporationId: EveCorporationId
	corporationName?: string // Resolved corporation name
	allianceId?: EveAllianceId
	allianceName?: string // Resolved alliance name
	birthday: string
	raceId: string
	bloodlineId: string
	securityStatus?: number
	description?: string
	gender: 'male' | 'female'
	factionId?: string
	title?: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Result from refreshing public character data.
 */
export interface CharacterPublicRefreshResult {
	success: boolean
	isDeleted?: boolean
	characterName?: string
	affiliationChanged?: boolean
	previousCorporationId?: EveCorporationId | null
	currentCorporationId?: EveCorporationId | null
	previousAllianceId?: EveAllianceId | null
	currentAllianceId?: EveAllianceId | null
}

/**
 * Character corporation history entry stored in database
 */
export interface CharacterCorporationHistoryData {
	id: string
	characterId: EveCharacterId
	recordId: string
	corporationId: EveCorporationId
	corporationName?: string // Resolved corporation name
	startDate: string
	isDeleted?: boolean
	createdAt: Date
	updatedAt: Date
}

/**
 * Character skills data stored in database
 */
export interface CharacterSkillsData {
	characterId: EveCharacterId
	totalSp: number
	unallocatedSp?: number
	skills: Array<{
		active_skill_level: number
		skill_id: string
		skillpoints_in_skill: number
		trained_skill_level: number
	}>
	createdAt: Date
	updatedAt: Date
}

/**
 * Character attributes data stored in database
 */
export interface CharacterAttributesData {
	characterId: EveCharacterId
	intelligence: number
	perception: number
	memory: number
	willpower: number
	charisma: number
	accruedRemapCooldownDate?: string
	bonusRemaps?: number
	lastRemapDate?: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Wallet journal entry stored in database
 * TODO figure out types of first and second party ids
 */
export interface CharacterWalletJournalData {
	id: string
	characterId: EveCharacterId
	journalId: string
	date: Date
	refType: string
	amount: string
	balance: string
	description: string
	firstPartyId?: string
	secondPartyId?: string
	reason?: string
	tax?: string
	taxReceiverId?: string
	contextId?: string
	contextIdType?: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Market transaction stored in database
 */
export interface CharacterMarketTransactionData {
	id: string
	characterId: EveCharacterId
	transactionId: string
	date: Date
	typeId: string
	quantity: number
	unitPrice: string
	clientId: string
	locationId: string
	isBuy: boolean
	isPersonal: boolean
	journalRefId: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Market order stored in database
 */
export interface CharacterMarketOrderData {
	id: string
	characterId: EveCharacterId
	orderId: string
	typeId: string
	locationId: string
	isBuyOrder: boolean
	price: string
	volumeTotal: number
	volumeRemain: number
	issued: Date
	state: 'open' | 'closed' | 'expired' | 'cancelled'
	minVolume: number
	range: string
	duration: number
	escrow?: string
	regionId: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Killmail stored in database
 */
export interface CharacterKillmailData {
	id: string
	characterId: EveCharacterId
	killmailId: string
	killmailHash: string
	killmailTime: Date
	// Detailed killmail fields for SRP
	isLoss?: boolean | null // True if character was the victim
	shipTypeId?: string | null // Ship type that was destroyed
	shipTypeName?: string | null // Resolved ship type name
	totalValue?: string | null // ISK value as text
	solarSystemId?: string | null // Solar system where kill occurred
	solarSystemName?: string | null // Resolved solar system name
	victimCharacterId?: string | null // Character ID of the victim
	killmailData?: unknown | null // Full killmail JSON data
	updatedAt: Date
}

export interface CharacterKillmailUpsertData {
	killmailId: string
	killmailHash: string
	killmailTime: Date
	isLoss?: boolean | null
	shipTypeId?: string | null
	shipTypeName?: string | null
	totalValue?: string | null
	solarSystemId?: string | null
	solarSystemName?: string | null
	victimCharacterId?: string | null
	killmailData?: unknown | null
}

/**
 * Detailed loss data for SRP system
 */
export interface CharacterLossItemData {
	flag: number
	item_type_id: string
	quantity_destroyed?: number
	quantity_dropped?: number
	items?: CharacterLossItemData[]
}

export interface CharacterLossData {
	killmailId: string
	killmailHash: string
	killmailTime: Date
	shipTypeId: string
	totalValue: string // ISK value as text
	solarSystemId: string
	victimCharacterId: string
	victimItems?: CharacterLossItemData[]
	// Optional fields from killmail data
	shipTypeName?: string // Resolved from static data
	solarSystemName?: string // Resolved from static data
	// Additional data for UI
	hasSRPRequest?: boolean // Whether an SRP request exists for this loss
	srpRequestStatus?: string // Status of the SRP request if it exists
}

/**
 * Character skill entry from RPC response
 */
export interface CharacterSkillEntry {
	active_skill_level: number
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
}

/**
 * Character skills response from RPC methods
 */
export interface CharacterSkillsResponse {
	skills: CharacterSkillEntry[]
	total_sp: number
	unallocated_sp?: number
}

export interface CharacterWalletJournalWindowFilters {
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

export interface CharacterMarketTransactionsWindowFilters {
	clientId?: string
	typeId?: string
	journalRefId?: string
	fromDate?: Date
	toDate?: Date
	minUnitPrice?: string
	maxUnitPrice?: string
	limit?: number
	offset?: number
}

export interface CharacterWalletSyncHealth {
	characterId: EveCharacterId
	walletJournalLastUpdated: Date | null
	marketTransactionsLastUpdated: Date | null
}

/**
 * Public RPC interface for EveCharacterData Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { EveCharacterData } from '@repo/eve-character-data'
 *
 * const id = env.EVE_CHARACTER_DATA.idFromString(characterId.toString())
 * const stub = env.EVE_CHARACTER_DATA.get(id)
 * await stub.fetchCharacterData(characterId)
 * ```
 */
export interface EveCharacterData {
	triggerManualCharacterSyncBatch(): Promise<{
		batchId: string
		totalWorkflowInstances: number
		totalCharacters: number
		ownedUserWorkflows: number
		unownedCharacterWorkflows: number
		created: number
		failed: number
		workflowInstanceIds: string[]
		startedAt: string
	}>
	getManualCharacterSyncBatchStatus(batchId: string): Promise<{
		batchId: string
		startedAt: string
		total: number
		statusCounts: {
			queued: number
			running: number
			waiting: number
			complete: number
			errored: number
			terminated: number
			unknown: number
		}
		failedInstances: Array<{
			id: string
			status: string
			error?: string
		}>
	}>

	/**
	 * Fetch and store all public character data (no auth required)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchCharacterData(characterId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch, store, and classify public character data (no auth required)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	refreshPublicCharacterData(
		characterId: string,
		forceRefresh?: boolean
	): Promise<CharacterPublicRefreshResult>

	/**
	 * Store pre-fetched public info without making an ESI call.
	 * @param characterId - EVE character ID
	 * @param data - ESI public info already fetched by the caller
	 */
	storePublicInfo(characterId: string, data: EsiCharacterPublicInfo): Promise<void>

	/**
	 * Fetch and store corporation history from ESI
	 * @param characterId - EVE character ID
	 */
	fetchCorporationHistory(characterId: string): Promise<void>

	/**
	 * Fetch and store authenticated character data (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchAuthenticatedData(characterId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store wallet journal entries (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchWalletJournal(characterId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store market transactions (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchMarketTransactions(characterId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store market orders (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchMarketOrders(characterId: string, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store character location on-demand (requires token)
	 * Called when the character detail page loads, not during daily sync
	 * @param characterId - EVE character ID
	 */
	fetchLocation(characterId: string): Promise<void>

	/**
	 * Fetch and store character online status on-demand (requires token)
	 * Called when the character detail page loads, not during daily sync
	 * @param characterId - EVE character ID
	 */
	fetchStatus(characterId: string): Promise<void>

	/**
	 * Fetch character corporation roles (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 * @returns Character roles or null if not available
	 */
	fetchCorporationRoles(
		characterId: string,
		forceRefresh?: boolean
	): Promise<EsiCharacterRoles | null>

	/**
	 * Get character public info from database
	 * @param characterId - EVE character ID
	 * @returns Character public data or null if not found
	 */
	getCharacterInfo(characterId: string): Promise<CharacterPublicData | null>

	/**
	 * Search for a character by name (case-insensitive)
	 * Tries local database first, falls back to ESI search if not found
	 * @param characterName - Character name to search for
	 * @param exact - If true, require exact match (default: true)
	 * @returns Character ID if found, null otherwise
	 */
	searchCharacterByName(characterName: string, exact?: boolean): Promise<string | null>

	/**
	 * Get character corporation history
	 * @param characterId - EVE character ID
	 * @returns Array of corporation history entries
	 */
	getCorporationHistory(characterId: string): Promise<
		Array<{
			recordId: string
			corporationId: EveCorporationId
			startDate: string
			isDeleted?: boolean
		}>
	>

	/**
	 * Get character skills
	 * @param characterId - EVE character ID
	 * @returns Character skills data or null if not found
	 */
	getSkills(characterId: string): Promise<CharacterSkillsResponse | null>

	/**
	 * Get character skills, fetching from ESI if not found or stale
	 * @param characterId - EVE character ID
	 * @param maxAge - Maximum age of cached data in milliseconds (default: 1 hour)
	 * @returns Character skills data or null if unable to fetch
	 */
	getOrFetchSkills(characterId: string, maxAge?: number): Promise<CharacterSkillsResponse | null>

	/**
	 * Get character attributes
	 * @param characterId - EVE character ID
	 * @returns Character attributes data or null if not found
	 */
	getAttributes(characterId: string): Promise<{
		intelligence: number
		perception: number
		memory: number
		willpower: number
		charisma: number
		accruedRemapCooldownDate?: string
		bonusRemaps?: number
		lastRemapDate?: string
	} | null>

	/**
	 * Get when character data was last updated
	 * @param characterId - EVE character ID
	 * @returns Last updated timestamp or null if not found
	 */
	getLastUpdated(characterId: string): Promise<Date | null>

	/**
	 * Get sensitive character data (location, wallet, assets, status, skill queue)
	 * @param characterId - EVE character ID
	 * @returns Sensitive character data or null if not found
	 */
	getSensitiveData(characterId: string): Promise<CharacterSensitiveData | null>

	/**
	 * Get wallet journal entries for a character
	 * @param characterId - EVE character ID
	 * @returns Array of wallet journal entries
	 */
	getWalletJournal(characterId: string): Promise<CharacterWalletJournalData[]>

	/**
	 * Get wallet journal entries constrained to a filter window.
	 */
	getWalletJournalWindow(
		characterId: string,
		filters?: CharacterWalletJournalWindowFilters
	): Promise<CharacterWalletJournalData[]>

	/**
	 * Get market transactions for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market transactions
	 */
	getMarketTransactions(characterId: string): Promise<CharacterMarketTransactionData[]>

	/**
	 * Get market transactions constrained to a filter window.
	 */
	getMarketTransactionsWindow(
		characterId: string,
		filters?: CharacterMarketTransactionsWindowFilters
	): Promise<CharacterMarketTransactionData[]>

	/**
	 * Get wallet-source synchronization health for a character.
	 */
	getCharacterWalletSyncHealth(characterId: string): Promise<CharacterWalletSyncHealth>

	/**
	 * Get market orders for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market orders
	 */
	getMarketOrders(characterId: string): Promise<CharacterMarketOrderData[]>

	upsertCharacterKillmails(
		characterId: string,
		killmails: CharacterKillmailUpsertData[]
	): Promise<void>

	getCharacterKillmail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<CharacterKillmailData | null>

	getMostRecentLoss(characterId: string): Promise<CharacterKillmailData | null>

	getRecentLosses(characterId: string, limit?: number, cutoff?: Date): Promise<CharacterLossData[]>

	/**
	 * Get instance of EveCharacterData Durable Object
	 * @param characterId - EVE character ID
	 * @returns Instance of EveCharacterData Durable Object
	 */
	getInstance(characterId: string): Promise<EveCharacterDataInstance>
}

/**
 * Implementation of EveCharacterDataInstance
 * Wraps an EveCharacterData instance and automatically provides characterId to all methods
 */
export class EveCharacterDataInstance extends RpcTarget {
	constructor(
		private characterDataObject: EveCharacterData,
		private characterId: EveCharacterId | string
	) {
		super()
	}

	async fetchCharacterData(forceRefresh?: boolean): Promise<void> {
		await this.characterDataObject.fetchCharacterData(this.characterId, forceRefresh)
	}

	async refreshPublicCharacterData(forceRefresh?: boolean): Promise<CharacterPublicRefreshResult> {
		return await this.characterDataObject.refreshPublicCharacterData(this.characterId, forceRefresh)
	}

	async storePublicInfo(data: EsiCharacterPublicInfo): Promise<void> {
		await this.characterDataObject.storePublicInfo(this.characterId, data)
	}

	async fetchCorporationHistory(): Promise<void> {
		await this.characterDataObject.fetchCorporationHistory(this.characterId)
	}

	async fetchAuthenticatedData(forceRefresh?: boolean): Promise<void> {
		await this.characterDataObject.fetchAuthenticatedData(this.characterId, forceRefresh)
	}

	async fetchWalletJournal(forceRefresh?: boolean): Promise<void> {
		await this.characterDataObject.fetchWalletJournal(this.characterId, forceRefresh)
	}

	async fetchMarketTransactions(forceRefresh?: boolean): Promise<void> {
		await this.characterDataObject.fetchMarketTransactions(this.characterId, forceRefresh)
	}

	async fetchMarketOrders(forceRefresh?: boolean): Promise<void> {
		await this.characterDataObject.fetchMarketOrders(this.characterId, forceRefresh)
	}

	async fetchLocation(): Promise<void> {
		await this.characterDataObject.fetchLocation(this.characterId)
	}

	async fetchStatus(): Promise<void> {
		await this.characterDataObject.fetchStatus(this.characterId)
	}

	async fetchCorporationRoles(forceRefresh?: boolean): Promise<EsiCharacterRoles | null> {
		return await this.characterDataObject.fetchCorporationRoles(this.characterId, forceRefresh)
	}

	async getCharacterInfo(): Promise<CharacterPublicData | null> {
		return await this.characterDataObject.getCharacterInfo(this.characterId)
	}

	async searchCharacterByName(characterName: string, exact?: boolean): Promise<string | null> {
		return await this.characterDataObject.searchCharacterByName(characterName, exact)
	}

	async getLastUpdated(): Promise<Date | null> {
		return await this.characterDataObject.getLastUpdated(this.characterId)
	}

	async getCorporationHistory(): Promise<
		Array<{
			recordId: string
			corporationId: EveCorporationId
			startDate: string
			isDeleted?: boolean
		}>
	> {
		return await this.characterDataObject.getCorporationHistory(this.characterId)
	}

	async getSkills(): Promise<CharacterSkillsResponse | null> {
		return await this.characterDataObject.getSkills(this.characterId)
	}

	async getOrFetchSkills(maxAge?: number): Promise<CharacterSkillsResponse | null> {
		return await this.characterDataObject.getOrFetchSkills(this.characterId, maxAge)
	}

	async getAttributes(): Promise<{
		intelligence: number
		perception: number
		memory: number
		willpower: number
		charisma: number
		accruedRemapCooldownDate?: string
		bonusRemaps?: number
		lastRemapDate?: string
	} | null> {
		return await this.characterDataObject.getAttributes(this.characterId)
	}

	async getSensitiveData(): Promise<CharacterSensitiveData | null> {
		return await this.characterDataObject.getSensitiveData(this.characterId)
	}

	async getWalletJournal(): Promise<CharacterWalletJournalData[]> {
		return await this.characterDataObject.getWalletJournal(this.characterId)
	}

	async getWalletJournalWindow(
		filters?: CharacterWalletJournalWindowFilters
	): Promise<CharacterWalletJournalData[]> {
		return await this.characterDataObject.getWalletJournalWindow(this.characterId, filters)
	}

	async getMarketTransactions(): Promise<CharacterMarketTransactionData[]> {
		return await this.characterDataObject.getMarketTransactions(this.characterId)
	}

	async getMarketTransactionsWindow(
		filters?: CharacterMarketTransactionsWindowFilters
	): Promise<CharacterMarketTransactionData[]> {
		return await this.characterDataObject.getMarketTransactionsWindow(this.characterId, filters)
	}

	async getCharacterWalletSyncHealth(): Promise<CharacterWalletSyncHealth> {
		return await this.characterDataObject.getCharacterWalletSyncHealth(this.characterId)
	}

	async getMarketOrders(): Promise<CharacterMarketOrderData[]> {
		return await this.characterDataObject.getMarketOrders(this.characterId)
	}

	async upsertCharacterKillmails(killmails: CharacterKillmailUpsertData[]): Promise<void> {
		await this.characterDataObject.upsertCharacterKillmails(this.characterId, killmails)
	}

	async getCharacterKillmail(
		killmailId: string,
		killmailHash: string
	): Promise<CharacterKillmailData | null> {
		return await this.characterDataObject.getCharacterKillmail(
			this.characterId,
			killmailId,
			killmailHash
		)
	}

	async getMostRecentLoss(): Promise<CharacterKillmailData | null> {
		return await this.characterDataObject.getMostRecentLoss(this.characterId)
	}

	async getRecentLosses(limit?: number, cutoff?: Date): Promise<CharacterLossData[]> {
		return await this.characterDataObject.getRecentLosses(this.characterId, limit, cutoff)
	}

	[Symbol.dispose](): void {
		// No cleanup needed - this is a thin wrapper around an RPC target
		// The RPC target lifecycle is managed by Cloudflare Workers
	}
}

/**
 * Sensitive character data (owner only)
 */
export interface CharacterSensitiveData {
	location?: {
		solarSystemId: string
		solarSystemName?: string // Resolved system name
		stationId?: string
		stationName?: string // Resolved station name
		structureId?: string
	}
	wallet?: {
		balance: string
	}
	assets?: {
		totalValue?: string
		assetCount?: number
		lastUpdated?: Date
	}
	status?: {
		online: boolean
		lastLogin?: Date
		lastLogout?: Date
		loginsCount?: number
	}
	skillQueue?: Array<{
		queue_position: number
		skill_id: number
		finished_level: number
		start_date?: string
		finish_date?: string
		training_start_sp?: number
		level_start_sp?: number
		level_end_sp?: number
	}>
	walletJournal?: CharacterWalletJournalData[]
	marketTransactions?: CharacterMarketTransactionData[]
	marketOrders?: CharacterMarketOrderData[]
}

export async function getCharacterDataStub(
	namespace: DurableObjectNamespace,
	characterId: EveCharacterId
): Promise<EveCharacterDataInstance> {
	const stub = namespace.getByName(characterId) as unknown as EveCharacterData
	return stub.getInstance(characterId)
}

export * from './killmails'
