import type { InventoryParseResult } from '@repo/eve-types'
import type { UniverseFuelRuleResolution } from './fuel-rules'
import type {
	UniverseConstellation,
	UniverseMoonGeography,
	UniverseNpcStation,
	UniversePlanet,
	UniversePlanetGeography,
	UniversePosition,
	UniverseRegion,
	UniverseSolarSystem,
	UniverseSolarSystemGeography,
	UniverseStargate,
	UniverseStaticMoon,
} from './geography'
import type { InvFlag } from './inv-flags'
import type { InvGroup } from './inv-groups'
import type { InvType } from './inv-types'
import type { EveMoonId, UniverseMoon, UniverseMoonWithResources } from './moons'
import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureResponse,
	EveCharacterId,
	EveStructureId,
} from './structure'
import type { TypeMetadata, TypeSlotCapacities } from './type-metadata'

/**
 * @repo/universe
 *
 * Shared types and interfaces for the Universe Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// Export moon schemas and types
export * from './moons'

// Export killmail schemas and types
export * from './killmails'

// Export structure schemas and types
export * from './structure'

// Export inventory flag types
export * from './inv-flags'

// Export inventory group types
export * from './inv-groups'

// Export inventory type types
export * from './inv-types'

// Export inventory item types
export * from './inv-items'

// Export inventory name types
export * from './inv-names'

// Export inventory type metadata types
export * from './type-metadata'

// Export static-data-derived structure fuel rules
export * from './fuel-rules'

// Export geography types
export * from './geography'
export * from './nearest-moon'

// Canonical static IDs for moon extraction and profitability.
// Universe is the source of truth for static EVE identifiers.
export const FUEL_BLOCK_TYPE_ID = '4247'
export const MAGMATIC_GAS_TYPE_ID = '81143'
export const MOON_BASE_MINERAL_TYPE_IDS = ['35', '36'] as const
export const MOON_ORE_TYPE_IDS = [
	'45490',
	'45491',
	'45492',
	'45493',
	'45494',
	'45495',
	'45496',
	'45497',
	'45498',
	'45499',
	'45500',
	'45501',
	'45502',
	'45503',
	'45504',
	'45506',
	'45510',
	'45511',
	'45512',
	'45513',
] as const
export const MOON_GOO_TYPE_IDS = [
	'16633',
	'16634',
	'16635',
	'16636',
	'16637',
	'16638',
	'16639',
	'16640',
	'16641',
	'16642',
	'16643',
	'16644',
	'16646',
	'16647',
	'16648',
	'16649',
	'16650',
	'16651',
	'16652',
	'16653',
] as const

export interface TypeMaterial {
	materialTypeId: string
	quantity: number
}

/**
 * Public RPC interface for Universe Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Universe } from '@repo/universe'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Universe>(env.UNIVERSE, 'default')
 * const structureInfo = await stub.getStructureInfo('1234567890', '98765432')
 * ```
 */
export interface Universe {
	/**
	 * Search solar systems by partial name.
	 * @param query - Partial solar system name
	 * @param limit - Maximum number of results (default 20)
	 */
	searchSolarSystems(query: string, limit?: number): Promise<UniverseSolarSystem[]>

	/**
	 * Get structure information from ESI
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Structure info or null if not found/no access
	 */
	getStructureInfo(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureResponse | null>

	/**
	 * Get structure market data from ESI
	 * @param structureId - The structure ID
	 * @param authorizedCharacterId - Character ID with access to the structure
	 * @returns Market orders or null if not found/no access
	 */
	getStructureMarketData(
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	): Promise<EsiGetStructureMarketDataResponse | null>

	/**
	 * Get stored moon metadata by moon ID.
	 * @param moonId - The EVE moon ID
	 * @returns Moon metadata or null if not found
	 */
	getMoonById(moonId: EveMoonId): Promise<UniverseMoon | null>

	/**
	 * Get stored moon metadata and resource composition by moon ID.
	 * @param moonId - The EVE moon ID
	 * @returns Moon info with resources or null if not found
	 */
	getMoonWithResourcesById(moonId: EveMoonId): Promise<UniverseMoonWithResources | null>

	/**
	 * Resolve moon geography contexts by moon IDs.
	 * Returns flattened hydrated moon / planet / solar-system context for snapshot writers.
	 */
	resolveMoonGeographyByIds(
		moonIds: string[]
	): Promise<Record<string, UniverseMoonGeography | null>>

	/**
	 * Resolve the nearest moon geography for a structure position within a system.
	 */
	resolveNearestMoonGeographyBySystemPosition(
		solarSystemId: string,
		position: UniversePosition
	): Promise<UniverseMoonGeography | null>

	/**
	 * Resolve planet geography contexts by planet IDs.
	 * Returns flattened hydrated planet / solar-system context for snapshot writers.
	 */
	resolvePlanetGeographyByIds(
		planetIds: string[]
	): Promise<Record<string, UniversePlanetGeography | null>>

	/**
	 * Resolve multiple inventory flags by their IDs
	 * @param flagIds - Array of flag IDs to resolve
	 * @returns Record mapping flag IDs to their data (null if not found)
	 */
	resolveInvFlags(flagIds: string[]): Promise<Record<string, InvFlag | null>>

	/**
	 * Resolve multiple inventory groups by their IDs
	 * @param groupIds - Array of group IDs to resolve
	 * @returns Record mapping group IDs to their data (null if not found)
	 */
	resolveInvGroups(groupIds: string[]): Promise<Record<string, InvGroup | null>>

	/**
	 * Resolve multiple type details by their names
	 * @param typeNames - Array of type names to resolve
	 * @returns Record mapping type names to their full type data (null if not found)
	 */
	resolveTypeIdsByNames(typeNames: string[]): Promise<Record<string, InvType | null>>

	/**
	 * Search for types by name (partial match)
	 * @param query - Partial type name to search for
	 * @param limit - Maximum number of results (default 20)
	 * @returns Array of matching InvType records
	 */
	searchTypes(query: string, limit?: number): Promise<InvType[]>

	/**
	 * Resolve multiple type details by their IDs
	 * @param typeIds - Array of type IDs to resolve
	 * @returns Record mapping type IDs to their full type data (null if not found)
	 */
	resolveTypeNamesByIds(typeIds: string[]): Promise<Record<string, InvType | null>>

	/**
	 * Resolve type metadata (market group and category) by type IDs.
	 * @param typeIds - Array of type IDs to resolve
	 * @returns Record mapping type IDs to metadata
	 */
	resolveTypeMetadataByIds(typeIds: string[]): Promise<Record<string, TypeMetadata>>

	/**
	 * Resolve static fitting slot capacities from SDE dogma attributes by type ID.
	 */
	resolveTypeSlotCapacitiesByIds(typeIds: string[]): Promise<Record<string, TypeSlotCapacities>>

	/**
	 * Parse inventory text and return structured item metadata.
	 * @param inventoryText - Raw inventory text export
	 * @returns Parsed inventory result
	 */
	parseInventoryText(inventoryText: string): Promise<InventoryParseResult>

	/**
	 * Resolve regions by IDs.
	 * @param regionIds - Array of region IDs to resolve
	 */
	resolveRegionsByIds(regionIds: string[]): Promise<Record<string, UniverseRegion | null>>
	resolveConstellationsByIds(
		constellationIds: string[]
	): Promise<Record<string, UniverseConstellation | null>>

	/**
	 * Resolve regions by names.
	 * @param regionNames - Array of region names to resolve
	 */
	resolveRegionsByNames(regionNames: string[]): Promise<Record<string, UniverseRegion | null>>

	/**
	 * Resolve solar systems by IDs.
	 * @param solarSystemIds - Array of solar system IDs to resolve
	 */
	resolveSolarSystemsByIds(
		solarSystemIds: string[]
	): Promise<Record<string, UniverseSolarSystem | null>>
	/**
	 * Resolve solar systems and their related constellation/region names in one RPC response.
	 */
	resolveSolarSystemGeographyByIds(
		solarSystemIds: string[]
	): Promise<Record<string, UniverseSolarSystemGeography | null>>

	/**
	 * Resolve solar systems by names.
	 * @param solarSystemNames - Array of solar system names to resolve
	 */
	resolveSolarSystemsByNames(
		solarSystemNames: string[]
	): Promise<Record<string, UniverseSolarSystem | null>>

	/**
	 * Resolve planets by IDs.
	 * @param planetIds - Array of planet IDs to resolve
	 */
	resolvePlanetsByIds(planetIds: string[]): Promise<Record<string, UniversePlanet | null>>

	/**
	 * Resolve planets by names.
	 * @param planetNames - Array of planet names to resolve
	 */
	resolvePlanetsByNames(planetNames: string[]): Promise<Record<string, UniversePlanet | null>>

	/**
	 * Resolve static moons by IDs.
	 * @param moonIds - Array of moon IDs to resolve
	 */
	resolveStaticMoonsByIds(moonIds: string[]): Promise<Record<string, UniverseStaticMoon | null>>

	/**
	 * Resolve static moons by names.
	 * @param moonNames - Array of moon names to resolve
	 */
	resolveStaticMoonsByNames(moonNames: string[]): Promise<Record<string, UniverseStaticMoon | null>>

	/**
	 * Resolve stargates by IDs.
	 * @param stargateIds - Array of stargate IDs to resolve
	 */
	resolveStargatesByIds(stargateIds: string[]): Promise<Record<string, UniverseStargate | null>>

	/**
	 * Resolve stargates by names.
	 * @param stargateNames - Array of stargate names to resolve
	 */
	resolveStargatesByNames(stargateNames: string[]): Promise<Record<string, UniverseStargate | null>>

	/**
	 * Resolve NPC stations by IDs.
	 * @param stationIds - Array of NPC station IDs to resolve
	 */
	resolveNpcStationsByIds(stationIds: string[]): Promise<Record<string, UniverseNpcStation | null>>

	/**
	 * Resolve NPC stations by names.
	 * @param stationNames - Array of NPC station names to resolve
	 */
	resolveNpcStationsByNames(
		stationNames: string[]
	): Promise<Record<string, UniverseNpcStation | null>>

	/**
	 * Get all solar systems in a region (for region map rendering).
	 */
	getSystemsByRegionId(regionId: string): Promise<UniverseSolarSystem[]>

	/**
	 * Get all moons in a solar system.
	 */
	getMoonsBySystemId(systemId: string): Promise<UniverseStaticMoon[]>

	/**
	 * Batch variant of getMoonsBySystemId.
	 * @returns Record keyed by solarSystemId.
	 */
	getMoonsBySystemIds(systemIds: string[]): Promise<Record<string, UniverseStaticMoon[]>>

	/**
	 * Get all stargates for a set of solar systems (returns flat array for jump connection drawing).
	 */
	getStargatesBySystemIds(systemIds: string[]): Promise<UniverseStargate[]>

	/**
	 * Get system and moon counts per region (for region overview map).
	 */
	getRegionStats(
		regionIds: string[]
	): Promise<Record<string, { systemCount: number; moonCount: number }>>

	/**
	 * Map moon IDs to their region IDs (for aggregating scan coverage by region).
	 */
	getMoonRegionIds(moonIds: string[]): Promise<Record<string, string>>

	/**
	 * Get region info for a set of solar system IDs (for labelling border nodes on region maps).
	 */
	getRegionsBySystemIds(
		systemIds: string[]
	): Promise<Record<string, { regionId: string; regionName: string }>>

	/**
	 * Get unique cross-region stargate connections (for drawing inter-region lines on universe map).
	 */
	getRegionConnections(
		regionIds: string[]
	): Promise<Array<{ fromRegionId: string; toRegionId: string }>>

	/**
	 * Returns all published type IDs eligible for daily market price tracking.
	 *
	 * Includes:
	 * - Ships (category 6)
	 * - Modules / Ship Equipment (category 7)
	 * - Subsystems (category 32)
	 * - Rigs (category 66)
	 * - Implants (category 20) filtered to attribute enhancers and skill hardwirings only
	 *   (excludes boosters and cerebral accelerators via market group hierarchy traversal)
	 */
	getMarketPriceWhitelist(): Promise<string[]>

	/**
	 * Get reprocessing materials for one or more type IDs
	 * @param typeIds - Array of type IDs to look up
	 * @returns Record mapping each typeId to its list of output materials
	 */
	getTypeMaterials(typeIds: string[]): Promise<Record<string, TypeMaterial[]>>

	/**
	 * Resolve structure service-module fuel rules and structure-specific bonuses
	 * from the active imported SDE data.
	 */
	resolveStructureFuelRules(
		structureTypeIds: string[],
		serviceNames: string[],
		serviceModuleTypeIds?: string[]
	): Promise<UniverseFuelRuleResolution>
}
