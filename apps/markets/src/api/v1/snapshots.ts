import { Hono } from 'hono'

import { and, desc, eq, gt, sql } from '@repo/db-utils'

import { createDb } from '../../db'
import { marketSnapshots } from '../../db/schema'
import { createPaginationMeta, decodeCursor } from '../../utils/pagination'
import { formatZodErrors, SnapshotsQuerySchema, validateEntityId } from '../../utils/validation'

import type { App } from '../../context'
import { logger } from '@repo/hono-helpers'

const snapshotsRouter = new Hono<App>()

/**
 * GET /v1/locations/:locationId/snapshots
 * Get all snapshots for a specific location with filtering and pagination
 */
snapshotsRouter.get('/:locationId/snapshots', async (c) => {
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

	// Parse and validate query parameters
	let queryParams: {
		locationType?: 'region' | 'structure'
		status?: string
		limit: number
		cursor?: string
	}
	try {
		const query = c.req.query()
		queryParams = SnapshotsQuerySchema.parse(query)
	} catch (error) {
		if (error instanceof Error && 'errors' in error) {
			const zodError = error as { errors: Array<{ path: Array<string | number>; message: string }> }
			return c.json(
				{
					error: 'Query validation failed',
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
				error: 'Invalid query parameters',
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			400
		)
	}

	const { locationType, status, limit, cursor } = queryParams

	try {
		const db = createDb(c.env.DATABASE_URL)

		// Build WHERE conditions
		const conditions = [eq(marketSnapshots.locationId, locationId)]

		if (locationType) {
			conditions.push(eq(marketSnapshots.locationType, locationType))
		}

		if (status) {
			conditions.push(eq(marketSnapshots.status, status as any))
		}

		// Handle cursor pagination
		if (cursor) {
			try {
				const cursorData = decodeCursor(cursor)
				conditions.push(gt(marketSnapshots.id, cursorData.id))
			} catch (error) {
				return c.json(
					{
						error: 'Invalid pagination cursor',
						meta: {
							requestId: c.get('requestId'),
							timestamp: new Date().toISOString(),
							version: '1',
						},
					},
					400
				)
			}
		}

		// Fetch snapshots
		const snapshots = await db
			.select()
			.from(marketSnapshots)
			.where(and(...conditions))
			.orderBy(desc(marketSnapshots.snapshotTime))
			.limit(limit)

		if (snapshots.length === 0) {
			return c.json(
				{
					error: 'No snapshots found for this location',
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				404
			)
		}

		// Get total count (without cursor filter)
		const countConditions = [eq(marketSnapshots.locationId, locationId)]
		if (locationType) {
			countConditions.push(eq(marketSnapshots.locationType, locationType))
		}
		if (status) {
			countConditions.push(eq(marketSnapshots.status, status as any))
		}

		const [countResult] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(marketSnapshots)
			.where(and(...countConditions))

		const total = countResult?.count || 0

		// Format response data
		const data = snapshots.map((snapshot) => ({
			id: snapshot.id,
			locationId: snapshot.locationId,
			locationType: snapshot.locationType,
			snapshotTime: snapshot.snapshotTime.toISOString(),
			status: snapshot.status,
			orderCount: snapshot.orderCount,
			fetchDurationMs: snapshot.fetchDurationMs,
			errorMessage: snapshot.errorMessage,
			createdAt: snapshot.createdAt.toISOString(),
			updatedAt: snapshot.updatedAt.toISOString(),
		}))

		return c.json({
			data,
			pagination: createPaginationMeta(total, limit, snapshots[snapshots.length - 1] || null),
			meta: {
				requestId: c.get('requestId'),
				timestamp: new Date().toISOString(),
				version: '1',
			},
		})
	} catch (error) {
		logger.error('[snapshots] Database error:', error)
		return c.json(
			{
				error: 'Failed to fetch snapshots',
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

export { snapshotsRouter }
