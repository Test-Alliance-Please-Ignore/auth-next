/**
 * @repo/eve-character-data
 *
 * Shared types and interfaces for the EveCharacterData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'

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
 * Database Schema Types
 */

/**
 * Character public data stored in database
 */
export interface CharacterPublicData {
	characterId: number
	name: string
	corporationId: number
	corporationName?: string // Resolved corporation name
	allianceId?: number
	allianceName?: string // Resolved alliance name
	birthday: string
	raceId: number
	bloodlineId: number
	securityStatus?: number
	description?: string
	gender: 'male' | 'female'
	factionId?: number
	title?: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Character portrait data stored in database
 */
export interface CharacterPortraitData {
	characterId: number
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
	characterId: number
	recordId: number
	corporationId: number
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
	characterId: number
	totalSp: number
	unallocatedSp?: number
	skills: Array<{
		active_skill_level: number
		skill_id: number
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
	characterId: number
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
 */
export interface CharacterWalletJournalData {
	id: string
	characterId: number
	journalId: bigint
	date: Date
	refType: string
	amount: string
	balance: string
	description: string
	firstPartyId?: number
	secondPartyId?: number
	reason?: string
	tax?: string
	taxReceiverId?: number
	contextId?: bigint
	contextIdType?: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Market transaction stored in database
 */
export interface CharacterMarketTransactionData {
	id: string
	characterId: number
	transactionId: bigint
	date: Date
	typeId: number
	quantity: number
	unitPrice: string
	clientId: number
	locationId: bigint
	isBuy: boolean
	isPersonal: boolean
	journalRefId: bigint
	createdAt: Date
	updatedAt: Date
}

/**
 * Market order stored in database
 */
export interface CharacterMarketOrderData {
	id: string
	characterId: number
	orderId: bigint
	typeId: number
	locationId: bigint
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
	regionId: number
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
export interface EveCharacterData extends DurableObject {
	/**
	 * Fetch and store all public character data (no auth required)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchCharacterData(characterId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store authenticated character data (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchAuthenticatedData(characterId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store wallet journal entries (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchWalletJournal(characterId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store market transactions (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchMarketTransactions(characterId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Fetch and store market orders (requires token)
	 * @param characterId - EVE character ID
	 * @param forceRefresh - Force refresh even if cached
	 */
	fetchMarketOrders(characterId: number, forceRefresh?: boolean): Promise<void>

	/**
	 * Get character public info from database
	 * @param characterId - EVE character ID
	 * @returns Character public data or null if not found
	 */
	getCharacterInfo(characterId: number): Promise<CharacterPublicData | null>

	/**
	 * Get when character data was last updated
	 * @param characterId - EVE character ID
	 * @returns Last updated timestamp or null if not found
	 */
	getLastUpdated(characterId: number): Promise<Date | null>

	/**
	 * Get sensitive character data (location, wallet, assets, status, skill queue)
	 * @param characterId - EVE character ID
	 * @returns Sensitive character data or null if not found
	 */
	getSensitiveData(characterId: number): Promise<CharacterSensitiveData | null>

	/**
	 * Get wallet journal entries for a character
	 * @param characterId - EVE character ID
	 * @returns Array of wallet journal entries
	 */
	getWalletJournal(characterId: number): Promise<CharacterWalletJournalData[]>

	/**
	 * Get market transactions for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market transactions
	 */
	getMarketTransactions(characterId: number): Promise<CharacterMarketTransactionData[]>

	/**
	 * Get market orders for a character
	 * @param characterId - EVE character ID
	 * @returns Array of market orders
	 */
	getMarketOrders(characterId: number): Promise<CharacterMarketOrderData[]>
}

/**
 * Sensitive character data (owner only)
 */
export interface CharacterSensitiveData {
	location?: {
		solarSystemId: number
		solarSystemName?: string // Resolved system name
		stationId?: number
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
