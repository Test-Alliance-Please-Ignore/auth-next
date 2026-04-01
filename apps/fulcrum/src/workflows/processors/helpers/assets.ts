/**
 * Data enrichment functions for character assets
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/esi'

import { isRateLimitError, retryWithBackoff } from '../../utils/retry'

import type { CharacterAsset, Esi, EsiTypeResolver } from '@repo/esi'

/**
 * Enriched character asset with resolved names
 */
export interface ProcessedAsset extends CharacterAsset {
	typeName?: string
	locationName?: string
	marketGroupName?: string | null
	categoryName?: string
	customName?: string
	averagePrice?: number
	estimatedValue?: number
	processedAt: string
}

/**
 * Array of processed assets
 */
export type ProcessedAssets = ProcessedAsset[]

/**
 * Enrich character assets by resolving IDs to names
 * Uses ESI Type Resolver to batch resolve all IDs at once
 * Fetches structure info for location IDs classified as structures
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER and EVE_TOKEN_STORE bindings
 * @param assets - Character assets from ESI worker
 * @param characterId - Character ID for authenticated structure lookups
 * @returns Enriched assets with resolved names
 */
export async function enrichAssets(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		EVE_STATIC_DATA: Fetcher
	},
	assets: CharacterAsset[],
	characterId: string
): Promise<ProcessedAssets> {
	if (assets.length === 0) {
		return []
	}

	// Collect all IDs that need resolution
	const typeIds: string[] = []
	const stationLocationIds: string[] = []
	const systemLocationIds: string[] = []
	const itemLocationIds: string[] = []

	for (const asset of assets) {
		// Always resolve type_id
		typeIds.push(asset.type_id)

		// Skip location resolution for items in cargo (always in a ship)
		if (asset.location_flag === 'Cargo') {
			continue
		}

		// Resolve location_id based on location_type
		switch (asset.location_type) {
			case 'station':
				stationLocationIds.push(asset.location_id)
				break
			case 'solar_system':
				systemLocationIds.push(asset.location_id)
				break
			case 'item':
				itemLocationIds.push(asset.location_id)
				break
			case 'other':
				// 'other' locations don't typically have resolvable names
				break
		}
	}

	// Batch resolve all IDs at once (deduplicated by resolveTypeIds)
	// Only resolve location IDs for 'station' and 'solar_system' types
	// Skip 'item' type location IDs (container item IDs aren't resolvable via /universe/names/)
	const allLocationIds = [
		...stationLocationIds,
		...systemLocationIds,
		// itemLocationIds intentionally excluded - these are container item IDs, not resolvable
	]
	const uniqueTypeIds = Array.from(new Set(typeIds))
	const uniqueLocationIds = Array.from(new Set(allLocationIds))
	const resolvableLocationIds = uniqueLocationIds.filter((id) => !isStructureId(id))
	const allIdsToResolve = [...uniqueTypeIds, ...resolvableLocationIds]

	console.log('[enrichAssets] Starting enrichment', {
		totalAssets: assets.length,
		uniqueTypeIds: uniqueTypeIds.length,
		uniqueLocationIds: uniqueLocationIds.length,
		resolvableLocationIds: resolvableLocationIds.length,
		totalIdsToResolve: allIdsToResolve.length,
		sampleTypeIds: uniqueTypeIds.slice(0, 5),
		sampleLocationIds: uniqueLocationIds.slice(0, 5),
		skippedItemLocationIds: itemLocationIds.length,
	})

	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	const nameMap = await typeResolver.resolveIds(allIdsToResolve, characterId)

	// Fetch type metadata (market group and category) for all unique type IDs
	const typeMetadataMap: Record<
		string,
		{
			marketGroupName: string | null
			categoryName: string
		}
	> = {}
	if (uniqueTypeIds.length > 0) {
		try {
			// Batch fetch metadata in chunks of 1000 (API limit)
			const BATCH_SIZE = 1000
			for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
				const batch = uniqueTypeIds.slice(i, i + BATCH_SIZE)
				const response = await env.EVE_STATIC_DATA.fetch('http://internal/types/metadata', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ typeIds: batch }),
				})

				if (response.ok) {
					const batchMetadata = await response.json<
						Record<
							string,
							{
								marketGroupName: string | null
								categoryName: string
							}
						>
					>()
					Object.assign(typeMetadataMap, batchMetadata)
				} else {
					console.warn('[enrichAssets] Failed to fetch type metadata', {
						status: response.status,
						batchSize: batch.length,
					})
				}
			}
		} catch (error) {
			console.error('[enrichAssets] Error fetching type metadata:', {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Identify location IDs that are classified as structures
	const structureLocationIds = Array.from(
		new Set(
			[...stationLocationIds, ...systemLocationIds, ...itemLocationIds].filter((id) =>
				isStructureId(id)
			)
		)
	)

	console.log('[enrichAssets] Resolution complete', {
		nameMapSize: Object.keys(nameMap).length,
		structureLocationIds: structureLocationIds.length,
		sampleStructureIds: structureLocationIds.slice(0, 3),
	})

	// Fetch structure info for large location IDs
	// Process sequentially with delays and exponential backoff retry to avoid rate limits (420/429 errors)
	// Use 'global' instance to share structure cache across all characters
	const structureNameMap: Record<string, string> = {}
	if (structureLocationIds.length > 0) {
		const esiStub = getStub<Esi>(env.ESI, 'global')
		const DELAY_MS = 200 // Delay between requests to avoid rate limits

		// Process sequentially to avoid rate limits
		for (const structureId of structureLocationIds) {
			try {
				// Retry with exponential backoff on rate limit errors
				const structureInfo = await retryWithBackoff(
					async () => {
						const info = await esiStub.fetchStructureInfo(characterId, structureId)
						return info
					},
					{
						maxRetries: 5,
						initialDelayMs: 1000, // Start with 1 second
						maxDelayMs: 60000, // Cap at 60 seconds
						backoffMultiplier: 2, // Double delay each retry
						onRetry: (attempt, error, delayMs) => {
							console.warn('[enrichAssets] Retrying structure fetch after rate limit', {
								structureId,
								attempt,
								delayMs,
								error: error.message,
							})
						},
					}
				)

				if (structureInfo) {
					structureNameMap[structureId] = structureInfo.name
				}
			} catch (error) {
				// If it's a rate limit error and we've exhausted retries, skip this structure
				if (isRateLimitError(error)) {
					console.warn('[enrichAssets] Rate limit error after retries, skipping structure', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				} else {
					// Structure not found, no access, or other error - skip it
					console.warn('[enrichAssets] Failed to fetch structure info', {
						structureId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			// Add delay between requests to avoid rate limits
			if (structureLocationIds.indexOf(structureId) < structureLocationIds.length - 1) {
				await new Promise((resolve) => setTimeout(resolve, DELAY_MS))
			}
		}

		console.log('[enrichAssets] Structure resolution complete', {
			requested: structureLocationIds.length,
			resolved: Object.keys(structureNameMap).length,
		})
	}

	// Build enriched assets with resolved names
	const processedAt = new Date().toISOString()
	const enriched = assets.map((asset) => {
		// Resolve typeName for all type_ids (item types are resolvable)
		const typeName = nameMap[asset.type_id]

		// Resolve locationName:
		// - Skip items in cargo (always in a ship, location_id is ship item_id)
		// - For 'station' and 'solar_system': use /universe/names/
		// - For structure IDs: fetch structure info via ESI
		// - For 'item' and 'other': skip (not resolvable)
		let locationName: string | undefined

		// Skip location resolution for cargo items
		if (asset.location_flag !== 'Cargo') {
			if (asset.location_type === 'station' || asset.location_type === 'solar_system') {
				locationName = nameMap[asset.location_id]
			} else if (isStructureId(asset.location_id)) {
				// Structure IDs require authenticated lookup
				locationName = structureNameMap[asset.location_id]
			}
			// 'item' and 'other' types remain undefined
		}

		const typeMetadata = typeMetadataMap[asset.type_id]
		const result: ProcessedAsset = {
			...asset,
			typeName,
			locationName,
			marketGroupName: typeMetadata?.marketGroupName ?? null,
			categoryName: typeMetadata?.categoryName,
			processedAt,
		}
		return result
	})

	// Log sample enriched asset
	if (enriched.length > 0) {
		const sample = enriched[0]
		console.log('[enrichAssets] Sample enriched asset', {
			typeId: sample.type_id,
			typeName: sample.typeName,
			locationId: sample.location_id,
			locationName: sample.locationName,
			hasTypeName: !!sample.typeName,
			hasLocationName: !!sample.locationName,
		})
	}

	return enriched
}
