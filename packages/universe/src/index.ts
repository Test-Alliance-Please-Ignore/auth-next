import { EveTypeId } from '@repo/eve-types'

import type { InvFlag } from './inv-flags'
import type { InvGroup } from './inv-groups'
import type { InvItem } from './inv-items'
import type { InvName } from './inv-names'
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
	 * Resolve multiple inventory items by their IDs
	 * @param itemIds - Array of item IDs to resolve
	 * @returns Record mapping item IDs to their data (null if not found)
	 */
	resolveInvItems(itemIds: string[]): Promise<Record<string, InvItem | null>>

	/**
	 * Resolve multiple inventory item names by their IDs
	 * @param itemIds - Array of item IDs to resolve
	 * @returns Record mapping item IDs to their names (null if not found)
	 */
	resolveInvNames(itemIds: string[]): Promise<Record<string, InvName | null>>
}
