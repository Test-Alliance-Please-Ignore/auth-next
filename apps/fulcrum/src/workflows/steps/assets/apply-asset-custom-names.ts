/**
 * Apply custom asset names to processed assets and fitted ships
 * Reads the name map from fetch-asset-names step and merges into already-processed data
 * Overwrites the existing R2 data in-place so persist step picks up the updated versions
 */

import { retrieveData, storeInR2 } from '../../utils/storage'

import type { ProcessedAsset } from '../../processors/helpers/assets'
import type { FittedShip } from '../../processors/helpers/ships'
import type { AssetNameMap } from './fetch-asset-names'
import type { StepResult } from '../../utils/storage'

/**
 * Merge custom names into processed assets and fitted ships
 * Updates the R2 objects in-place so the persist step reads the enriched versions
 */
export async function applyAssetCustomNames(
    getBucket: (name: string) => R2Bucket,
    bucket: R2Bucket,
    fetchAssetNamesResult: StepResult,
    processAssetsResult: StepResult,
    processFittedShipsResult: StepResult,
): Promise<{ applied: number; warning?: string }> {
    try {
        // Retrieve the name map
        const nameMap = (await retrieveData(getBucket, fetchAssetNamesResult)) as AssetNameMap | null
        if (!nameMap || Object.keys(nameMap).length === 0) {
            return { applied: 0 }
        }

        let applied = 0

        // Enrich processed assets
        if (processAssetsResult.success && processAssetsResult.source === 'r2') {
            const assets = (await retrieveData(getBucket, processAssetsResult)) as ProcessedAsset[] | null
            if (assets && Array.isArray(assets)) {
                for (const asset of assets) {
                    const customName = nameMap[String(asset.item_id)]
                    if (customName) {
                        asset.customName = customName
                        applied++
                    }
                }
                const assetBucket = getBucket(processAssetsResult.r2Bucket)
                await storeInR2(assetBucket, processAssetsResult.r2Key, assets)
            }
        }

        // Enrich fitted ships
        if (processFittedShipsResult.success && processFittedShipsResult.source === 'r2') {
            const ships = (await retrieveData(getBucket, processFittedShipsResult)) as FittedShip[] | null
            if (ships && Array.isArray(ships)) {
                for (const ship of ships) {
                    const customName = nameMap[ship.itemId]
                    if (customName) {
                        ship.customName = customName
                        applied++
                    }
                }
                const shipBucket = getBucket(processFittedShipsResult.r2Bucket)
                await storeInR2(shipBucket, processFittedShipsResult.r2Key, ships)
            }
        }

        return { applied }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[applyAssetCustomNames] Non-critical enrichment failed:', { error: msg })
        return { applied: 0, warning: msg }
    }
}
