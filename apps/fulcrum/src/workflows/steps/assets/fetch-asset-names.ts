/**
 * Fetch custom asset names (player-assigned names) from ESI
 * Fetches names for singleton ships and containers (items that can be renamed)
 */

import { getEsiInstanceForCharacter } from '@repo/esi'

import { shipTypeIds } from '../../processors/helpers/ship-types'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { CharacterAsset } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

/**
 * Map of item_id → custom name
 */
export type AssetNameMap = Record<string, string>

/**
 * Fetch custom names for ship assets from ESI
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchAssetsResult - Result from fetch-assets step (raw assets)
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - EVE character ID
 * @returns StepResult with asset name map { item_id: customName }
 */
export async function fetchAssetNames(
    esiBinding: DurableObjectNamespace,
    getBucket: (name: string) => R2Bucket,
    bucket: R2Bucket,
    bucketName: string,
    fetchAssetsResult: StepResult,
    workflowInstanceId: string,
    characterId: string,
): Promise<StepResult> {
    try {
        if (!fetchAssetsResult.success) {
            return {
                source: 'none',
                success: false,
                error: 'Fetch assets failed: ' + (fetchAssetsResult as any).error,
            }
        }

        // Retrieve raw assets to find which items to get names for
        const data = await retrieveData(getBucket, fetchAssetsResult)
        if (!data) {
            return {
                source: 'none',
                success: false,
                error: 'No assets data retrieved',
            }
        }

        const assets = data as CharacterAsset[]
        if (!Array.isArray(assets)) {
            return {
                source: 'none',
                success: false,
                error: 'Invalid assets structure',
            }
        }

        // Singleton items can have custom names — ships and containers
        const nameableItemIds = assets
            .filter((a) => a.is_singleton && (shipTypeIds.has(a.type_id) || a.location_flag === 'Hangar'))
            .map((a) => a.item_id)

        console.log('[fetchAssetNames] Fetching custom names', {
            totalAssets: assets.length,
            nameableItemIds: nameableItemIds.length,
        })

        const nameMap: AssetNameMap = {}

        if (nameableItemIds.length > 0) {
            const stub = getEsiInstanceForCharacter(esiBinding, characterId)
            stub.setDefaultCacheMode('no-store')

            // ESI limits to 1000 item IDs per request
            const BATCH_SIZE = 1000
            for (let i = 0; i < nameableItemIds.length; i += BATCH_SIZE) {
                const batch = nameableItemIds.slice(i, i + BATCH_SIZE)
                const names = await stub.fetchCharacterAssetNames(characterId, batch)

                for (const entry of names) {
                    // Only store non-empty custom names that differ from default type names
                    if (entry.name && entry.name.trim().length > 0) {
                        nameMap[entry.item_id] = entry.name
                    }
                }
            }
        }

        console.log('[fetchAssetNames] Custom names fetched', {
            requestedCount: nameableItemIds.length,
            namedCount: Object.keys(nameMap).length,
        })

        return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-asset-names', nameMap)
    } catch (error) {
        console.error('[fetchAssetNames] Error:', {
            error: error instanceof Error ? error.message : String(error),
        })
        // Non-critical — return empty map so report generation continues without custom names
        return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-asset-names', {})
    }
}
