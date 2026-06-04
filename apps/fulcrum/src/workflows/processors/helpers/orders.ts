/**
 * Data enrichment functions for character market orders
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/esi'

import { StructureResolutionCoordinator } from './structure-resolution'

import type { CharacterMarketOrder, Esi, EsiTypeResolver } from '@repo/esi'
import type { Universe } from '@repo/universe'

/**
 * Enriched market order with resolved names
 */
export interface ProcessedMarketOrder extends CharacterMarketOrder {
	typeName?: string
	locationName?: string
	marketGroupName?: string | null
	categoryName?: string
	expiresAt?: string
	processedAt: string
}

export type ProcessedMarketOrders = ProcessedMarketOrder[]

/**
 * Enrich market orders by resolving IDs to names.
 */
export async function enrichMarketOrders(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	orders: CharacterMarketOrder[],
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator,
): Promise<ProcessedMarketOrders> {
	if (orders.length === 0) {
		return []
	}

	const typeIds = new Set<string>()
	const locationIds = new Set<string>()

	for (const order of orders) {
		typeIds.add(order.type_id)
		locationIds.add(order.location_id)
	}

	const uniqueTypeIds = [...typeIds]
	const uniqueLocationIds = [...locationIds]
	const resolvableLocationIds = uniqueLocationIds.filter((id) => !isStructureId(id))
	const idsToResolve = [...uniqueTypeIds, ...resolvableLocationIds]

	console.log('[enrichMarketOrders] Starting enrichment', {
		totalOrders: orders.length,
		uniqueTypeIds: uniqueTypeIds.length,
		uniqueLocationIds: uniqueLocationIds.length,
		resolvableLocationIds: resolvableLocationIds.length,
		totalIdsToResolve: idsToResolve.length,
	})

	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	const nameMap = await typeResolver.resolveIds(idsToResolve, characterId)

	const typeMetadataMap: Record<
		string,
		{
			marketGroupName: string | null
			categoryName: string
		}
	> = {}

	if (uniqueTypeIds.length > 0) {
		try {
			const universeStub = getStub<Universe>(env.UNIVERSE, 'default')
			const BATCH_SIZE = 1000
			for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
				const batch = uniqueTypeIds.slice(i, i + BATCH_SIZE)
				const batchMetadata = await universeStub.resolveTypeMetadataByIds(batch)
				Object.assign(typeMetadataMap, batchMetadata)
			}
		} catch (error) {
			console.error('[enrichMarketOrders] Error fetching type metadata:', {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const structureLocationIds = uniqueLocationIds.filter((id) => isStructureId(id))
	const structureNameMap =
		structureLocationIds.length > 0
			? await (structureResolutionCoordinator ?? new StructureResolutionCoordinator()).resolveStructureNames(
					{ ESI: env.ESI },
					characterId,
					structureLocationIds,
					'enrichMarketOrders'
				)
			: {}

	if (structureLocationIds.length > 0) {
		console.log('[enrichMarketOrders] Structure resolution complete', {
			requested: structureLocationIds.length,
			resolved: Object.keys(structureNameMap).length,
			denied: structureResolutionCoordinator?.getDeniedCount() ?? 0,
		})
	}

	const processedAt = new Date().toISOString()
	return orders.map((order) => {
		const typeName = nameMap[order.type_id]
		const locationName = isStructureId(order.location_id)
			? structureNameMap[order.location_id]
			: nameMap[order.location_id]
		const typeMetadata = typeMetadataMap[order.type_id]
		const state = order.state ?? 'open'
		const expiresAt = new Date(
			new Date(order.issued).getTime() + order.duration * 24 * 60 * 60 * 1000,
		).toISOString()

		return {
			...order,
			state,
			typeName,
			locationName,
			marketGroupName: typeMetadata?.marketGroupName ?? null,
			categoryName: typeMetadata?.categoryName,
			expiresAt,
			processedAt,
		}
	})
}
