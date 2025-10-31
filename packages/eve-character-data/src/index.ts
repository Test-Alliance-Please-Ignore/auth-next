/**
 * @repo/eve-character-data
 *
 * Shared types and interfaces for the EveCharacterData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { EveAllianceId, EveCharacterId, EveCorporationId } from '@repo/eve-types'

/**
 * ESI Response Types
 */

/**
 * Character public information from ESI
 * GET /characters/{character_id}
 */
export interface EsiCharacterPublicInfo {
	alliance_id?: number
	birthday: string
	bloodline_id: number
	corporation_id: number
	description?: string
	faction_id?: number
	gender: 'male' | 'female'
	name: string
	race_id: number
	security_status?: number
	title?: string
}

/**
 * Character portrait URLs from ESI
 * GET /characters/{character_id}/portrait
 */
export interface EsiCharacterPortrait {
	px64x64?: string
	px128x128?: string
	px256x256?: string
	px512x512?: string
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
 * Character portrait data stored in database
 */
export interface CharacterPortraitData {
	characterId: EveCharacterId
	px64x64?: string
	px128x128?: string
	px256x256?: string
	px512x512?: string
	createdAt: Date
	updatedAt: Date
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
	/**
	 * Fetch and store all public character data (no auth required)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchCharacterData(characterId: string, forceRefresh?: boolean): Promise<void>

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
	 * Get character portrait data
	 * @param characterId - EVE character ID
	 * @returns Character portrait URLs or null if not found
	 */
	getPortrait(characterId: string): Promise<{
		characterId: EveCharacterId
		px64x64?: string
		px128x128?: string
		px256x256?: string
		px512x512?: string
	} | null>

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
	getSkills(characterId: string): Promise<{
		skills: Array<{
			active_skill_level: number
			skill_id: number
			skillpoints_in_skill: number
			trained_skill_level: number
		}>
		total_sp: number
		unallocated_sp?: number
	} | null>

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
	 * Get market transactions for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market transactions
	 */
	getMarketTransactions(characterId: string): Promise<CharacterMarketTransactionData[]>

	/**
	 * Get market orders for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market orders
	 */
	getMarketOrders(characterId: string): Promise<CharacterMarketOrderData[]>
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
