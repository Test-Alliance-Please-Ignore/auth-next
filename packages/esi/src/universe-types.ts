/**
 * Universe-related ESI Response Types
 *
 * Type definitions for universe-related ESI API responses.
 * These types match the EVE Online ESI API format (snake_case).
 */

// ============================================================================
// UNIVERSE TYPES - ESI
// ============================================================================

/**
 * Structure information from ESI
 * GET /universe/structures/{structure_id}
 */
export interface EsiStructureInfo {
	name: string
	owner_id: number
	position: {
		x: number
		y: number
		z: number
	}
	solar_system_id: number
	type_id: number
}

// ============================================================================
// UNIVERSE TYPES - TRANSFORMED
// ============================================================================

/**
 * Structure information (transformed)
 * IDs converted to strings for consistency
 */
export interface StructureInfo {
	name: string
	owner_id: string
	position: {
		x: number
		y: number
		z: number
	}
	solar_system_id: string
	type_id: string
}

