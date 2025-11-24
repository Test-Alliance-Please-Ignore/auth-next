/**
 * Process and enrich character assets
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import { enrichAssets } from '../../processors/helpers/assets'
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

		// Filter to only include assets in stations
		const stationAssets = assets.filter((asset) => asset.location_type === 'station')

		// Enrich data by resolving IDs to names
		console.log('[processAssets] Starting enrichment', {
			totalAssets: assets.length,
			stationAssets: stationAssets.length,
			filteredOut: assets.length - stationAssets.length,
			sampleAsset: stationAssets[0]
				? {
						typeId: stationAssets[0].type_id,
						locationId: stationAssets[0].location_id,
						locationType: stationAssets[0].location_type,
					}
				: null,
		})

		const enrichedData = await enrichAssets(env, stationAssets, characterId)

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
