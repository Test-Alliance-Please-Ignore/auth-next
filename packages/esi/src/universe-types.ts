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

// ============================================================================
// MARKET PRICE TYPES - ESI
// ============================================================================

/**
 * Market price entry from ESI
 * GET /v1/markets/prices/
 * Returns CCP's universe-wide average and adjusted prices for all tradeable types.
 * Cached for 1 hour by ESI.
 */
export interface EsiMarketPrice {
	type_id: number
	/** Universe-wide volume-weighted average price across all regions */
	average_price?: number
	/** CCP-adjusted price used for industry calculations */
	adjusted_price?: number
}

/**
 * Market price for a type (transformed)
 */
export interface MarketPrice {
	typeId: string
	/** Universe-wide average price in ISK, or null if not available */
	averagePrice: number | null
	/** CCP-adjusted price in ISK, or null if not available */
	adjustedPrice: number | null
}

// ============================================================================
// INSURANCE TYPES - ESI
// ============================================================================

/**
 * A single insurance tier level from ESI
 * GET /v1/insurance/prices/
 */
export interface EsiInsuranceLevel {
	/** Tier name: "Basic" | "Standard" | "Bronze" | "Silver" | "Gold" | "Platinum" */
	name: string
	/** ISK cost of the insurance premium */
	cost: number
	/** ISK payout if the ship is destroyed while insured at this tier */
	payout: number
}

/**
 * Insurance prices for a single ship type from ESI
 * GET /v1/insurance/prices/
 */
export interface EsiInsurancePrices {
	type_id: number
	levels: EsiInsuranceLevel[]
}

/**
 * Platinum insurance tier values for a ship type (transformed)
 * Null values indicate the ship type has no insurance (e.g. pods)
 */
export interface InsurancePlatinumValues {
	typeId: string
	/** ISK premium cost for Platinum tier, or null if uninsurable */
	platinumCost: number | null
	/** ISK payout for Platinum tier, or null if uninsurable */
	platinumPayout: number | null
}
