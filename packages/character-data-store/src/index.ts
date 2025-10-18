/**
 * CharacterDataStore Durable Object Interface
 *
 * This package provides TypeScript interfaces for the CharacterDataStore Durable Object
 * which manages EVE character and corporation data with automatic updates.
 *
 * The actual implementation lives in apps/esi/src/character-data-store.ts
 */

// ========== Types ==========

/**
 * ESI Character information response
 * From: GET /characters/{character_id}/
 */
export interface ESICharacterInfo {
	alliance_id?: number
	ancestry_id?: number
	birthday: string
	bloodline_id: number
	corporation_id: number
	description?: string
	gender: 'male' | 'female'
	name: string
	race_id: number
	security_status?: number
	title?: string
}

/**
 * ESI Corporation information response
 * From: GET /corporations/{corporation_id}/
 */
export interface ESICorporationInfo {
	alliance_id?: number
	ceo_id: number
	creator_id: number
	date_founded?: string
	description?: string
	home_station_id?: number
	member_count: number
	name: string
	shares?: number
	tax_rate: number
	ticker: string
	url?: string
	war_eligible?: boolean
}

export interface CharacterData {
	character_id: number
	name: string
	corporation_id: number
	alliance_id: number | null
	security_status: number | null
	birthday: string
	gender: string
	race_id: number
	bloodline_id: number
	ancestry_id: number | null
	description: string | null
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface CorporationData {
	corporation_id: number
	name: string
	ticker: string
	member_count: number
	ceo_id: number
	creator_id: number
	date_founded: string | null
	tax_rate: number
	url: string | null
	description: string | null
	alliance_id: number | null
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface ChangeHistoryEntry {
	id: number
	character_id: number
	changed_at: number
	field_name: string
	old_value: string | null
	new_value: string | null
}

/**
 * ESI Character skills response
 * From: GET /characters/{character_id}/skills/
 */
export interface ESISkill {
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
	active_skill_level: number
}

export interface ESICharacterSkills {
	skills: ESISkill[]
	total_sp: number
	unallocated_sp?: number
}

/**
 * ESI Character skillqueue response
 * From: GET /characters/{character_id}/skillqueue/
 */
export interface ESISkillQueueItem {
	skill_id: number
	finished_level: number
	queue_position: number
	start_date?: string
	finish_date?: string
	training_start_sp?: number
	level_start_sp?: number
	level_end_sp?: number
}

export type ESICharacterSkillQueue = ESISkillQueueItem[]

/**
 * ESI Corporation history entry
 * From: GET /characters/{character_id}/corporationhistory/
 */
export interface ESICorporationHistoryEntry {
	corporation_id: number
	is_deleted?: boolean
	record_id: number
	start_date: string
}

export type ESICorporationHistory = ESICorporationHistoryEntry[]

export interface CharacterSkillsData {
	character_id: number
	total_sp: number
	unallocated_sp: number
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface SkillData {
	character_id: number
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
	active_skill_level: number
}

export interface SkillQueueData {
	character_id: number
	skill_id: number
	finished_level: number
	queue_position: number
	start_date: string | null
	finish_date: string | null
	training_start_sp: number | null
	level_start_sp: number | null
	level_end_sp: number | null
}

export interface CorporationHistoryData {
	character_id: number
	record_id: number
	corporation_id: number
	corporation_name: string | null
	corporation_ticker: string | null
	alliance_id: number | null
	alliance_name: string | null
	alliance_ticker: string | null
	start_date: string
	end_date: string | null
	is_deleted: boolean
}

// ========== Durable Object Interface ==========

/**
 * CharacterDataStore Durable Object Interface
 *
 * Manages EVE character and corporation data with automatic updates based on
 * ESI cache headers. Tracks changes to character affiliations over time.
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/esi/src/character-data-store.ts
 */
export interface CharacterDataStore {
	/**
	 * Insert or update character data
	 * @param characterId - EVE character ID
	 * @param data - Character information from ESI
	 * @param expiresAt - Timestamp when this data should be refreshed (from ESI cache headers)
	 * @returns Stored character data
	 */
	upsertCharacter(
		characterId: number,
		data: ESICharacterInfo,
		expiresAt: number | null
	): Promise<CharacterData>

	/**
	 * Insert or update corporation data
	 * @param corporationId - EVE corporation ID
	 * @param data - Corporation information from ESI
	 * @param expiresAt - Timestamp when this data should be refreshed (from ESI cache headers)
	 * @returns Stored corporation data
	 */
	upsertCorporation(
		corporationId: number,
		data: ESICorporationInfo,
		expiresAt: number | null
	): Promise<CorporationData>

	/**
	 * Get character data by ID
	 * @returns Character data or null if not found
	 */
	getCharacter(characterId: number): Promise<CharacterData | null>

	/**
	 * Get corporation data by ID
	 * @returns Corporation data or null if not found
	 */
	getCorporation(corporationId: number): Promise<CorporationData | null>

	/**
	 * Get change history for a character
	 * @returns Array of change history entries (corporation, alliance changes, etc.)
	 */
	getCharacterHistory(characterId: number): Promise<ChangeHistoryEntry[]>

	/**
	 * Insert or update character skills
	 * @param characterId - EVE character ID
	 * @param data - Character skills from ESI
	 * @param expiresAt - Timestamp when this data should be refreshed (from ESI cache headers)
	 * @returns Stored character skills data
	 */
	upsertCharacterSkills(
		characterId: number,
		data: ESICharacterSkills,
		expiresAt: number | null
	): Promise<CharacterSkillsData>

	/**
	 * Insert or update character skillqueue
	 * @param characterId - EVE character ID
	 * @param data - Character skillqueue from ESI
	 */
	upsertCharacterSkillQueue(characterId: number, data: ESICharacterSkillQueue): Promise<void>

	/**
	 * Get character skills aggregate data by ID
	 * @returns Character skills data or null if not found
	 */
	getCharacterSkills(characterId: number): Promise<CharacterSkillsData | null>

	/**
	 * Get individual skills for a character
	 * @returns Array of skills
	 */
	getSkills(characterId: number): Promise<SkillData[]>

	/**
	 * Get skillqueue for a character
	 * @returns Array of skillqueue items
	 */
	getSkillQueue(characterId: number): Promise<SkillQueueData[]>

	/**
	 * Insert or update character corporation history
	 * @param characterId - EVE character ID
	 * @param history - Corporation history from ESI
	 */
	upsertCorporationHistory(characterId: number, history: ESICorporationHistory): Promise<void>

	/**
	 * Get corporation history for a character
	 * @returns Array of corporation history entries with corp/alliance names
	 */
	getCorporationHistory(characterId: number): Promise<CorporationHistoryData[]>

	/**
	 * Fetch corporation history from ESI and store it
	 * @param characterId - EVE character ID
	 * @returns Array of corporation history entries
	 */
	fetchAndStoreCorporationHistory(characterId: number): Promise<CorporationHistoryData[]>
}
