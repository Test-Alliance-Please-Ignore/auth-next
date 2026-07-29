import { DurableObject } from 'cloudflare:workers'

import { max } from 'drizzle-orm'
import { and, desc, eq, gt, inArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { GetRegionMarketDataResponseObjectSchema } from '@repo/markets'

import { createDb } from './db'
import { getSnapshotDeleteCount } from './utils/snapshot-retention'
import {
	apiKeys,
	insuranceDailyPrices,
	latestMarketPrices,
	marketDailyPrices,
	marketOrders,
	marketSnapshots,
} from './db/schema'

import type { DbClientWs } from '@repo/db-utils'
import type { Esi } from '@repo/esi'
import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	GetBatchMarketDataInput,
	GetBatchMarketDataResponse,
	GetRegionMarketDataInput,
	GetRegionMarketDataResponse,
	GetRegionMarketDataResponseObject,
	LatestMarketPrice,
	Markets,
} from '@repo/markets'
import type { Env } from './context'
import { logger } from '@repo/hono-helpers'

const schema = {
	apiKeys,
	insuranceDailyPrices,
	latestMarketPrices,
	marketDailyPrices,
	marketOrders,
	marketSnapshots,
}

/**
 * Markets Durable Object
 *
 * Manages market data fetching, storage, and querying for EVE Online.
 * Stores market snapshots as time-series data for historical analysis.
 *
 * Features:
 * - Fetches market orders from ESI API
 * - Stores historical snapshots (time-series data)
 * - Optimized batch lookups (up to 500 items in ~20-50ms)
 * - Pre-computed latest prices via materialized view
 */
export class MarketsDO extends DurableObject<Env, {}> implements Markets {
	private db: DbClientWs<typeof schema>

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)

		// Initialize SQLite schema for configuration storage
		this.state.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS config (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				location_id TEXT,
				location_type TEXT,
				character_id TEXT,
				alarm_enabled INTEGER DEFAULT 0,
				max_snapshots INTEGER DEFAULT NULL,
				max_daily_price_history_days INTEGER DEFAULT NULL
			)
		`)
		// Add column if upgrading from an older schema that didn't have it
		try {
			this.state.storage.sql.exec(`ALTER TABLE config ADD COLUMN max_snapshots INTEGER DEFAULT NULL`)
		} catch {
			// Column already exists — ignore
		}
		try {
			this.state.storage.sql.exec(
				`ALTER TABLE config ADD COLUMN max_daily_price_history_days INTEGER DEFAULT NULL`
			)
		} catch {
			// Column already exists — ignore
		}
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	/**
	 * Get the maximum number of snapshots to retain for a location
	 * Checks SQLite config first, falls back to environment variable
	 */
	private getMaxSnapshots(): number {
		// Query SQLite config for override
		const config = this.state.storage.sql
			.exec<{ max_snapshots: number | null }>('SELECT max_snapshots FROM config WHERE id = 1')
			.toArray()[0]

		// Use config if set, otherwise fall back to env var
		if (config?.max_snapshots !== null && config?.max_snapshots !== undefined) {
			return config.max_snapshots
		}

		// Fall back to environment variable (default is 168 = 1 week)
		return this.env.MAX_SNAPSHOTS_PER_LOCATION ?? 168
	}

	/**
	 * Get the maximum number of days to retain daily price aggregates
	 * Checks SQLite config first, falls back to environment variable
	 */
	private getMaxDailyPriceHistoryDays(): number {
		const config = this.state.storage.sql
			.exec<{
				max_daily_price_history_days: number | null
			}>('SELECT max_daily_price_history_days FROM config WHERE id = 1')
			.toArray()[0]

		if (
			config?.max_daily_price_history_days !== null &&
			config?.max_daily_price_history_days !== undefined
		) {
			return config.max_daily_price_history_days
		}

		return this.env.MAX_DAILY_PRICE_HISTORY_DAYS ?? 60
	}

	/**
	 * Clean up old snapshots that exceed the maximum retention limit
	 * Implements ring buffer behavior by deleting oldest snapshots
	 */
	private async cleanupOldSnapshots(
		locationId: string,
		locationType: 'region' | 'structure'
	): Promise<void> {
		try {
			const maxSnapshots = this.getMaxSnapshots()

			// Skip cleanup if retention is disabled or invalid.
			if (maxSnapshots <= 0) {
				logger.warn(
					`[cleanupOldSnapshots] Skipping cleanup - invalid maxSnapshots: ${maxSnapshots}`
				)
				return
			}

			logger.log(
				`[cleanupOldSnapshots] Checking snapshots for ${locationType} ${locationId} (max: ${maxSnapshots})`
			)

			// Count total complete snapshots for this location
			const [countResult] = await this.db
				.select({ count: sql<number>`COUNT(*)` })
				.from(marketSnapshots)
				.where(
					and(
						eq(marketSnapshots.locationId, locationId),
						eq(marketSnapshots.locationType, locationType),
						eq(marketSnapshots.status, 'complete')
					)
				)

			const totalSnapshots = countResult?.count ?? 0
			logger.log(`[cleanupOldSnapshots] Found ${totalSnapshots} complete snapshots`)

			// Only delete if we exceed the limit
			const deleteCount = getSnapshotDeleteCount(totalSnapshots, maxSnapshots)
			if (deleteCount === 0) {
				logger.log(`[cleanupOldSnapshots] Within limit, no cleanup needed`)
				return
			}

			logger.log(`[cleanupOldSnapshots] Need to delete ${deleteCount} oldest snapshots`)

			// Get the oldest snapshots to delete
			const snapshotsToDelete = await this.db
				.select({
					id: marketSnapshots.id,
					snapshotTime: marketSnapshots.snapshotTime,
				})
				.from(marketSnapshots)
				.where(
					and(
						eq(marketSnapshots.locationId, locationId),
						eq(marketSnapshots.locationType, locationType),
						eq(marketSnapshots.status, 'complete')
					)
				)
				.orderBy(marketSnapshots.snapshotTime) // ASC = oldest first
				.limit(deleteCount)

			if (snapshotsToDelete.length === 0) {
				logger.warn(`[cleanupOldSnapshots] No snapshots found to delete`)
				return
			}

			const oldestTime = snapshotsToDelete[0].snapshotTime
			const newestTime = snapshotsToDelete[snapshotsToDelete.length - 1].snapshotTime

			logger.log(
				`[cleanupOldSnapshots] Deleting ${snapshotsToDelete.length} snapshots from ${oldestTime} to ${newestTime}`
			)

			// Roll up complete days into market_daily_prices before deleting raw orders.
			// Only rolls up days that are fully in the past (DATE < CURRENT_DATE) to avoid
			// partial-day averages from still-in-progress snapshot windows.
			logger.log(`[cleanupOldSnapshots] Rolling up daily price aggregates`)
			await this.db.execute(sql`
				INSERT INTO market_daily_prices
					(location_id, location_type, price_date, type_id,
					 avg_sell_price, avg_buy_price, min_sell_price, max_sell_price, snapshot_count)
				WITH snapshots_to_rollup AS (
					SELECT id
					FROM market_snapshots
					WHERE location_id = ${locationId}
					  AND location_type = ${locationType}
					  AND status = 'complete'
					ORDER BY snapshot_time ASC
					LIMIT ${deleteCount}
				),
				snapshot_bests AS (
					SELECT
						source_location_id,
						source_location_type,
						DATE(snapshot_time AT TIME ZONE 'UTC') AS price_date,
						type_id,
						snapshot_id,
						MIN(CASE WHEN is_buy_order = false THEN price::numeric END) AS best_sell,
						MAX(CASE WHEN is_buy_order = true  THEN price::numeric END) AS best_buy
					FROM market_orders
					WHERE snapshot_id IN (SELECT id FROM snapshots_to_rollup)
					  AND DATE(snapshot_time AT TIME ZONE 'UTC') < CURRENT_DATE
					GROUP BY source_location_id, source_location_type,
					         DATE(snapshot_time AT TIME ZONE 'UTC'), type_id, snapshot_id
				)
				SELECT
					source_location_id,
					source_location_type,
					price_date,
					type_id,
					AVG(best_sell)::text,
					AVG(best_buy)::text,
					MIN(best_sell)::text,
					MAX(best_sell)::text,
					COUNT(*)::integer
				FROM snapshot_bests
				GROUP BY source_location_id, source_location_type, price_date, type_id
				ON CONFLICT (location_id, type_id, price_date) DO UPDATE SET
					avg_sell_price = EXCLUDED.avg_sell_price,
					avg_buy_price  = EXCLUDED.avg_buy_price,
					min_sell_price = EXCLUDED.min_sell_price,
					max_sell_price = EXCLUDED.max_sell_price,
					snapshot_count = EXCLUDED.snapshot_count,
					updated_at     = NOW()
			`)
			logger.log(`[cleanupOldSnapshots] Daily rollup complete`)

			// Delete oldest snapshots (CASCADE handles market_orders), without passing giant ID lists.
			await this.db.execute(sql`
				WITH snapshots_to_delete AS (
					SELECT id
					FROM market_snapshots
					WHERE location_id = ${locationId}
					  AND location_type = ${locationType}
					  AND status = 'complete'
					ORDER BY snapshot_time ASC
					LIMIT ${deleteCount}
				)
				DELETE FROM latest_market_prices
				WHERE snapshot_id IN (SELECT id FROM snapshots_to_delete)
			`)
			await this.db.execute(sql`
				WITH snapshots_to_delete AS (
					SELECT id
					FROM market_snapshots
					WHERE location_id = ${locationId}
					  AND location_type = ${locationType}
					  AND status = 'complete'
					ORDER BY snapshot_time ASC
					LIMIT ${deleteCount}
				)
				DELETE FROM market_snapshots
				WHERE id IN (SELECT id FROM snapshots_to_delete)
			`)

			// Trim daily price history beyond retention limit
			const maxDailyDays = this.getMaxDailyPriceHistoryDays()
			await this.db.execute(sql`
				DELETE FROM market_daily_prices
				WHERE location_id = ${locationId}
				  AND price_date < (CURRENT_DATE - (${maxDailyDays} || ' days')::interval)::date
			`)
			logger.log(`[cleanupOldSnapshots] Trimmed daily prices older than ${maxDailyDays} days`)

			logger.log(
				`[cleanupOldSnapshots] SUCCESS - Deleted ${snapshotsToDelete.length} snapshots and associated data`
			)
		} catch (error) {
			// Log error but don't throw - cleanup is non-critical
			logger.error(`[cleanupOldSnapshots] ERROR during cleanup:`, error)
		}
	}

	// ========================================================================
	// PUBLIC RPC METHODS
	// ========================================================================

	/**
	 * Get market data for a region, optionally filtered by type and order type
	 *
	 * @param input - Query parameters
	 * @returns Array of market orders
	 */
	async getRegionMarketData(input: GetRegionMarketDataInput): Promise<GetRegionMarketDataResponse> {
		const { regionId, typeId, orderType = 'all', useCachedData = true } = input

		// Check if we need to fetch new data
		let shouldFetch = !useCachedData

		if (useCachedData) {
			// Check for recent snapshot (last 5 minutes)
			const recentSnapshot = await this.db
				.select()
				.from(marketSnapshots)
				.where(
					and(
						eq(marketSnapshots.locationId, regionId),
						eq(marketSnapshots.locationType, 'region'),
						eq(marketSnapshots.status, 'complete'),
						sql`${marketSnapshots.snapshotTime} > NOW() - INTERVAL '5 minutes'`
					)
				)
				.orderBy(desc(marketSnapshots.snapshotTime))
				.limit(1)

			if (recentSnapshot.length === 0) {
				shouldFetch = true
			}
		}

		// Fetch new snapshot if needed
		if (shouldFetch) {
			await this.fetchAndStoreSnapshot(regionId)
		}

		// Query orders from database
		const conditions = [
			eq(marketOrders.sourceLocationId, regionId),
			eq(marketOrders.sourceLocationType, 'region'),
		]

		if (typeId) {
			conditions.push(eq(marketOrders.typeId, typeId))
		}

		if (orderType !== 'all') {
			conditions.push(eq(marketOrders.isBuyOrder, orderType === 'buy'))
		}

		// Get most recent snapshot time for this region
		const latestSnapshotTime = await this.db
			.select({ snapshotTime: marketSnapshots.snapshotTime })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, regionId),
					eq(marketSnapshots.locationType, 'region'),
					eq(marketSnapshots.status, 'complete')
				)
			)
			.orderBy(desc(marketSnapshots.snapshotTime))
			.limit(1)

		if (latestSnapshotTime.length === 0) {
			return []
		}

		conditions.push(eq(marketOrders.snapshotTime, latestSnapshotTime[0].snapshotTime))

		const orders = await this.db
			.select()
			.from(marketOrders)
			.where(and(...conditions))
			.orderBy(desc(marketOrders.price))

		// Transform to response format
		return orders.map((order) => ({
			duration: order.duration,
			is_buy_order: order.isBuyOrder,
			issued: order.issued,
			location_id: order.locationId,
			min_volume: order.minVolume,
			order_id: order.orderId,
			price: parseFloat(order.price),
			range: order.range,
			system_id: order.systemId,
			type_id: order.typeId,
			volume_remain: order.volumeRemain,
			volume_total: order.volumeTotal,
		}))
	}

	/**
	 * Get latest prices for multiple items at once (up to 500 items)
	 * Optimized for batch lookups with ~20-50ms response time
	 *
	 * @param input - Region and array of type IDs
	 * @returns Latest price summary per item and list of missing type IDs
	 */
	async getBatchMarketData(input: GetBatchMarketDataInput): Promise<GetBatchMarketDataResponse> {
		const { regionId, typeIds, useCachedData = true } = input

		// Validate batch size
		if (typeIds.length > 500) {
			throw new Error(`Batch size ${typeIds.length} exceeds maximum of 500`)
		}

		// Deduplicate type IDs
		const uniqueTypeIds = [...new Set(typeIds)]

		if (uniqueTypeIds.length === 0) {
			return { prices: [], missingTypeIds: [] }
		}

		// Check if we need to fetch new data
		if (!useCachedData) {
			await this.fetchAndStoreSnapshot(regionId)
		} else {
			// Check for recent snapshot (last 5 minutes)
			const recentSnapshot = await this.db
				.select()
				.from(marketSnapshots)
				.where(
					and(
						eq(marketSnapshots.locationId, regionId),
						eq(marketSnapshots.locationType, 'region'),
						eq(marketSnapshots.status, 'complete'),
						sql`${marketSnapshots.snapshotTime} > NOW() - INTERVAL '5 minutes'`
					)
				)
				.orderBy(desc(marketSnapshots.snapshotTime))
				.limit(1)

			if (recentSnapshot.length === 0) {
				await this.fetchAndStoreSnapshot(regionId)
			}
		}

		// Query latest prices from materialized view
		const prices = await this.db
			.select()
			.from(latestMarketPrices)
			.where(
				and(
					eq(latestMarketPrices.locationId, regionId),
					eq(latestMarketPrices.locationType, 'region'),
					inArray(latestMarketPrices.typeId, uniqueTypeIds)
				)
			)

		// Find missing type IDs
		const foundTypeIds = new Set(prices.map((p) => p.typeId))
		const missingTypeIds = uniqueTypeIds.filter((id) => !foundTypeIds.has(id))

		// Transform to response format
		const transformedPrices: LatestMarketPrice[] = prices.map((price) => ({
			typeId: price.typeId,
			snapshotTime: price.snapshotTime,
			bestBuyPrice: price.bestBuyPrice,
			bestBuyOrderId: price.bestBuyOrderId,
			bestBuyLocation: price.bestBuyLocation,
			bestBuyVolume: price.bestBuyVolume,
			totalBuyVolume: price.totalBuyVolume,
			buyOrderCount: price.buyOrderCount,
			bestSellPrice: price.bestSellPrice,
			bestSellOrderId: price.bestSellOrderId,
			bestSellLocation: price.bestSellLocation,
			bestSellVolume: price.bestSellVolume,
			totalSellVolume: price.totalSellVolume,
			sellOrderCount: price.sellOrderCount,
			spreadAmount: price.spreadAmount,
			spreadPercent: price.spreadPercent,
		}))

		return {
			prices: transformedPrices,
			missingTypeIds,
		}
	}

	/**
	 * Get prices for multiple items at a specific point in time (up to 500 items)
	 *
	 * Queries market_daily_prices for the nearest available daily record at or
	 * before atTime. Returns empty prices + all typeIds as missingTypeIds if no
	 * daily history has been populated yet.
	 */
	async getBatchMarketDataAtTime(
		input: import('@repo/markets').GetBatchMarketDataAtTimeInput
	): Promise<GetBatchMarketDataResponse> {
		const { regionId, typeIds, atTime } = input

		if (typeIds.length > 500) {
			throw new Error(`Batch size ${typeIds.length} exceeds maximum of 500`)
		}

		const uniqueTypeIds = [...new Set(typeIds)]
		if (uniqueTypeIds.length === 0) {
			return { prices: [], missingTypeIds: [] }
		}

		// Find the closest available price_date at or before atTime
		const targetDate = atTime.toISOString().slice(0, 10) // 'YYYY-MM-DD'

		const [nearestDay] = await this.db
			.select({ priceDate: marketDailyPrices.priceDate })
			.from(marketDailyPrices)
			.where(
				and(
					eq(marketDailyPrices.locationId, regionId),
					sql`${marketDailyPrices.priceDate} <= ${targetDate}::date`
				)
			)
			.orderBy(sql`${marketDailyPrices.priceDate} DESC`)
			.limit(1)

		if (!nearestDay) {
			// No daily history yet — return graceful empty result
			return { prices: [], missingTypeIds: uniqueTypeIds }
		}

		const rows = await this.db
			.select()
			.from(marketDailyPrices)
			.where(
				and(
					eq(marketDailyPrices.locationId, regionId),
					eq(marketDailyPrices.priceDate, nearestDay.priceDate),
					inArray(marketDailyPrices.typeId, uniqueTypeIds)
				)
			)

		// Represent the daily record as midnight UTC of that date
		const snapshotTime = new Date(`${nearestDay.priceDate}T00:00:00Z`)

		const foundTypeIds = new Set<string>()
		const prices: LatestMarketPrice[] = rows.map((row) => {
			foundTypeIds.add(row.typeId)
			return {
				typeId: row.typeId,
				snapshotTime,
				bestSellPrice: row.avgSellPrice,
				bestSellOrderId: null,
				bestSellLocation: null,
				bestSellVolume: null,
				totalSellVolume: '0',
				sellOrderCount: row.snapshotCount,
				bestBuyPrice: row.avgBuyPrice,
				bestBuyOrderId: null,
				bestBuyLocation: null,
				bestBuyVolume: null,
				totalBuyVolume: '0',
				buyOrderCount: row.snapshotCount,
				spreadAmount: null,
				spreadPercent: null,
			}
		})

		return {
			prices,
			missingTypeIds: uniqueTypeIds.filter((id) => !foundTypeIds.has(id)),
		}
	}

	async getMarketDataRevisionAtTime(
		input: Pick<import('@repo/markets').GetBatchMarketDataAtTimeInput, 'regionId' | 'atTime'>
	): Promise<string | null> {
		const targetDate = input.atTime.toISOString().slice(0, 10)
		const [nearestDay] = await this.db
			.select({ priceDate: marketDailyPrices.priceDate })
			.from(marketDailyPrices)
			.where(
				and(
					eq(marketDailyPrices.locationId, input.regionId),
					sql`${marketDailyPrices.priceDate} <= ${targetDate}::date`
				)
			)
			.orderBy(sql`${marketDailyPrices.priceDate} DESC`)
			.limit(1)

		if (!nearestDay) return null

		const [revision] = await this.db
			.select({ updatedAt: max(marketDailyPrices.updatedAt) })
			.from(marketDailyPrices)
			.where(
				and(
					eq(marketDailyPrices.locationId, input.regionId),
					eq(marketDailyPrices.priceDate, nearestDay.priceDate)
				)
			)

		return revision?.updatedAt
			? `${nearestDay.priceDate}:${revision.updatedAt.toISOString()}`
			: null
	}

	// ========================================================================
	// PRIVATE METHODS - DATA FETCHING
	// ========================================================================

	/**
	 * Fetch market orders from ESI and store as new snapshot (for regions)
	 * Uses streaming to handle large datasets (>32MiB) efficiently
	 *
	 * @param regionId - EVE region ID to fetch market data for
	 */
	private async fetchAndStoreSnapshot(regionId: string, skipRefresh = false): Promise<void> {
		logger.log(`[fetchAndStoreSnapshot] Starting for region ${regionId}`)
		const startTime = Date.now()

		// Create pending snapshot record
		logger.log(`[fetchAndStoreSnapshot] Creating pending snapshot record`)
		const [snapshot] = await this.db
			.insert(marketSnapshots)
			.values({
				locationId: regionId,
				locationType: 'region',
				snapshotTime: new Date(),
				status: 'pending',
			})
			.returning()
		logger.log(`[fetchAndStoreSnapshot] Snapshot created: ${snapshot.id}`)

		try {
			// Fetch stream from ESI via EveTokenStore
			logger.log(`[fetchAndStoreSnapshot] Getting token store stub`)
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			logger.log(`[fetchAndStoreSnapshot] Calling fetchPublicEsiAllPagesStream`)
			const stream = await tokenStore.fetchPublicEsiAllPagesStream(`/markets/${regionId}/orders`)
			logger.log(`[fetchAndStoreSnapshot] Stream received, starting to read`)

			// Decode stream as text
			const reader = stream.pipeThrough(new TextDecoderStream()).getReader()

			let buffer = ''
			let ordersToInsert: Array<typeof marketOrders.$inferInsert> = []
			let totalOrders = 0
			const BATCH_SIZE = 1000

			// Read stream line by line
			while (true) {
				const { done, value } = await reader.read()

				if (done) {
					break
				}

				// Accumulate chunks and split by newlines
				buffer += value
				const lines = buffer.split('\n')
				buffer = lines.pop() || '' // Keep incomplete line in buffer

				for (const line of lines) {
					if (!line.trim()) {
						continue
					}

					try {
						// Parse and validate each order
						const rawOrder = JSON.parse(line)
						const validatedOrder = GetRegionMarketDataResponseObjectSchema.parse(rawOrder)

						// Convert to database format
						ordersToInsert.push({
							snapshotId: snapshot.id,
							sourceLocationId: snapshot.locationId,
							sourceLocationType: snapshot.locationType,
							snapshotTime: snapshot.snapshotTime,
							orderId: validatedOrder.order_id,
							typeId: validatedOrder.type_id,
							locationId: validatedOrder.location_id,
							systemId: validatedOrder.system_id,
							price: validatedOrder.price.toString(),
							volumeRemain: validatedOrder.volume_remain,
							volumeTotal: validatedOrder.volume_total,
							minVolume: validatedOrder.min_volume,
							isBuyOrder: validatedOrder.is_buy_order,
							duration: validatedOrder.duration,
							issued: validatedOrder.issued,
							range: validatedOrder.range,
						})

						totalOrders++

						// Insert in batches to avoid memory buildup
						if (ordersToInsert.length >= BATCH_SIZE) {
							await this.db.insert(marketOrders).values(ordersToInsert)
							ordersToInsert = [] // Clear for next batch
						}
					} catch (parseError) {
						// Log parse error but continue processing
						logger.error('Failed to parse order:', parseError, line.substring(0, 100))
					}
				}
			}

			// Insert remaining orders
			if (ordersToInsert.length > 0) {
				logger.log(
					`[fetchAndStoreSnapshot] Inserting final batch of ${ordersToInsert.length} orders`
				)
				await this.db.insert(marketOrders).values(ordersToInsert)
			}

			logger.log(`[fetchAndStoreSnapshot] Total orders processed: ${totalOrders}`)

			// Mark snapshot as complete
			const fetchDurationMs = Date.now() - startTime
			logger.log(
				`[fetchAndStoreSnapshot] Marking snapshot complete (duration: ${fetchDurationMs}ms)`
			)
			await this.db
				.update(marketSnapshots)
				.set({
					status: 'complete',
					orderCount: totalOrders,
					fetchDurationMs,
					updatedAt: new Date(),
				})
				.where(eq(marketSnapshots.id, snapshot.id))

			// Refresh materialized view (skip if requested to avoid timeout in waitUntil)
			if (!skipRefresh) {
				logger.log(`[fetchAndStoreSnapshot] Refreshing materialized view`)
				await this.refreshLatestPrices(snapshot.id)
			} else {
				logger.log(
					`[fetchAndStoreSnapshot] Skipping materialized view refresh (will be done on next alarm)`
				)
			}
			logger.log(`[fetchAndStoreSnapshot] SUCCESS - Snapshot complete for region ${regionId}`)

			// Clean up old snapshots (non-blocking)
			await this.cleanupOldSnapshots(regionId, 'region')
		} catch (error) {
			logger.error(`[fetchAndStoreSnapshot] ERROR:`, error)
			// Mark snapshot as failed
			await this.db
				.update(marketSnapshots)
				.set({
					status: 'failed',
					errorMessage: error instanceof Error ? error.message : String(error),
					updatedAt: new Date(),
				})
				.where(eq(marketSnapshots.id, snapshot.id))

			throw error
		}
	}

	/**
	 * Fetch market orders from a structure and store as new snapshot
	 * Uses streaming to handle large datasets (>32MiB) efficiently
	 * Requires authentication via character token
	 *
	 * @param structureId - EVE structure ID to fetch market data for
	 * @param characterId - Character ID for authentication
	 */
	private async fetchAndStoreStructureSnapshot(
		structureId: string,
		characterId: string,
		skipRefresh = false
	): Promise<void> {
		logger.log(`[fetchAndStoreStructureSnapshot] Starting for structure ${structureId}`)
		const startTime = Date.now()

		// Create pending snapshot record
		logger.log(`[fetchAndStoreStructureSnapshot] Creating pending snapshot record`)
		const [snapshot] = await this.db
			.insert(marketSnapshots)
			.values({
				locationId: structureId,
				locationType: 'structure',
				snapshotTime: new Date(),
				status: 'pending',
			})
			.returning()
		logger.log(`[fetchAndStoreStructureSnapshot] Snapshot created: ${snapshot.id}`)

		try {
			// Fetch from ESI via EveTokenStore (authenticated)
			logger.log(`[fetchAndStoreStructureSnapshot] Getting token store stub`)
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			logger.log(`[fetchAndStoreStructureSnapshot] Calling fetchEsi`)

			// Structure markets endpoint returns all orders in single page
			const response = await tokenStore.fetchEsi<GetRegionMarketDataResponseObject[]>(
				`/markets/structures/${structureId}/`,
				characterId,
				{ cacheMode: 'no-store' }
			)

			logger.log(
				`[fetchAndStoreStructureSnapshot] Response received, processing ${response.data.length} orders`
			)

			// Process and insert orders in batches
			let ordersToInsert: Array<typeof marketOrders.$inferInsert> = []
			let totalOrders = 0
			const BATCH_SIZE = 1000

			for (const rawOrder of response.data) {
				try {
					// Validate order
					const validatedOrder = GetRegionMarketDataResponseObjectSchema.parse(rawOrder)

					// Convert to database format
					ordersToInsert.push({
						snapshotId: snapshot.id,
						sourceLocationId: snapshot.locationId,
						sourceLocationType: snapshot.locationType,
						snapshotTime: snapshot.snapshotTime,
						orderId: validatedOrder.order_id,
						typeId: validatedOrder.type_id,
						locationId: validatedOrder.location_id,
						systemId: validatedOrder.system_id,
						price: validatedOrder.price.toString(),
						volumeRemain: validatedOrder.volume_remain,
						volumeTotal: validatedOrder.volume_total,
						minVolume: validatedOrder.min_volume,
						isBuyOrder: validatedOrder.is_buy_order,
						duration: validatedOrder.duration,
						issued: validatedOrder.issued,
						range: validatedOrder.range,
					})

					totalOrders++

					// Insert in batches to avoid memory buildup
					if (ordersToInsert.length >= BATCH_SIZE) {
						await this.db.insert(marketOrders).values(ordersToInsert)
						ordersToInsert = [] // Clear for next batch
					}
				} catch (parseError) {
					// Log parse error but continue processing
					logger.error('Failed to parse order:', parseError)
				}
			}

			// Insert remaining orders
			if (ordersToInsert.length > 0) {
				logger.log(
					`[fetchAndStoreStructureSnapshot] Inserting final batch of ${ordersToInsert.length} orders`
				)
				await this.db.insert(marketOrders).values(ordersToInsert)
			}

			logger.log(`[fetchAndStoreStructureSnapshot] Total orders processed: ${totalOrders}`)

			// Mark snapshot as complete
			const fetchDurationMs = Date.now() - startTime
			logger.log(
				`[fetchAndStoreStructureSnapshot] Marking snapshot complete (duration: ${fetchDurationMs}ms)`
			)
			await this.db
				.update(marketSnapshots)
				.set({
					status: 'complete',
					orderCount: totalOrders,
					fetchDurationMs,
					updatedAt: new Date(),
				})
				.where(eq(marketSnapshots.id, snapshot.id))

			// Refresh materialized view (skip if requested to avoid timeout in waitUntil)
			if (!skipRefresh) {
				logger.log(`[fetchAndStoreStructureSnapshot] Refreshing materialized view`)
				await this.refreshLatestPrices(snapshot.id)
			} else {
				logger.log(
					`[fetchAndStoreStructureSnapshot] Skipping materialized view refresh (will be done on next alarm)`
				)
			}
			logger.log(
				`[fetchAndStoreStructureSnapshot] SUCCESS - Snapshot complete for structure ${structureId}`
			)

			// Clean up old snapshots (non-blocking)
			await this.cleanupOldSnapshots(structureId, 'structure')
		} catch (error) {
			logger.error(`[fetchAndStoreStructureSnapshot] ERROR:`, error)
			// Mark snapshot as failed
			await this.db
				.update(marketSnapshots)
				.set({
					status: 'failed',
					errorMessage: error instanceof Error ? error.message : String(error),
					updatedAt: new Date(),
				})
				.where(eq(marketSnapshots.id, snapshot.id))

			throw error
		}
	}

	/**
	 * Refresh latest prices materialized view for a snapshot
	 * This updates the pre-computed best buy/sell prices for all items in the snapshot
	 *
	 * @param snapshotId - Snapshot ID to refresh prices for
	 */
	private async refreshLatestPrices(snapshotId: string): Promise<void> {
		logger.log(`[refreshLatestPrices] Starting for snapshot ${snapshotId}`)

		// Get snapshot details
		const [snapshot] = await this.db
			.select()
			.from(marketSnapshots)
			.where(eq(marketSnapshots.id, snapshotId))

		if (!snapshot) {
			throw new Error(`Snapshot ${snapshotId} not found`)
		}

		logger.log(`[refreshLatestPrices] Snapshot found:`, {
			locationId: snapshot.locationId,
			locationType: snapshot.locationType,
			snapshotTime: snapshot.snapshotTime,
		})

		// Get all unique type IDs in this snapshot
		const types = await this.db
			.selectDistinct({ typeId: marketOrders.typeId })
			.from(marketOrders)
			.where(eq(marketOrders.snapshotId, snapshotId))

		logger.log(`[refreshLatestPrices] Found ${types.length} unique type IDs`)
		logger.log(
			`[refreshLatestPrices] First 10 type IDs:`,
			types.slice(0, 10).map((t) => t.typeId)
		)

		// Process each type ID
		let processedCount = 0
		for (const { typeId } of types) {
			processedCount++
			if (processedCount % 100 === 0) {
				logger.log(`[refreshLatestPrices] Processed ${processedCount}/${types.length} types`)
			}
			// Get best buy order (highest price)
			const bestBuy = await this.db
				.select()
				.from(marketOrders)
				.where(
					and(
						eq(marketOrders.snapshotId, snapshotId),
						eq(marketOrders.typeId, typeId),
						eq(marketOrders.isBuyOrder, true)
					)
				)
				.orderBy(sql`${marketOrders.price}::numeric DESC`)
				.limit(1)

			// Get best sell order (lowest price)
			const bestSell = await this.db
				.select()
				.from(marketOrders)
				.where(
					and(
						eq(marketOrders.snapshotId, snapshotId),
						eq(marketOrders.typeId, typeId),
						eq(marketOrders.isBuyOrder, false)
					)
				)
				.orderBy(sql`${marketOrders.price}::numeric ASC`)
				.limit(1)

			// Calculate totals for buy orders
			const buyStats = await this.db
				.select({
					totalVolume: sql<string>`COALESCE(SUM(${marketOrders.volumeRemain}::numeric), 0)::text`,
					orderCount: sql<number>`COUNT(*)`,
				})
				.from(marketOrders)
				.where(
					and(
						eq(marketOrders.snapshotId, snapshotId),
						eq(marketOrders.typeId, typeId),
						eq(marketOrders.isBuyOrder, true)
					)
				)

			// Calculate totals for sell orders
			const sellStats = await this.db
				.select({
					totalVolume: sql<string>`COALESCE(SUM(${marketOrders.volumeRemain}::numeric), 0)::text`,
					orderCount: sql<number>`COUNT(*)`,
				})
				.from(marketOrders)
				.where(
					and(
						eq(marketOrders.snapshotId, snapshotId),
						eq(marketOrders.typeId, typeId),
						eq(marketOrders.isBuyOrder, false)
					)
				)

			// Calculate spread
			let spreadAmount: string | null = null
			let spreadPercent: string | null = null
			if (bestBuy[0] && bestSell[0]) {
				const buyPrice = parseFloat(bestBuy[0].price)
				const sellPrice = parseFloat(bestSell[0].price)
				spreadAmount = (sellPrice - buyPrice).toString()
				if (buyPrice > 0) {
					spreadPercent = (((sellPrice - buyPrice) / buyPrice) * 100).toString()
				}
			}

			// Debug logging for Tritanium (type_id 34)
			if (typeId === '34') {
				logger.log(`[refreshLatestPrices] Processing Tritanium (34):`, {
					bestBuyPrice: bestBuy[0]?.price,
					bestSellPrice: bestSell[0]?.price,
					buyOrderCount: buyStats[0].orderCount,
					sellOrderCount: sellStats[0].orderCount,
					totalBuyVolume: buyStats[0].totalVolume,
					totalSellVolume: sellStats[0].totalVolume,
				})
			}

			// Upsert into latest_market_prices
			try {
				await this.db
					.insert(latestMarketPrices)
					.values({
						locationId: snapshot.locationId,
						locationType: snapshot.locationType,
						typeId,
						snapshotId: snapshot.id,
						snapshotTime: snapshot.snapshotTime,
						bestBuyPrice: bestBuy[0]?.price ?? null,
						bestBuyOrderId: bestBuy[0]?.orderId ?? null,
						bestBuyLocation: bestBuy[0]?.locationId ?? null,
						bestBuyVolume: bestBuy[0]?.volumeRemain ?? null,
						totalBuyVolume: buyStats[0].totalVolume,
						buyOrderCount: buyStats[0].orderCount,
						bestSellPrice: bestSell[0]?.price ?? null,
						bestSellOrderId: bestSell[0]?.orderId ?? null,
						bestSellLocation: bestSell[0]?.locationId ?? null,
						bestSellVolume: bestSell[0]?.volumeRemain ?? null,
						totalSellVolume: sellStats[0].totalVolume,
						sellOrderCount: sellStats[0].orderCount,
						spreadAmount,
						spreadPercent,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [latestMarketPrices.locationId, latestMarketPrices.typeId],
						set: {
							snapshotId: snapshot.id,
							snapshotTime: snapshot.snapshotTime,
							bestBuyPrice: bestBuy[0]?.price ?? null,
							bestBuyOrderId: bestBuy[0]?.orderId ?? null,
							bestBuyLocation: bestBuy[0]?.locationId ?? null,
							bestBuyVolume: bestBuy[0]?.volumeRemain ?? null,
							totalBuyVolume: buyStats[0].totalVolume,
							buyOrderCount: buyStats[0].orderCount,
							bestSellPrice: bestSell[0]?.price ?? null,
							bestSellOrderId: bestSell[0]?.orderId ?? null,
							bestSellLocation: bestSell[0]?.locationId ?? null,
							bestSellVolume: bestSell[0]?.volumeRemain ?? null,
							totalSellVolume: sellStats[0].totalVolume,
							sellOrderCount: sellStats[0].orderCount,
							spreadAmount,
							spreadPercent,
							updatedAt: new Date(),
						},
					})

				if (typeId === '34') {
					logger.log(`[refreshLatestPrices] Tritanium (34) upserted successfully`)
				}
			} catch (error) {
				logger.error(`[refreshLatestPrices] ERROR upserting type ${typeId}:`, error)
				throw error
			}
		}

		logger.log(
			`[refreshLatestPrices] COMPLETE - Processed ${processedCount} types for location ${snapshot.locationId}`
		)
	}

	// ========================================================================
	// ALARM HANDLER - HOURLY SNAPSHOTS
	// ========================================================================

	/**
	 * Alarm handler - triggered every hour to take market snapshots
	 * Automatically reschedules itself for the next hour
	 * Supports both regions and structures
	 */
	async alarm(): Promise<void> {
		logger.log(`[alarm] Triggered at ${new Date().toISOString()}`)

		// Check config before entering try/finally so a disabled alarm
		// doesn't reschedule itself (the finally would fire even on early return).
		const config = this.getConfig()
		logger.log(`[alarm] Config:`, config)

		if (!config?.locationId || !config.alarmEnabled) {
			logger.warn(
				`[alarm] Snapshot system disabled — deleting alarm. locationId: ${config?.locationId}, enabled: ${config?.alarmEnabled}`
			)
			await this.state.storage.deleteAlarm()
			return
		}

		try {
			logger.log(`[alarm] Fetching snapshot for ${config.locationType} ${config.locationId}`)

			// Fetch and store new snapshot based on location type
			if (config.locationType === 'region') {
				await this.fetchAndStoreSnapshot(config.locationId)
			} else if (config.locationType === 'structure') {
				if (!config.characterId) {
					logger.error(`[alarm] Structure snapshot requires characterId`)
					return
				}
				await this.fetchAndStoreStructureSnapshot(config.locationId, config.characterId)
			}

			logger.log(`[alarm] Snapshot complete for ${config.locationType} ${config.locationId}`)
		} catch (error) {
			logger.error(`[alarm] ERROR:`, error)
			// Don't throw - we still want to reschedule
		} finally {
			// Reschedule alarm for 1 hour from now
			logger.log(`[alarm] Rescheduling next alarm`)
			await this.scheduleNextAlarm()
		}
	}

	/**
	 * Schedule the next alarm to run 1 hour from now
	 */
	private async scheduleNextAlarm(): Promise<void> {
		const oneHour = 60 * 60 * 1000 // 1 hour in milliseconds
		const nextAlarmTime = Date.now() + oneHour

		await this.state.storage.setAlarm(nextAlarmTime)
		logger.log(`Market alarm scheduled for ${new Date(nextAlarmTime).toISOString()}`)
	}

	/**
	 * Get configuration from SQLite storage
	 */
	private getConfig(): {
		locationId: string | null
		locationType: 'region' | 'structure' | null
		characterId: string | null
		alarmEnabled: boolean
	} {
		try {
			const cursor = this.state.storage.sql.exec(
				`SELECT location_id, location_type, character_id, alarm_enabled FROM config WHERE id = 1`
			)

			// Convert cursor to array
			const rows = [...cursor] as Array<{
				location_id: string | null
				location_type: 'region' | 'structure' | null
				character_id: string | null
				alarm_enabled: number
			}>

			logger.log(`[getConfig] SQLite query returned ${rows.length} rows:`, rows)

			if (rows.length > 0) {
				return {
					locationId: rows[0].location_id,
					locationType: rows[0].location_type,
					characterId: rows[0].character_id,
					alarmEnabled: rows[0].alarm_enabled === 1,
				}
			}
		} catch (error) {
			logger.warn(`[getConfig] SQLite error (table may not exist on old DO instance):`, error)
		}

		// Return default if no config exists or query failed
		logger.log(`[getConfig] No config found or error occurred, returning defaults`)
		return {
			locationId: null,
			locationType: null,
			characterId: null,
			alarmEnabled: false,
		}
	}

	/**
	 * Start automatic hourly snapshots for a region
	 * This configures the DO to fetch market data every hour
	 * Returns immediately and does snapshot work in background
	 *
	 * @param regionId - EVE region ID to monitor
	 */
	async startHourlySnapshots(regionId: string): Promise<void> {
		logger.log(`[startHourlySnapshots] Starting for region ${regionId}`)

		// Update configuration in SQLite storage
		logger.log(`[startHourlySnapshots] Updating SQLite config for regionId: ${regionId}`)
		const writeResult = this.state.storage.sql.exec(
			`INSERT INTO config (id, location_id, location_type, character_id, alarm_enabled) VALUES (1, ?, 'region', NULL, 1)
			 ON CONFLICT(id) DO UPDATE SET location_id = ?, location_type = 'region', character_id = NULL, alarm_enabled = 1`,
			regionId,
			regionId
		)
		logger.log(`[startHourlySnapshots] Write result:`, writeResult)

		// Verify config was saved
		const config = this.getConfig()
		logger.log(`[startHourlySnapshots] Config verified after save:`, config)

		if (!config.locationId || config.locationId !== regionId) {
			logger.error(
				`[startHourlySnapshots] CONFIG MISMATCH! Expected ${regionId}, got ${config.locationId}`
			)
		}

		// Schedule first alarm
		logger.log(`[startHourlySnapshots] Scheduling first alarm`)
		await this.scheduleNextAlarm()

		// Take immediate snapshot in background (don't block the response)
		// Skip refresh to avoid waitUntil timeout - it will run on next alarm
		logger.log(`[startHourlySnapshots] Scheduling immediate snapshot in background`)
		this.ctx.waitUntil(
			(async () => {
				try {
					logger.log(`[startHourlySnapshots:background] Starting immediate snapshot`)
					await this.fetchAndStoreSnapshot(regionId, true)
					logger.log(`[startHourlySnapshots:background] Immediate snapshot complete`)
				} catch (error) {
					logger.error(`[startHourlySnapshots:background] ERROR:`, error)
				}
			})()
		)

		logger.log(
			`[startHourlySnapshots] SUCCESS - Hourly snapshots started for region ${regionId} (snapshot running in background)`
		)
	}

	/**
	 * Start automatic hourly snapshots for a structure
	 * This configures the DO to fetch market data every hour from a player structure
	 * Returns immediately and does snapshot work in background
	 *
	 * @param structureId - EVE structure ID to monitor
	 * @param characterId - Character ID for authentication
	 */
	async startHourlySnapshotsForStructure(structureId: string, characterId: string): Promise<void> {
		logger.log(`[startHourlySnapshotsForStructure] Starting for structure ${structureId}`)

		// Update configuration in SQLite storage
		logger.log(
			`[startHourlySnapshotsForStructure] Updating SQLite config for structureId: ${structureId}`
		)
		const writeResult = this.state.storage.sql.exec(
			`INSERT INTO config (id, location_id, location_type, character_id, alarm_enabled) VALUES (1, ?, 'structure', ?, 1)
			 ON CONFLICT(id) DO UPDATE SET location_id = ?, location_type = 'structure', character_id = ?, alarm_enabled = 1`,
			structureId,
			characterId,
			structureId,
			characterId
		)
		logger.log(`[startHourlySnapshotsForStructure] Write result:`, writeResult)

		// Verify config was saved
		const config = this.getConfig()
		logger.log(`[startHourlySnapshotsForStructure] Config verified after save:`, config)

		if (!config.locationId || config.locationId !== structureId) {
			logger.error(
				`[startHourlySnapshotsForStructure] CONFIG MISMATCH! Expected ${structureId}, got ${config.locationId}`
			)
		}

		// Schedule first alarm
		logger.log(`[startHourlySnapshotsForStructure] Scheduling first alarm`)
		await this.scheduleNextAlarm()

		// Take immediate snapshot in background (don't block the response)
		// Skip refresh to avoid waitUntil timeout - it will run on next alarm
		logger.log(`[startHourlySnapshotsForStructure] Scheduling immediate snapshot in background`)
		this.ctx.waitUntil(
			(async () => {
				try {
					logger.log(`[startHourlySnapshotsForStructure:background] Starting immediate snapshot`)
					await this.fetchAndStoreStructureSnapshot(structureId, characterId, true)
					logger.log(`[startHourlySnapshotsForStructure:background] Immediate snapshot complete`)
				} catch (error) {
					logger.error(`[startHourlySnapshotsForStructure:background] ERROR:`, error)
				}
			})()
		)

		logger.log(
			`[startHourlySnapshotsForStructure] SUCCESS - Hourly snapshots started for structure ${structureId} (snapshot running in background)`
		)
	}

	/**
	 * Stop automatic hourly snapshots for a location
	 * Validates that the locationId matches the configured location before stopping
	 *
	 * @param locationId - Location ID (region or structure) to stop monitoring
	 */
	async stopHourlySnapshots(locationId: string): Promise<void> {
		logger.log(`[stopHourlySnapshots] Stopping snapshots for location ${locationId}`)

		// Verify we're stopping the correct location
		const config = this.getConfig()
		logger.log(`[stopHourlySnapshots] Current config:`, config)

		if (config.locationId && config.locationId !== locationId) {
			const errorMsg = `Location mismatch: expected ${locationId}, but this DO is configured for ${config.locationId}`
			logger.error(`[stopHourlySnapshots] ${errorMsg}`)
			throw new Error(errorMsg)
		}

		// Delete alarm
		await this.state.storage.deleteAlarm()

		// Update configuration in SQLite storage
		this.state.storage.sql.exec(`UPDATE config SET alarm_enabled = 0 WHERE id = 1`)

		logger.log(`[stopHourlySnapshots] Hourly snapshots stopped for location ${locationId}`)
	}

	/**
	 * Get alarm status and configuration
	 */
	async getAlarmStatus(): Promise<{
		isActive: boolean
		locationId: string | null
		locationType: 'region' | 'structure' | null
		characterId: string | null
		nextAlarmTime: number | null
	}> {
		logger.log(`[getAlarmStatus] Checking alarm status`)
		const config = this.getConfig()
		logger.log(`[getAlarmStatus] Config:`, config)
		const nextAlarmTime = await this.state.storage.getAlarm()
		logger.log(`[getAlarmStatus] Next alarm time:`, nextAlarmTime)

		const status = {
			isActive: config.alarmEnabled && nextAlarmTime !== null,
			locationId: config.locationId,
			locationType: config.locationType,
			characterId: config.characterId,
			nextAlarmTime,
		}
		logger.log(`[getAlarmStatus] Returning status:`, status)

		return status
	}

	/**
	 * Get list of locations with complete snapshots
	 * Used for discovering active monitors across all Durable Object instances
	 * @returns Array of location IDs and types that have had successful snapshots
	 */
	async getActiveMonitors(): Promise<
		Array<{
			locationId: string
			locationType: 'region' | 'structure'
		}>
	> {
		logger.log(`[getActiveMonitors] Querying for locations with completed snapshots`)

		try {
			// Query for snapshots from the last 48 hours with status 'complete'
			const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000)

			const snapshots = await this.db
				.select()
				.from(marketSnapshots)
				.where(
					and(eq(marketSnapshots.status, 'complete'), gt(marketSnapshots.snapshotTime, twoDaysAgo))
				)
				.orderBy(desc(marketSnapshots.snapshotTime))

			logger.log(`[getActiveMonitors] Retrieved ${snapshots.length} recent complete snapshots`)

			// Deduplicate by location (locationId + locationType combination)
			const uniqueLocations = new Map<
				string,
				{
					locationId: string
					locationType: 'region' | 'structure'
				}
			>()

			for (const snapshot of snapshots) {
				const key = `${snapshot.locationType}:${snapshot.locationId}`
				if (!uniqueLocations.has(key)) {
					uniqueLocations.set(key, {
						locationId: snapshot.locationId,
						locationType: snapshot.locationType as 'region' | 'structure',
					})
				}
			}

			const locations = Array.from(uniqueLocations.values())
			logger.log(`[getActiveMonitors] Found ${locations.length} unique locations`)

			return locations
		} catch (error) {
			logger.error(`[getActiveMonitors] Database query failed:`, error)
			throw error
		}
	}

	async getMarketPricesForTypes(
		typeIds: string[],
		priceDate: string
	): Promise<
		Array<{
			typeId: string
			averagePrice: number | null
			adjustedPrice: number | null
			source: 'historic' | 'fallback'
		}>
	> {
		// DB-first: find rows stored by the hourly workflow for the exact date
		const dbRows = await this.db
			.select({
				typeId: marketDailyPrices.typeId,
				avgSellPrice: marketDailyPrices.avgSellPrice,
			})
			.from(marketDailyPrices)
			.where(
				and(
					eq(marketDailyPrices.locationId, 'universe'),
					eq(marketDailyPrices.priceDate, priceDate),
					inArray(marketDailyPrices.typeId, typeIds)
				)
			)

		const dbMap = new Map(dbRows.map((r) => [r.typeId, r]))
		const missing = typeIds.filter((id) => !dbMap.has(id))

		const result: Array<{
			typeId: string
			averagePrice: number | null
			adjustedPrice: number | null
			source: 'historic' | 'fallback'
		}> = []

		for (const [typeId, row] of dbMap) {
			result.push({
				typeId,
				averagePrice: row.avgSellPrice ? Number(row.avgSellPrice) : null,
				adjustedPrice: null,
				source: 'historic',
			})
		}

		if (missing.length > 0) {
			logger.warn(
				`[getMarketPricesForTypes] no historic data for ${missing.length} type(s) on ${priceDate}, using ESI cache`
			)
			const esiStub = getStub<Esi>(this.env.ESI, 'global')
			const all = await esiStub.fetchMarketPrices()
			const esiMap = new Map(all.map((p) => [p.typeId, p]))
			for (const typeId of missing) {
				const p = esiMap.get(typeId)
				result.push({
					typeId,
					averagePrice: p?.averagePrice ?? null,
					adjustedPrice: p?.adjustedPrice ?? null,
					source: 'fallback',
				})
			}
		}

		return result
	}

	async getInsurancePricesForTypes(
		typeIds: string[],
		priceDate: string
	): Promise<
		Array<{
			typeId: string
			platinumCost: number | null
			platinumPayout: number | null
			source: 'historic' | 'fallback'
		}>
	> {
		// DB-first: find nearest snapshot on or before priceDate for each type (single batch query)
		const dbRows = await this.db
			.select({
				typeId: insuranceDailyPrices.typeId,
				platinumCost: insuranceDailyPrices.platinumCost,
				platinumPayout: insuranceDailyPrices.platinumPayout,
			})
			.from(insuranceDailyPrices)
			.where(
				and(
					inArray(insuranceDailyPrices.typeId, typeIds),
					sql`${insuranceDailyPrices.priceDate} <= ${priceDate}`
				)
			)
			.orderBy(desc(insuranceDailyPrices.priceDate))

		// Keep only the most-recent row per typeId
		const dbMap = new Map<string, (typeof dbRows)[0]>()
		for (const row of dbRows) {
			if (!dbMap.has(row.typeId)) dbMap.set(row.typeId, row)
		}

		const missing = typeIds.filter((id) => !dbMap.has(id))

		const result: Array<{
			typeId: string
			platinumCost: number | null
			platinumPayout: number | null
			source: 'historic' | 'fallback'
		}> = []

		for (const [typeId, row] of dbMap) {
			result.push({
				typeId,
				platinumCost: row.platinumCost ? Number(row.platinumCost) : null,
				platinumPayout: row.platinumPayout ? Number(row.platinumPayout) : null,
				source: 'historic',
			})
		}

		if (missing.length > 0) {
			logger.warn(
				`[getInsurancePricesForTypes] no historic insurance data for ${missing.length} type(s) on/before ${priceDate}, using ESI cache`
			)
			const esiStub = getStub<Esi>(this.env.ESI, 'global')
			const all = await esiStub.fetchInsurancePrices()
			const esiMap = new Map(all.map((p) => [p.typeId, p]))
			for (const typeId of missing) {
				const p = esiMap.get(typeId)
				result.push({
					typeId,
					platinumCost: p?.platinumCost ?? null,
					platinumPayout: p?.platinumPayout ?? null,
					source: 'fallback',
				})
			}
		}

		return result
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		logger.log(`[DO.fetch] Received request: ${request.method} ${url.pathname}`)
		logger.log(`[DO.fetch] Query params:`, Object.fromEntries(url.searchParams))

		// Handle alarm management endpoints
		if (url.pathname === '/alarm/start' && request.method === 'POST') {
			logger.log(`[DO.fetch] Handling /alarm/start`)
			const regionId = url.searchParams.get('regionId')
			logger.log(`[DO.fetch] regionId from query:`, regionId)

			if (!regionId) {
				return Response.json({ error: 'regionId query parameter is required' }, { status: 400 })
			}

			await this.startHourlySnapshots(regionId)
			return Response.json({
				success: true,
				message: `Hourly snapshots started for region ${regionId}`,
			})
		}

		if (url.pathname === '/alarm/stop' && request.method === 'POST') {
			logger.log(`[DO.fetch] Handling /alarm/stop`)
			const regionId = url.searchParams.get('regionId')
			logger.log(`[DO.fetch] regionId from query:`, regionId)

			if (!regionId) {
				return Response.json({ error: 'regionId query parameter is required' }, { status: 400 })
			}

			await this.stopHourlySnapshots(regionId)
			return Response.json({
				success: true,
				message: `Hourly snapshots stopped for region ${regionId}`,
			})
		}

		if (url.pathname === '/alarm/status' && request.method === 'GET') {
			logger.log(`[DO.fetch] Handling /alarm/status`)
			const status = await this.getAlarmStatus()
			return Response.json(status)
		}

		logger.log(`[DO.fetch] No matching route, returning default response`)
		return new Response('Markets Durable Object', { status: 200 })
	}
}
