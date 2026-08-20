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

/** GET /universe/systems/{solar_system_id} */
export interface EsiUniverseSolarSystem {
	constellation_id: number
	name: string
	security_status: number
	solar_system_id: number
	star_id?: number
	stargates?: number[]
	stations?: number[]
}

/** GET /universe/constellations/{constellation_id} */
export interface EsiUniverseConstellation {
	constellation_id: number
	name: string
	region_id: number
}

/** GET /universe/stations/{station_id} */
export interface EsiUniverseStation {
	name: string
	owner?: number
	solar_system_id: number
	station_id: number
	type_id?: number
}

/** GET /universe/types/{type_id}; callers may use the dogma subset for SDE fallbacks. */
export interface EsiUniverseType {
	dogma_attributes?: Array<{ attribute_id?: number; value?: number }>
}

/** GET /characters/{character_id}/search */
export interface EsiCharacterSearchResponse {
	solar_system?: number[]
	station?: number[]
	structure?: number[]
}

/** Public and structure market order rows returned by ESI market endpoints. */
export interface EsiMarketOrder {
	duration: number
	is_buy_order: boolean
	issued: string
	location_id: number
	min_volume: number
	order_id: number
	price: number
	range: string
	system_id?: number
	type_id: number
	volume_remain: number
	volume_total: number
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
