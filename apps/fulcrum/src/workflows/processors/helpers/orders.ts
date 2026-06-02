/**
 * Data enrichment functions for character market orders
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/esi'

import { isRateLimitError, retryWithBackoff } from '../../utils/retry'

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
	processedAt: string
}

export type ProcessedMarketOrders = ProcessedMarketOrder[]

/**
 * Enrich market orders by resolving IDs to names.
 */
export async function enrichMarketOrders(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	},
	orders: CharacterMarketOrder[],
	characterId: string,
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
	const structureNameMap: Record<string, string> = {}

	if (structureLocationIds.length > 0) {
		const esiStub = getStub<Esi>(env.ESI, 'global')
		const DELAY_MS = 200

		for (const structureId of structureLocationIds) {
			try {
				const structureInfo = await retryWithBackoff(
					async () => esiStub.fetchStructureInfo(characterId, structureId),
					{
						maxRetries: 3,
						initialDelayMs: 1000,
						maxDelayMs: 30000,
						backoffMultiplier: 2,
						onRetry: (attempt, error, delayMs) => {
							console.warn('[enrichMarketOrders] Retrying structure fetch after rate limit', {
								structureId,
								attempt,
								delayMs,
								error: error.message,
							})
						},
					},
				)

				if (structureInfo) {
					structureNameMap[structureId] = structureInfo.name
				}
			} catch (error) {
				if (isRateLimitError(error)) {
					console.warn('[enrichMarketOrders] Rate limit error after retries, skipping structure', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				} else {
					console.warn('[enrichMarketOrders] Failed to fetch structure info', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			if (structureLocationIds.indexOf(structureId) < structureLocationIds.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
			}
		}
	}

	const processedAt = new Date().toISOString()
	return orders.map((order) => {
		const typeName = nameMap[order.type_id]
		const locationName = isStructureId(order.location_id)
			? structureNameMap[order.location_id]
			: nameMap[order.location_id]
		const typeMetadata = typeMetadataMap[order.type_id]
		const state = order.state ?? 'open'

		return {
			...order,
			state,
			typeName,
			locationName,
			marketGroupName: typeMetadata?.marketGroupName ?? null,
			categoryName: typeMetadata?.categoryName,
			processedAt,
		}
	})
}
