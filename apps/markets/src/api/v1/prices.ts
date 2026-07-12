import { Hono } from 'hono'

import { and, desc, eq, inArray } from '@repo/db-utils'

import { createDb } from '../../db'
import { latestMarketPrices, marketSnapshots } from '../../db/schema'
import { BatchPricesRequestSchema, formatZodErrors, validateEntityId } from '../../utils/validation'

import type { App } from '../../context'
import { logger } from '@repo/hono-helpers'

const pricesRouter = new Hono<App>()

/**
 * POST /v1/locations/:locationId/prices
 * Get price information for a batch of type IDs at a specific location
 */
pricesRouter.post('/:locationId/prices', async (c) => {
	const locationId = c.req.param('locationId')

	// Validate locationId
	const validation = validateEntityId(locationId, 'locationId')
	if (!validation.valid) {
		return c.json(
			{
				error: validation.error,
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			400
		)
	}

	// Parse and validate request body
	let requestBody: { typeIds: string[]; snapshotId?: string }
	try {
		const body = await c.req.json()
		requestBody = BatchPricesRequestSchema.parse(body)
	} catch (error) {
		if (error instanceof Error && 'errors' in error) {
			const zodError = error as { errors: Array<{ path: Array<string | number>; message: string }> }
			return c.json(
				{
					error: 'Request validation failed',
					errors: formatZodErrors(zodError as any),
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				400
			)
		}

		return c.json(
			{
				error: 'Invalid request body',
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			400
		)
	}

	const { typeIds, snapshotId } = requestBody

	try {
		const db = createDb(c.env.DATABASE_URL)

		// If snapshotId provided, use it; otherwise get latest complete snapshot
		let targetSnapshotId = snapshotId

		if (!targetSnapshotId) {
			const [latestSnapshot] = await db
				.select()
				.from(marketSnapshots)
				.where(
					and(eq(marketSnapshots.locationId, locationId), eq(marketSnapshots.status, 'complete'))
				)
				.orderBy(desc(marketSnapshots.snapshotTime))
				.limit(1)

			if (!latestSnapshot) {
				return c.json(
					{
						error: 'No complete snapshots found for this location',
						meta: {
							requestId: c.get('requestId'),
							timestamp: new Date().toISOString(),
							version: '1',
						},
					},
					404
				)
			}

			targetSnapshotId = latestSnapshot.id
		}

		// Query prices for all requested type IDs
		const prices = await db
			.select()
			.from(latestMarketPrices)
			.where(
				and(
					eq(latestMarketPrices.locationId, locationId),
					eq(latestMarketPrices.snapshotId, targetSnapshotId),
					inArray(latestMarketPrices.typeId, typeIds)
				)
			)

		// Identify missing type IDs (no market data)
		const foundTypeIds = new Set(prices.map((p) => p.typeId))
		const missingTypeIds = typeIds.filter((id) => !foundTypeIds.has(id))

		// Format response data
		const data = prices.map((price) => ({
			typeId: price.typeId,
			snapshotId: price.snapshotId,
			snapshotTime: price.snapshotTime.toISOString(),
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

		return c.json({
			data,
			missingTypeIds,
			meta: {
				locationId,
				locationType: prices[0]?.locationType || 'region',
				requestId: c.get('requestId'),
				timestamp: new Date().toISOString(),
				version: '1',
			},
		})
	} catch (error) {
		logger.error('[prices] Database error:', error)
		return c.json(
			{
				error: 'Failed to fetch price data',
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			500
		)
	}
})

export { pricesRouter }
