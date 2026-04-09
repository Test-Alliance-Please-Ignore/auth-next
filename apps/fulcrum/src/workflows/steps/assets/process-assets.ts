/**
 * Process and enrich character assets
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { enrichAssets } from '../../processors/helpers/assets'
import { shipTypeIds } from '../../processors/helpers/ship-types'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { CharacterAsset } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

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
		EVE_STATIC_DATA: Fetcher
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string
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

		// Build lookup map for parent chain resolution (container items)
		const assetMap = new Map<string, CharacterAsset>()
		for (const asset of assets) {
			assetMap.set(asset.item_id, asset)
		}

		// Identify ship item IDs to exclude their contents from asset list
		const shipItemIds = new Set<string>()
		for (const asset of assets) {
			if (asset.is_singleton && shipTypeIds.has(asset.type_id)) {
				shipItemIds.add(asset.item_id)
			}
		}

		// Check if an asset is inside a ship (directly or nested via containers in cargo)
		const isInsideShip = (asset: CharacterAsset): boolean => {
			let currentId = asset.location_id
			const visited = new Set<string>()
			while (currentId && !visited.has(currentId)) {
				visited.add(currentId)
				if (shipItemIds.has(currentId)) return true
				const parent = assetMap.get(currentId)
				if (!parent || parent.location_type !== 'item') break
				currentId = parent.location_id
			}
			return false
		}

		// Walk parent chain to find the top-level location (station or player structure)
		const resolveTopLevelLocation = (
			asset: CharacterAsset,
		): {
			locationId: string
			locationType: 'station' | 'other'
			containerItemId?: string
		} | null => {
			// The immediate parent is the container (if the asset is location_type 'item')
			const immediateParent = assetMap.get(asset.location_id)
			const containerItemId =
				immediateParent && !shipItemIds.has(immediateParent.item_id)
					? immediateParent.item_id
					: undefined

			let currentId = asset.location_id
			const visited = new Set<string>()
			while (currentId && !visited.has(currentId)) {
				visited.add(currentId)
				const parent = assetMap.get(currentId)
				if (!parent) return null
				if (parent.location_type === 'station' || parent.location_type === 'other') {
					return {
						locationId: parent.location_id,
						locationType: parent.location_type,
						containerItemId,
					}
				}
				if (parent.location_type === 'item') {
					currentId = parent.location_id
					continue
				}
				break
			}
			return null
		}

		// Collect container item IDs for name resolution later
		const containerItemIds = new Set<string>()

		// Include: stations, player structures, and items in containers (not in ships)
		const filteredAssets: CharacterAsset[] = []
		// Track container metadata to apply after enrichment
		const containerInfoMap = new Map<string, { containerItemId: string }>()

		for (const asset of assets) {
			if (asset.location_type === 'station' || asset.location_type === 'other') {
				filteredAssets.push(asset)
			} else if (asset.location_type === 'item' && !isInsideShip(asset)) {
				const resolved = resolveTopLevelLocation(asset)
				if (resolved) {
					// Replace location with the resolved top-level station/structure
					const rewritten: CharacterAsset = {
						...asset,
						location_id: resolved.locationId,
						location_type: resolved.locationType,
					}
					filteredAssets.push(rewritten)
					if (resolved.containerItemId) {
						containerInfoMap.set(asset.item_id, {
							containerItemId: resolved.containerItemId,
						})
						containerItemIds.add(resolved.containerItemId)
					}
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
					const resolved = resolveTopLevelLocation(container)
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
					})
				}
			}
		}

		// Enrich data by resolving IDs to names
		console.log('[processAssets] Starting enrichment', {
			totalAssets: assets.length,
			filteredAssets: filteredAssets.length,
			filteredOut: assets.length - filteredAssets.length,
			shipItemIds: shipItemIds.size,
			containerItemIds: containerItemIds.size,
			sampleAsset: filteredAssets[0]
				? {
						typeId: filteredAssets[0].type_id,
						locationId: filteredAssets[0].location_id,
						locationType: filteredAssets[0].location_type,
					}
				: null,
		})

		const enrichedData = await enrichAssets(env, filteredAssets, characterId)

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
