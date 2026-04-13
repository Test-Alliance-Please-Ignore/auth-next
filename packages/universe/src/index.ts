import { EveTypeId } from '@repo/eve-types'

import type { InvFlag } from './inv-flags'
import type { InvGroup } from './inv-groups'
import type { InvItem } from './inv-items'
import type { InvName } from './inv-names'
import type { InvType } from './inv-types'
import type { Killmail, KillmailDetail } from './killmails'
import type { EveMoonId, UniverseMoon, UniverseMoonWithResources } from './moons'
import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureResponse,
	EveCharacterId,
	EveStructureId,
} from './structure'

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
	 * Store killmail data, resolving all entity names
	 * @param killmailId - Killmail ID
	 * @param killmailHash - Killmail hash
	 * @param killmailData - Full killmail data from ESI
	 * @returns Stored killmail record
	 */
	storeKillmail(
		killmailId: string,
		killmailHash: string,
		killmailData: KillmailDetail
	): Promise<Killmail>

	/**
	 * Fetch killmail by ID and hash
	 * @param killmailId - Killmail ID
	 * @param killmailHash - Killmail hash
	 * @returns Killmail record or null if not found
	 */
	fetchKillmailByIdAndHash(killmailId: string, killmailHash: string): Promise<Killmail | null>

	/**
	 * Get killmails by character ID
	 * @param characterId - Character ID
	 * @param filters - Optional filters for time range and losses only
	 * @returns Array of killmail records
	 */
	getKillmailsByCharacter(
		characterId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]>

	/**
	 * Get killmails by corporation ID
	 * @param corporationId - Corporation ID
	 * @param filters - Optional filters for time range and losses only
	 * @returns Array of killmail records
	 */
	getKillmailsByCorporation(
		corporationId: string,
		filters?: { startTime?: Date; endTime?: Date; lossesOnly?: boolean }
	): Promise<Killmail[]>

	/**
	 * Get killmails by solar system ID
	 * @param solarSystemId - Solar system ID
	 * @param filters - Optional filters for time range
	 * @returns Array of killmail records
	 */
	getKillmailsBySystem(
		solarSystemId: string,
		filters?: { startTime?: Date; endTime?: Date }
	): Promise<Killmail[]>

	/**
	 * Get killmails by time range
	 * @param startTime - Start time
	 * @param endTime - End time
	 * @returns Array of killmail records
	 */
	getKillmailsByTimeRange(startTime: Date, endTime: Date): Promise<Killmail[]>
}
