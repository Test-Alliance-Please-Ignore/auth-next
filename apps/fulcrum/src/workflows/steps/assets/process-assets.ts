/**
 * Process and enrich character assets
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { enrichAssets } from '../../processors/helpers/assets'
import {
	buildAssetMap,
	isInsideShip,
	resolveTopLevelLocation,
	isShipAsset,
} from '../../processors/helpers/location'
import type { StructureResolutionCoordinator } from '../../processors/helpers/structure-resolution'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import { isStructureId } from '@repo/esi'

import type { CharacterAsset } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

type AssetRecord = CharacterAsset & {
	isShipAsset?: boolean
}

/**
 * Process character assets by enriching with resolved names
 * Retrieves ESI data from previous step and enriches with name resolution
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-assets step
 * @param workflowInstanceId - Workflow instance ID
 * @returns StepResult with enriched character assets data
 */
export async function processAssets(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator
): Promise<StepResult> {
	try {
		// Check if fetch was successful
		if (!fetchResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchResult as any).error,
			}
		}

		// Retrieve data from payload or R2 (already transformed by ESI worker)
		const data = await retrieveData(getBucket, fetchResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch step',
			}
		}

		// Validate data structure
		const assets = data as CharacterAsset[]
		if (!Array.isArray(assets)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character assets structure',
			}
		}

		const assetMap = buildAssetMap(assets)

		// Collect container item IDs for name resolution later
		const containerItemIds = new Set<string>()

		// Include: stations, player structures, and items in containers (not in ships)
		const filteredAssets: AssetRecord[] = []
		// Track container metadata to apply after enrichment
		const containerInfoMap = new Map<string, { containerItemId: string }>()

		for (const asset of assets) {
			if (
				(asset.location_type === 'station' || asset.location_type === 'other') &&
				!isShipAsset(asset)
			) {
				filteredAssets.push({
					...asset,
					isShipAsset: isShipAsset(asset),
				})
			} else if (
				asset.location_type === 'item' &&
				!isShipAsset(asset) &&
				!isInsideShip(asset, assetMap)
			) {
				const resolved = resolveTopLevelLocation(asset, assetMap)
				if (resolved) {
					// Replace location with the resolved top-level station/structure
					const rewritten: AssetRecord = {
						...asset,
						location_id: resolved.locationId,
						location_type: resolved.locationType,
						isShipAsset: isShipAsset(asset),
					}
					filteredAssets.push(rewritten)
					if (resolved.containerItemId) {
						containerInfoMap.set(asset.item_id, {
							containerItemId: resolved.containerItemId,
						})
						containerItemIds.add(resolved.containerItemId)
					}
				} else if (isStructureId(asset.location_id) && !isShipAsset(asset)) {
					// Structure-held items and containers can appear with location_type=item
					// and no terminal station/other parent in the raw tree. Preserve them so
					// the assets tab can group them under the structure once enrichment runs.
					filteredAssets.push({
						...asset,
						isShipAsset: isShipAsset(asset),
					})
				}
			}
		}

		// Also include the containers themselves as assets so their type names get resolved
		for (const containerId of containerItemIds) {
			const container = assetMap.get(containerId)
			if (container) {
				// Resolve the container's top-level location
				let containerLocationId = container.location_id
				let containerLocationType = container.location_type
				if (
					containerLocationType !== 'station' &&
					containerLocationType !== 'other'
				) {
					const resolved = resolveTopLevelLocation(container, assetMap)
					if (resolved) {
						containerLocationId = resolved.locationId
						containerLocationType = resolved.locationType
					}
				}
				// Only add if not already in filteredAssets
				if (!filteredAssets.some((a) => a.item_id === containerId)) {
					filteredAssets.push({
						...container,
						location_id: containerLocationId,
						location_type: containerLocationType,
						isShipAsset: isShipAsset(container),
					})
				}
			}
		}

		// Ensure parent ship/container assets are retained as rows so their contents
		// can render as collapsible sub-lists in the UI.
		const groupedAssetIds = new Set(filteredAssets.map((asset) => asset.item_id))
		for (const containerId of containerItemIds) {
			if (groupedAssetIds.has(containerId)) {
				continue
			}
			const container = assetMap.get(containerId)
			if (container) {
				filteredAssets.push({
					...container,
					isShipAsset: isShipAsset(container),
				})
			}
		}

		// Enrich data by resolving IDs to names
		console.log('[processAssets] Starting enrichment', {
			totalAssets: assets.length,
			filteredAssets: filteredAssets.length,
			filteredOut: assets.length - filteredAssets.length,
			containerItemIds: containerItemIds.size,
			sampleAsset: filteredAssets[0]
				? {
						typeId: filteredAssets[0].type_id,
						locationId: filteredAssets[0].location_id,
						locationType: filteredAssets[0].location_type,
					}
				: null,
		})

		const enrichedData = await enrichAssets(
			env,
			filteredAssets,
			characterId,
			structureResolutionCoordinator
		)

		// Apply container metadata to enriched assets
		for (const asset of enrichedData) {
			const containerInfo = containerInfoMap.get(asset.item_id)
			if (containerInfo) {
				asset.containerItemId = containerInfo.containerItemId
				// Find the container in enriched data to get its resolved type name
				const containerAsset = enrichedData.find(
					(a) => a.item_id === containerInfo.containerItemId,
				)
				if (containerAsset) {
					asset.containerName = containerAsset.customName || containerAsset.typeName
				}
			}
		}

		console.log('[processAssets] Enrichment complete', {
			enrichedCount: enrichedData.length,
			sampleEnriched: enrichedData[0]
				? {
						typeId: enrichedData[0].type_id,
						typeName: enrichedData[0].typeName,
						locationId: enrichedData[0].location_id,
						locationName: enrichedData[0].locationName,
						hasTypeName: !!enrichedData[0].typeName,
						hasLocationName: !!enrichedData[0].locationName,
					}
				: null,
		})

		// Store in R2
		const result = await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-assets',
			enrichedData
		)

		console.log('[processAssets] Storage result', {
			source: result.source,
			success: result.success,
		})

		return result
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
