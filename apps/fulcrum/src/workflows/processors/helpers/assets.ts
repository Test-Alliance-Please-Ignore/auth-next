/**
 * Data enrichment functions for character assets
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { buildAssetMap, isInsideShip, isShipAsset, resolveTopLevelLocation } from './location'
import { StructureResolutionCoordinator } from './structure-resolution'

import type { CharacterAsset, EsiTypeResolver } from '@repo/esi'
import type { Universe } from '@repo/universe'

function isContainerType(typeName?: string, categoryName?: string): boolean {
	return Boolean(
		typeName?.toLowerCase().includes('container') ||
			categoryName?.toLowerCase().includes('container')
	)
}

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
	isShipAsset?: boolean
	isContainerAsset?: boolean
	/** item_id of the container this asset is inside (if any) */
	containerItemId?: string
	/** Resolved name of the container (type name or custom name) */
	containerName?: string
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
 * @param env - Worker environment with ESI_TYPE_RESOLVER, ESI, and UNIVERSE bindings
 * @param assets - Character assets from ESI worker
 * @param characterId - Character ID for authenticated structure lookups
 * @returns Enriched assets with resolved names
 */
export async function enrichAssets(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	},
	assets: CharacterAsset[],
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator
): Promise<ProcessedAssets> {
	if (assets.length === 0) {
		return []
	}

	const assetMap = buildAssetMap(assets)

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
				// Player-owned structures - collect for authenticated structure name resolution
				stationLocationIds.push(asset.location_id)
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

	logger.log('[enrichAssets] Starting enrichment', {
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
			const universeStub = getStub<Universe>(env.UNIVERSE, 'default')

			// Batch fetch metadata in chunks of 1000 (API limit)
			const BATCH_SIZE = 1000
			for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
				const batch = uniqueTypeIds.slice(i, i + BATCH_SIZE)
				const batchMetadata = await universeStub.resolveTypeMetadataByIds(batch)
				Object.assign(typeMetadataMap, batchMetadata)
			}
		} catch (error) {
			logger.error('[enrichAssets] Error fetching type metadata:', {
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

	logger.log('[enrichAssets] Resolution complete', {
		nameMapSize: Object.keys(nameMap).length,
		structureLocationIds: structureLocationIds.length,
		sampleStructureIds: structureLocationIds.slice(0, 3),
	})

	const structureNameMap =
		structureLocationIds.length > 0
			? await (
					structureResolutionCoordinator ?? new StructureResolutionCoordinator()
				).resolveStructureNames({ ESI: env.ESI }, characterId, structureLocationIds, 'enrichAssets')
			: {}

	if (structureLocationIds.length > 0) {
		logger.log('[enrichAssets] Structure resolution complete', {
			requested: structureLocationIds.length,
			resolved: Object.keys(structureNameMap).length,
			denied: structureResolutionCoordinator?.getDeniedCount() ?? 0,
		})
	}

	// Build enriched assets with resolved names
	const processedAt = new Date().toISOString()
	const enriched = assets.map((asset) => {
		// Resolve typeName for all type_ids (item types are resolvable)
		const typeName = nameMap[asset.type_id]
		const resolvedLocation = resolveTopLevelLocation(asset, assetMap)

		// Resolve locationName:
		// - For 'station' and 'solar_system': use /universe/names/
		// - For structures / structure-held items: fetch structure info via ESI
		// - For ship cargo: skip (it resolves to the ship item, not a location)
		let locationName: string | undefined

		if (asset.location_type === 'station' || asset.location_type === 'solar_system') {
			locationName = nameMap[asset.location_id]
		} else if (asset.location_type === 'other' || isStructureId(asset.location_id)) {
			// Player-owned structures require authenticated lookup
			locationName = structureNameMap[asset.location_id] ?? nameMap[asset.location_id]
		} else if (!(asset.location_flag === 'Cargo' && isInsideShip(asset, assetMap))) {
			if (resolvedLocation) {
				if (resolvedLocation.locationType === 'station') {
					locationName = nameMap[resolvedLocation.locationId]
				} else {
					locationName =
						structureNameMap[resolvedLocation.locationId] ?? nameMap[resolvedLocation.locationId]
				}
			}
		}

		const typeMetadata = typeMetadataMap[asset.type_id]
		const shipAsset = isShipAsset(asset)
		const result: ProcessedAsset = {
			...asset,
			typeName,
			locationName,
			marketGroupName: typeMetadata?.marketGroupName ?? null,
			categoryName: typeMetadata?.categoryName,
			isContainerAsset:
				asset.is_singleton && !shipAsset && isContainerType(typeName, typeMetadata?.categoryName),
			processedAt,
		}
		return result
	})

	// Log sample enriched asset
	if (enriched.length > 0) {
		const sample = enriched[0]
		logger.log('[enrichAssets] Sample enriched asset', {
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
