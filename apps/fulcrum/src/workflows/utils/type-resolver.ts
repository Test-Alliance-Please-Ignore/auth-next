/**
 * Type resolution utilities for workflows
 * Provides helpers for resolving EVE entity IDs to human-readable names
 */

import type { EsiTypeResolver } from '@repo/esi'
import { getStub } from '@repo/do-utils'

/**
 * Resolve entity IDs to names using ESI Type Resolver
 * Handles errors gracefully and returns partial results if some IDs fail
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param ids - Array of entity IDs to resolve (characters, corporations, alliances, systems, etc.)
 * @returns Map of ID to name for resolved entities
 *
 * @example
 * ```ts
 * const names = await resolveTypeIds(env, ['98000001', '1354830081'])
 * // Returns: { '98000001': 'Jita IV - Moon 4', '1354830081': 'Goonswarm Federation' }
 * ```
 */
export async function resolveTypeIds(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	ids: string[],
): Promise<Record<string, string>> {
	if (ids.length === 0) {
		return {}
	}

	try {
		const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
		return await resolver.resolveIds(ids)
	} catch (error) {
		// Log error but return empty map to allow workflow to continue
		console.error('Failed to resolve type IDs:', {
			error: error instanceof Error ? error.message : String(error),
			ids,
		})
		return {}
	}
}

/**
 * Resolve a single entity ID to a name
 * Convenience wrapper around resolveTypeIds for single ID lookups
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param id - Entity ID to resolve
 * @returns Entity name or undefined if not found
 *
 * @example
 * ```ts
 * const corpName = await resolveTypeId(env, '98000001')
 * // Returns: 'Jita IV - Moon 4'
 * ```
 */
export async function resolveTypeId(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	id: string,
): Promise<string | undefined> {
	const names = await resolveTypeIds(env, [id])
	return names[id]
}

/**
 * Batch resolve multiple ID arrays efficiently
 * Deduplicates IDs across all arrays before making a single resolution call
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param idArrays - Multiple arrays of IDs to resolve
 * @returns Map of ID to name for all resolved entities
 *
 * @example
 * ```ts
 * const corpIds = ['98000001', '98000002']
 * const allianceIds = ['1354830081']
 * const names = await batchResolveTypeIds(env, corpIds, allianceIds)
 * // Returns all names in a single map
 * ```
 */
export async function batchResolveTypeIds(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	...idArrays: string[][]
): Promise<Record<string, string>> {
	// Flatten and deduplicate IDs
	const uniqueIds = Array.from(new Set(idArrays.flat()))

	if (uniqueIds.length === 0) {
		return {}
	}

	return await resolveTypeIds(env, uniqueIds)
}
