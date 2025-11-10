/**
 * @repo/universe
 *
 * Shared types and interfaces for the Universe Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// Export killmail schemas and types
export * from './killmails'

// Export structure schemas and types
export * from './structure'

import type {
	EsiGetStructureMarketDataResponse,
	EsiGetStructureResponse,
	EveCharacterId,
	EveStructureId,
} from './structure'

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
}
