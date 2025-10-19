/**
 * @repo/eve-character-data
 *
 * Shared types and interfaces for the EveCharacterData Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

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
 * Database Schema Types
 */

/**
 * Character public data stored in database
 */
export interface CharacterPublicData {
	characterId: number
	name: string
	corporationId: number
	allianceId?: number
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
}
