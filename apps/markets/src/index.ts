import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import {
	checkTradeHubStatus,
	setupTradeHubs,
	stopAllTradeHubs,
	TRADE_HUBS,
} from '../scripts/setup-trade-hubs'
import { v1Router } from './api/v1'
import { MarketsDO } from './durable-object'

import type { Markets } from '@repo/markets'
import type { App } from './context'

/**
 * Validate that an entity ID is a valid numeric string
 */
function validateEntityId(id: string, paramName: string): { valid: boolean; error?: string } {
	if (!id || id.trim() === '') {
		return { valid: false, error: `${paramName} is required` }
	}

	if (!/^\d+$/.test(id)) {
		return { valid: false, error: `${paramName} must be a numeric ID` }
	}

	return { valid: true }
}

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		console.log('[/] Root endpoint accessed')
		return c.text('Markets Durable Object Worker')
	})

	// Mount v1 API router at /v1/markets for pleaseignore.app/v1/markets/* routing
	.route('/v1/markets', v1Router)

	/**
	 * Health check endpoint - verifies database connectivity
	 */
	.get('/health', async (c) => {
		console.log('[/health] Health check requested')
		try {
			// Verify environment bindings are available
			if (!c.env.DATABASE_URL) {
				console.error('[/health] DATABASE_URL not configured')
				return c.json(
					{
						status: 'unhealthy',
						error: 'Database not configured',
						timestamp: new Date().toISOString(),
					},
					503
				)
			}

			if (!c.env.MARKETS) {
				console.error('[/health] MARKETS Durable Object binding not found')
				return c.json(
					{
						status: 'unhealthy',
						error: 'Durable Object binding not configured',
						timestamp: new Date().toISOString(),
					},
					503
				)
			}

			console.log('[/health] All checks passed')
			return c.json({
				status: 'healthy',
				timestamp: new Date().toISOString(),
				bindings: {
					database: 'configured',
					durableObject: 'configured',
				},
			})
		} catch (error) {
			console.error('[/health] Health check failed:', error)
			return c.json(
				{
					status: 'unhealthy',
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: new Date().toISOString(),
				},
				503
			)
		}
	})

	/**
	 * Setup all major trade hub regions for hourly snapshots
	 * Initiates monitoring for all configured trade hubs
	 * @returns Success status with setup results for each region
	 */
	.post('/setup', async (c) => {
		console.log('[/setup] Starting trade hub setup')
		try {
			const results = await setupTradeHubs(c.env)
			console.log('[/setup] Setup completed successfully:', results)
			return c.json({
				success: true,
				message: 'Trade hub monitoring setup initiated',
				results,
			})
		} catch (error) {
			console.error('[/setup] Setup failed:', error)
			throw error
		}
	})

	/**
	 * Check status of all trade hub alarms
	 * Returns monitoring status for all configured trade hubs
	 * @returns Array of status objects for each trade hub
	 */
	.get('/status', async (c) => {
		console.log('[/status] Checking all trade hub statuses')
		const statuses = []

		for (const hub of TRADE_HUBS) {
			using stub = getStub<Markets>(c.env.MARKETS, `region-${hub.regionId}`)
			const status = await stub.getAlarmStatus()

			statuses.push({
				regionId: hub.regionId,
				name: hub.name,
				primaryHub: hub.primaryHub,
				isActive: status.isActive,
				nextAlarmTime: status.nextAlarmTime,
			})
		}

		console.log(`[/status] Retrieved status for ${statuses.length} trade hubs`)
		return c.json(statuses)
	})

	/**
	 * Stop all trade hub alarms
	 * Stops monitoring for all configured trade hubs
	 * @returns Success confirmation
	 */
	.post('/stop', async (c) => {
		console.log('[/stop] Stopping all trade hub alarms')
		await stopAllTradeHubs(c.env)
		console.log('[/stop] All trade hub alarms stopped')
		return c.json({
			success: true,
			message: 'All trade hub alarms stopped',
		})
	})

	/**
	 * List all actively monitored regions and structures
	 * Discovers monitors by querying database for locations with recent snapshots
	 * @returns Comprehensive status of all active monitors grouped by type
	 */
	.get('/monitors', async (c) => {
		console.log('[/monitors] Fetching all active monitors')

		try {
			// Create a temporary DO stub to query the database
			// Any stub will work since they all share the same Neon database
			using tempStub = getStub<Markets>(c.env.MARKETS, 'registry')

			// Get list of locations with recent snapshots
			const locations = await tempStub.getActiveMonitors()

			console.log(`[/monitors] Found ${locations.length} locations with recent activity`)

			// Fetch status for each location
			const regionStatuses = []
			const structureStatuses = []

			for (const location of locations) {
				try {
					const stubId =
						location.locationType === 'region'
							? `region-${location.locationId}`
							: `structure-${location.locationId}`

					using stub = getStub<Markets>(c.env.MARKETS, stubId)
					const status = await stub.getAlarmStatus()

					const statusInfo = {
						locationId: location.locationId,
						locationType: location.locationType,
						isActive: status.isActive,
						nextAlarmTime: status.nextAlarmTime,
						characterId: status.characterId,
					}

					if (location.locationType === 'region') {
						regionStatuses.push(statusInfo)
					} else {
						structureStatuses.push(statusInfo)
					}
				} catch (error) {
					console.error(
						`[/monitors] Failed to get status for ${location.locationType} ${location.locationId}:`,
						error
					)
					// Continue processing other locations even if one fails
				}
			}

			console.log(
				`[/monitors] Successfully retrieved status - Regions: ${regionStatuses.length}, Structures: ${structureStatuses.length}`
			)

			return c.json({
				regions: regionStatuses,
				structures: structureStatuses,
				summary: {
					totalRegions: regionStatuses.length,
					activeRegions: regionStatuses.filter((r) => r.isActive).length,
					totalStructures: structureStatuses.length,
					activeStructures: structureStatuses.filter((s) => s.isActive).length,
				},
				timestamp: new Date().toISOString(),
			})
		} catch (error) {
			console.error('[/monitors] Failed to fetch monitors:', error)
			return c.json(
				{
					error: 'Failed to fetch monitors',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	/**
	 * Start hourly snapshots for a region
	 * Initiates automatic hourly market data snapshots for the specified region
	 * @param regionId - EVE Online region ID (route parameter)
	 * @returns Success confirmation with message
	 * @throws 400 if regionId is invalid
	 */
	.post('/region/:regionId/alarm/start', async (c) => {
		const regionId = c.req.param('regionId')

		// Validate regionId
		const validation = validateEntityId(regionId, 'regionId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/region/${regionId}/alarm/start] Starting region snapshots`)

		using stub = getStub<Markets>(c.env.MARKETS, `region-${regionId}`)
		await stub.startHourlySnapshots(regionId)

		return c.json({
			success: true,
			message: `Hourly snapshots started for region ${regionId}`,
		})
	})

	/**
	 * Stop hourly snapshots for a region
	 * Stops automatic hourly market data snapshots for the specified region
	 * @param regionId - EVE Online region ID (route parameter)
	 * @returns Success confirmation with message
	 * @throws 400 if regionId is invalid
	 */
	.post('/region/:regionId/alarm/stop', async (c) => {
		const regionId = c.req.param('regionId')

		// Validate regionId
		const validation = validateEntityId(regionId, 'regionId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/region/${regionId}/alarm/stop] Stopping region snapshots`)

		using stub = getStub<Markets>(c.env.MARKETS, `region-${regionId}`)
		await stub.stopHourlySnapshots(regionId)

		return c.json({
			success: true,
			message: `Hourly snapshots stopped for region ${regionId}`,
		})
	})

	/**
	 * Get alarm status for a region
	 * Returns the current monitoring status for the specified region
	 * @param regionId - EVE Online region ID (route parameter)
	 * @returns Alarm status including active state, location info, and next alarm time
	 * @throws 400 if regionId is invalid
	 */
	.get('/region/:regionId/alarm/status', async (c) => {
		const regionId = c.req.param('regionId')

		// Validate regionId
		const validation = validateEntityId(regionId, 'regionId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/region/${regionId}/alarm/status] Checking region alarm status`)

		using stub = getStub<Markets>(c.env.MARKETS, `region-${regionId}`)
		const status = await stub.getAlarmStatus()

		return c.json(status)
	})

	/**
	 * Start hourly snapshots for a structure
	 * Initiates automatic hourly market data snapshots for the specified player structure
	 * @param structureId - EVE Online structure ID (route parameter)
	 * @param characterId - Character ID for ESI authentication (query parameter)
	 * @returns Success confirmation with message
	 * @throws 400 if structureId or characterId is invalid/missing
	 */
	.post('/structure/:structureId/alarm/start', async (c) => {
		const structureId = c.req.param('structureId')
		const characterId = c.req.query('characterId')

		// Validate structureId
		const validation = validateEntityId(structureId, 'structureId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/structure/${structureId}/alarm/start] Starting structure snapshots`)

		if (!characterId) {
			return c.json({ error: 'characterId query parameter is required' }, 400)
		}

		// Validate characterId
		const charValidation = validateEntityId(characterId, 'characterId')
		if (!charValidation.valid) {
			return c.json({ error: charValidation.error }, 400)
		}

		using stub = getStub<Markets>(c.env.MARKETS, `structure-${structureId}`)
		await stub.startHourlySnapshotsForStructure(structureId, characterId)

		return c.json({
			success: true,
			message: `Hourly snapshots started for structure ${structureId}`,
		})
	})

	/**
	 * Stop hourly snapshots for a structure
	 * Stops automatic hourly market data snapshots for the specified player structure
	 * @param structureId - EVE Online structure ID (route parameter)
	 * @returns Success confirmation with message
	 * @throws 400 if structureId is invalid
	 */
	.post('/structure/:structureId/alarm/stop', async (c) => {
		const structureId = c.req.param('structureId')

		// Validate structureId
		const validation = validateEntityId(structureId, 'structureId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/structure/${structureId}/alarm/stop] Stopping structure snapshots`)

		using stub = getStub<Markets>(c.env.MARKETS, `structure-${structureId}`)
		await stub.stopHourlySnapshots(structureId)

		return c.json({
			success: true,
			message: `Hourly snapshots stopped for structure ${structureId}`,
		})
	})

	/**
	 * Get alarm status for a structure
	 * Returns the current monitoring status for the specified player structure
	 * @param structureId - EVE Online structure ID (route parameter)
	 * @returns Alarm status including active state, location info, character ID, and next alarm time
	 * @throws 400 if structureId is invalid
	 */
	.get('/structure/:structureId/alarm/status', async (c) => {
		const structureId = c.req.param('structureId')

		// Validate structureId
		const validation = validateEntityId(structureId, 'structureId')
		if (!validation.valid) {
			return c.json({ error: validation.error }, 400)
		}

		console.log(`[/structure/${structureId}/alarm/status] Checking structure alarm status`)

		using stub = getStub<Markets>(c.env.MARKETS, `structure-${structureId}`)
		const status = await stub.getAlarmStatus()

		return c.json(status)
	})

export default app

// Export the Durable Object class
export { MarketsDO as Markets }
