import { WorkflowEntrypoint } from 'cloudflare:workers'

import { sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { Esi } from '@repo/esi'
import type { Universe } from '@repo/universe'

import { createDb } from '../db'
import { insuranceDailyPrices, marketDailyPrices } from '../db/schema'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'
import { logger } from '@repo/hono-helpers'
import { PRICE_INSERT_BATCH_SIZE, splitIntoBatches } from '../utils/batching'

export interface DailyPriceBatchParams {
	/** Target date in 'YYYY-MM-DD' format */
	targetDate: string
}

/**
 * DailyPriceBatchWorkflow
 *
 * Runs hourly. Fetches /markets/prices/ and /insurance/prices/ from the ESI DO
 * (both cached 1h) then makes a single pass through the market price whitelist:
 *
 * - Every whitelisted type gets a market_daily_prices row upserted for targetDate
 * - Any type that appears in the insurance data (i.e. is a ship) also gets an
 *   insurance_daily_prices row upserted for targetDate
 *
 * Because both ESI calls are served from the DO cache after the first call each
 * hour, parallel workflow instances triggered by the same cron share the same
 * in-memory response.
 *
 * Single step: fetch whitelist from Universe DO, fetch /markets/prices/ +
 * /insurance/prices/ from ESI DO, process whitelist, and upsert both tables
 * in one pass so no large payload crosses a workflow step boundary.
 */
export class DailyPriceBatchWorkflow extends WorkflowEntrypoint<Env, DailyPriceBatchParams> {
	async run(event: WorkflowEvent<DailyPriceBatchParams>, step: WorkflowStep): Promise<void> {
		const { targetDate } = event.payload

		await step.do(
			'fetch-and-store',
			{ retries: { limit: 3, delay: '10 seconds' }, timeout: '5 minutes' },
			async () => {
				const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
				const typeIds = await universeStub.getMarketPriceWhitelist()

				if (typeIds.length === 0) {
					logger.log('[DailyPriceWorkflow] Empty whitelist — nothing to upsert')
					return
				}

				const esiStub = getStub<Esi>(this.env.ESI, 'global')

				// Both calls are served from ESI DO cache after the first caller each hour
				const [allMarketPrices, allInsurancePrices] = await Promise.all([
					esiStub.fetchMarketPrices(),
					esiStub.fetchInsurancePrices(),
				])

				// Build lookup maps for O(1) access during the whitelist pass
				const marketPriceMap = new Map(allMarketPrices.map((p) => [p.typeId, p]))
				const insuranceMap = new Map(allInsurancePrices.map((p) => [p.typeId, p]))

				const marketRows: Array<typeof marketDailyPrices.$inferInsert> = []
				const insuranceRows: Array<typeof insuranceDailyPrices.$inferInsert> = []

				for (const typeId of typeIds) {
					const mp = marketPriceMap.get(typeId)
					const avg = mp?.averagePrice
					if (avg && avg > 0) {
						marketRows.push({
							locationId: 'universe',
							locationType: 'region',
							typeId,
							priceDate: targetDate,
							avgSellPrice: Math.round(avg).toString(),
							avgBuyPrice: null,
							minSellPrice: null,
							maxSellPrice: null,
							snapshotCount: 0,
						})
					}

					// If this type has insurance data it's a ship — snapshot the platinum tier
					const ins = insuranceMap.get(typeId)
					if (ins) {
						insuranceRows.push({
							typeId,
							priceDate: targetDate,
							platinumCost: ins.platinumCost != null ? String(ins.platinumCost) : null,
							platinumPayout: ins.platinumPayout != null ? String(ins.platinumPayout) : null,
						})
					}
				}

				const db = createDb(this.env.DATABASE_URL)

				if (marketRows.length > 0) {
					const marketBatches = splitIntoBatches(marketRows, PRICE_INSERT_BATCH_SIZE)
					for (const [batchIndex, batch] of marketBatches.entries()) {
						logger.log(
							`[DailyPriceWorkflow] Upserting market prices batch ${batchIndex + 1}/${marketBatches.length} (${batch.length} rows)`
						)
						await db
							.insert(marketDailyPrices)
							.values(batch)
							.onConflictDoUpdate({
								target: [
									marketDailyPrices.locationId,
									marketDailyPrices.typeId,
									marketDailyPrices.priceDate,
								],
								set: {
									avgSellPrice: sql`EXCLUDED.avg_sell_price`,
									updatedAt: sql`NOW()`,
								},
							})
					}
				}

				if (insuranceRows.length > 0) {
					const insuranceBatches = splitIntoBatches(insuranceRows, PRICE_INSERT_BATCH_SIZE)
					for (const [batchIndex, batch] of insuranceBatches.entries()) {
						logger.log(
							`[DailyPriceWorkflow] Upserting insurance prices batch ${batchIndex + 1}/${insuranceBatches.length} (${batch.length} rows)`
						)
						await db
							.insert(insuranceDailyPrices)
							.values(batch)
							.onConflictDoUpdate({
								target: [insuranceDailyPrices.typeId, insuranceDailyPrices.priceDate],
								set: {
									platinumCost: sql`EXCLUDED.platinum_cost`,
									platinumPayout: sql`EXCLUDED.platinum_payout`,
								},
							})
					}
				}

				logger.log(
					`[DailyPriceWorkflow] ${targetDate}: upserted ${marketRows.length} market prices, ${insuranceRows.length} insurance prices (whitelist: ${typeIds.length})`
				)
			}
		)
	}
}
