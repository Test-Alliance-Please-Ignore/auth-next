import { Hono } from 'hono'
import { desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { marketSnapshots } from '../../db/schema'
import { validateEntityId } from '../../utils/validation'

import type { App } from '../../context'
import type { Markets } from '@repo/markets'

const refreshRouter = new Hono<App>()

/**
 * GET /v1/locations/:locationId/refresh
 * Get next refresh time and last snapshot information for a location
 */
refreshRouter.get('/:locationId/refresh', async (c) => {
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

	try {
		const db = createDb(c.env.DATABASE_URL)

		// Get latest snapshot to determine location type
		const [latestSnapshot] = await db
			.select()
			.from(marketSnapshots)
			.where(eq(marketSnapshots.locationId, locationId))
			.orderBy(desc(marketSnapshots.snapshotTime))
			.limit(1)

		if (!latestSnapshot) {
			return c.json(
				{
					error: 'Location not found (no snapshots exist)',
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				404
			)
		}

		// Get Durable Object stub for this location
		const stubId =
			latestSnapshot.locationType === 'region' ? `region-${locationId}` : `structure-${locationId}`

		const stub = getStub<Markets>(c.env.MARKETS, stubId)

		// Get alarm status from DO
		const alarmStatus = await stub.getAlarmStatus()

		return c.json({
			data: {
				locationId,
				locationType: latestSnapshot.locationType,
				isActive: alarmStatus.isActive,
				nextRefreshTime: alarmStatus.nextAlarmTime ? new Date(alarmStatus.nextAlarmTime).toISOString() : null,
				nextRefreshTimestamp: alarmStatus.nextAlarmTime,
				lastSnapshotTime: latestSnapshot.snapshotTime.toISOString(),
				lastSnapshotStatus: latestSnapshot.status,
				lastSnapshotOrderCount: latestSnapshot.orderCount,
			},
			meta: {
				requestId: c.get('requestId'),
				timestamp: new Date().toISOString(),
				version: '1',
			},
		})
	} catch (error) {
		console.error('[refresh] Error:', error)
		return c.json(
			{
				error: 'Failed to fetch refresh information',
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

export { refreshRouter }
