import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { FleetsDO } from './durable-object'
import { FleetMonitorDO } from './fleet-monitor'

import type { FleetMonitor } from '@repo/fleets'
import type { App } from './context'

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
		return c.text('Fleets Durable Object Worker')
	})

	// Test page for fleet monitor
	.get('/test', async (c) => {
		const { testPageHtml } = await import('./test-page')
		return c.html(testPageHtml)
	})

	// Fleet Monitor WebSocket endpoint
	.get('/fleet-monitor/:fleetId/ws', async (c) => {
		const fleetId = c.req.param('fleetId')

		if (!fleetId || fleetId.trim() === '') {
			return c.json(
				{
					error: 'fleetId parameter is required',
				},
				400
			)
		}

			// Get the FleetMonitor DO stub for this fleet
			// DO ID format: 'fleet-${fleetId}'
			const fleetMonitorStub = getStub<FleetMonitor>(c.env.FLEET_MONITOR, `fleet-${fleetId}`)
			if (!fleetMonitorStub.fetch) {
				return c.json(
					{
						error: 'Fleet monitor endpoint unavailable',
					},
					500
				)
			}

			// Forward the request to the Durable Object for WebSocket upgrade
			// The DO will handle the WebSocket protocol from here
			return fleetMonitorStub.fetch(c.req.raw)
	})

	// Fleet Monitor status endpoint (HTTP GET)
	.get('/fleet-monitor/:fleetId/status', async (c) => {
		const fleetId = c.req.param('fleetId')

		if (!fleetId || fleetId.trim() === '') {
			return c.json(
				{
					error: 'fleetId parameter is required',
				},
				400
			)
		}

			try {
				// Get the FleetMonitor DO stub for this fleet
				const fleetMonitorStub = getStub<FleetMonitor>(c.env.FLEET_MONITOR, `fleet-${fleetId}`)
				if (!fleetMonitorStub.fetch) {
					return c.json(
						{
							error: 'Fleet monitor endpoint unavailable',
						},
						500
					)
				}

				// Forward the request to the Durable Object
				return fleetMonitorStub.fetch(c.req.raw)
		} catch (error) {
			return c.json(
				{
					error: 'Failed to get fleet status',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

// Export default worker (fetch only; manual tracking replaced the cron-based monitoring)
export default {
	fetch: app.fetch.bind(app),
}

// Export the Durable Object classes
export { FleetsDO as Fleets }
export { FleetMonitorDO as FleetMonitor }
