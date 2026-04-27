/**
 * Process fitted ships from character assets
 * Finds all fitted ships and their modules, rigs, cargo, etc.
 */

import { findFittedShips } from '../../processors/helpers/ships'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { CharacterAsset } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Process fitted ships by finding all ships and their fitted items
 * Retrieves raw assets from fetch-assets step (not processed assets, since we need ALL assets)
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchAssetsResult - Result from fetch-assets step (raw assets)
 * @param workflowInstanceId - Workflow instance ID
 * @returns StepResult with fitted ships data
 */
export async function processFittedShips(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchAssetsResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
): Promise<StepResult> {
	try {
		// Check if fetch was successful
		if (!fetchAssetsResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchAssetsResult as any).error,
			}
		}

		// Retrieve raw assets from fetch step (we need ALL assets, not just station assets)
		const data = await retrieveData(getBucket, fetchAssetsResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch-assets step',
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

		// Find all fitted ships
		console.log('[processFittedShips] Starting fitted ships discovery', {
			totalAssets: assets.length,
			sampleAsset: assets[0]
				? {
						typeId: assets[0].type_id,
						locationId: assets[0].location_id,
						locationType: assets[0].location_type,
						isSingleton: assets[0].is_singleton,
					}
				: null,
		})

		const fittedShips = await findFittedShips(env, assets, characterId)

		console.log('[processFittedShips] Fitted ships discovery complete', {
			fittedShipsCount: fittedShips.length,
			sampleShip: fittedShips[0]
				? {
						shipName: fittedShips[0].shipName,
						shipTypeId: fittedShips[0].shipTypeId,
						locationType: fittedShips[0].locationType,
						rigsCount: fittedShips[0].rigs.length,
						highsCount: fittedShips[0].highs.length,
						medsCount: fittedShips[0].meds.length,
						lowsCount: fittedShips[0].lows.length,
					}
				: null,
		})

		// Store in R2
		console.log('[processFittedShips] Storing fitted ships in R2', {
			count: fittedShips.length,
			bucketName,
			workflowInstanceId,
		})
		const result = await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-fitted-ships',
			fittedShips,
		)

		console.log('[processFittedShips] Storage result', {
			source: result.source,
			success: result.success,
			r2Bucket: result.source === 'r2' ? result.r2Bucket : 'N/A',
			r2Key: result.source === 'r2' ? result.r2Key : 'N/A',
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
