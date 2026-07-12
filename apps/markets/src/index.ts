import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { v1Router } from './api/v1'
import { MarketsDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { DailyPriceBatchWorkflow } from './workflows/daily-price-batch.workflow'

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
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
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

		const stub = getStub<Markets>(c.env.MARKETS, `region-${regionId}`)
		const status = await stub.getAlarmStatus()

		return c.json(status)
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

		const stub = getStub<Markets>(c.env.MARKETS, `structure-${structureId}`)
		const status = await stub.getAlarmStatus()

		return c.json(status)
	})

export default {
	fetch: app.fetch.bind(app),
	scheduled: scheduledHandler,
}

// Export the Durable Object class and workflow class
export { MarketsDO as Markets, DailyPriceBatchWorkflow }
