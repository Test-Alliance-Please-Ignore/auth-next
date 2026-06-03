/**
 * Fetch stored market prices and apply estimated values to processed assets and fitted ships.
 * Uses the Markets worker so price enrichment stays behind the shared market data path.
 */

import { getStub } from '@repo/do-utils'
import type { Markets } from '@repo/markets'

import { retrieveData, storeInR2 } from '../../utils/storage'

import type { ProcessedAsset } from '../../processors/helpers/assets'
import type { FittedShip } from '../../processors/helpers/ships'
import type { StepResult } from '../../utils/storage'

/**
 * Fetch stored market prices and apply to processed assets and fitted ships
 * Updates the R2 objects in-place so the persist step reads the enriched version
 */
export async function applyMarketPrices(
	getBucket: (name: string) => R2Bucket,
	marketsBinding: DurableObjectNamespace,
	processAssetsResult: StepResult,
	processFittedShipsResult?: StepResult,
): Promise<{ applied: number; totalValue: number; shipsEnriched?: number; warning?: string }> {
	try {
		if (!processAssetsResult.success || processAssetsResult.source !== 'r2') {
			return { applied: 0, totalValue: 0 }
		}

		// Retrieve processed assets
		const assets = (await retrieveData(getBucket, processAssetsResult)) as ProcessedAsset[] | null
		if (!assets || !Array.isArray(assets)) {
			return { applied: 0, totalValue: 0 }
		}

		const shipTypes =
			processFittedShipsResult?.success && processFittedShipsResult.source === 'r2'
				? ((await retrieveData(getBucket, processFittedShipsResult)) as FittedShip[] | null)
				: null

		const typeIds = new Set<string>()
		for (const asset of assets) {
			typeIds.add(String(asset.type_id))
		}
		for (const ship of shipTypes ?? []) {
			typeIds.add(ship.shipTypeId)
			for (const slotGroup of [
				ship.highs,
				ship.meds,
				ship.lows,
				ship.rigs,
				ship.subsystems,
				ship.drones,
				ship.cargo,
				ship.fuel,
				ship.fighters ?? [],
				ship.fighterBay ?? [],
				ship.shipsInSmb ?? [],
				ship.fleetHangar ?? [],
				...(ship.specializedBays ?? []).map((b) => b.items),
			]) {
				for (const item of slotGroup) {
					typeIds.add(item.typeId)
				}
			}
		}

		const priceMap = new Map<string, number>()
		const marketsStub = getStub<Markets>(marketsBinding, 'universe')
		const priceDate = new Date().toISOString().slice(0, 10)
		const uniqueTypeIds = [...typeIds]
		const BATCH_SIZE = 500
		for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
			const batch = uniqueTypeIds.slice(i, i + BATCH_SIZE)
			const batchPrices = await marketsStub.getMarketPricesForTypes(batch, priceDate)
			for (const price of batchPrices) {
				if (price.averagePrice != null) {
					priceMap.set(price.typeId, price.averagePrice)
				}
			}
		}

		// Apply prices to assets
		let applied = 0
		let totalValue = 0
		for (const asset of assets) {
			const price = priceMap.get(String(asset.type_id))
			if (price != null) {
				asset.averagePrice = price
				asset.estimatedValue = price * asset.quantity
				totalValue += price * asset.quantity
				applied++
			}
		}

		// Write back to R2
		const assetBucket = getBucket(processAssetsResult.r2Bucket)
		await storeInR2(assetBucket, processAssetsResult.r2Key, assets)

		// Enrich fitted ships if result provided
		let shipsEnriched = 0
		if (shipTypes && Array.isArray(shipTypes)) {
			for (const ship of shipTypes) {
				let shipValue = 0
				const hullPrice = priceMap.get(ship.shipTypeId)
				if (hullPrice != null) shipValue += hullPrice
				const allSlots = [
					ship.highs,
					ship.meds,
					ship.lows,
					ship.rigs,
					ship.subsystems,
					ship.drones,
					ship.cargo,
					ship.fuel,
					ship.fighters ?? [],
					ship.fighterBay ?? [],
					ship.shipsInSmb ?? [],
					ship.fleetHangar ?? [],
					...(ship.specializedBays ?? []).map((b) => b.items),
				]
				for (const items of allSlots) {
					for (const item of items) {
						const itemPrice = priceMap.get(item.typeId)
						if (itemPrice != null) shipValue += itemPrice * item.quantity
					}
				}
				if (shipValue > 0) {
					ship.estimatedValue = Math.round(shipValue)
					shipsEnriched++
				}
			}
			const fittedShipsResult = processFittedShipsResult as StepResult & {
				r2Bucket: string
				r2Key: string
			}
			const shipBucket = getBucket(fittedShipsResult.r2Bucket)
			await storeInR2(shipBucket, fittedShipsResult.r2Key, shipTypes)
		}

		console.log('[applyMarketPrices] Applied prices', {
			priceMapSize: priceMap.size,
			assetsCount: assets.length,
			applied,
			shipsEnriched,
			totalValue: Math.round(totalValue),
		})

		return { applied, totalValue: Math.round(totalValue), shipsEnriched }
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		console.error('[applyMarketPrices] Non-critical enrichment failed:', { error: msg })
		return { applied: 0, totalValue: 0, warning: msg }
	}
}
