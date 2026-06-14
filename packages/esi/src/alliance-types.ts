/**
 * Alliance-related ESI Response Types
 *
 * Type definitions for public alliance data returned by ESI.
 * These types match the EVE Online ESI API format (snake_case).
 */

/**
 * ESI Alliance Public Info
 * GET /alliances/{alliance_id}
 */
export interface EsiAlliancePublicInfo {
	creator_corporation_id: number
	creator_id: number
	date_founded: string
	executor_corporation_id?: number
	faction_id?: number
	name: string
	ticker: string
}

export interface AlliancePublicInfo {
	creator_corporation_id: string
	creator_id: string
	date_founded: string
	executor_corporation_id?: string
	faction_id?: string
	name: string
	ticker: string
}
