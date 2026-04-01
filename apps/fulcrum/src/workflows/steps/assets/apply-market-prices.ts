/**
 * Fetch ESI market prices and apply estimated values to processed assets
 * Uses the public /markets/prices/ endpoint (unauthenticated) to get CCP average prices
 * Then merges averagePrice into already-processed assets in R2
 */

import { retrieveData, storeInR2 } from '../../utils/storage'

import type { ProcessedAsset } from '../../processors/helpers/assets'
import type { StepResult } from '../../utils/storage'

interface EsiMarketPrice {
	type_id: number
	average_price?: number
	adjusted_price?: number
}

/**
 * Fetch market prices from ESI and apply to processed assets
 * Updates the R2 object in-place so the persist step reads the enriched version
 */
export async function applyMarketPrices(
	getBucket: (name: string) => R2Bucket,
	processAssetsResult: StepResult,
): Promise<{ applied: number; totalValue: number; warning?: string }> {
	try {
		if (!processAssetsResult.success || processAssetsResult.source !== 'r2') {
			return { applied: 0, totalValue: 0 }
		}

		// Fetch market prices from ESI (unauthenticated, ~14k items) with 30s timeout
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 30_000)
		let response: Response
		try {
			response = await fetch('https://esi.evetech.net/latest/markets/prices/', {
				headers: { Accept: 'application/json' },
				signal: controller.signal,
			})
		} finally {
			clearTimeout(timeout)
		}

		if (!response.ok) {
			console.warn('[applyMarketPrices] Failed to fetch market prices', {
				status: response.status,
			})
			return { applied: 0, totalValue: 0 }
		}

		const prices = await response.json<EsiMarketPrice[]>()

		// Build price lookup map
		const priceMap = new Map<string, number>()
		for (const p of prices) {
			if (p.average_price != null) {
				priceMap.set(String(p.type_id), p.average_price)
			}
		}

		// Retrieve processed assets
		const assets = (await retrieveData(getBucket, processAssetsResult)) as ProcessedAsset[] | null
		if (!assets || !Array.isArray(assets)) {
			return { applied: 0, totalValue: 0 }
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

		console.log('[applyMarketPrices] Applied prices', {
			priceMapSize: priceMap.size,
			assetsCount: assets.length,
			applied,
			totalValue: Math.round(totalValue),
		})

		return { applied, totalValue: Math.round(totalValue) }
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		console.error('[applyMarketPrices] Non-critical enrichment failed:', { error: msg })
		return { applied: 0, totalValue: 0, warning: msg }
	}
}
