import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { FleetsDO } from './durable-object'
import { FleetMonitorDO } from './fleet-monitor'
import { scheduledHandler } from './scheduled'

import type { FleetMonitor, Fleets } from '@repo/fleets'
import type { App, Env } from './context'

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

	// Monitored Fleet Commanders CRUD API
	.get('/api/monitored-fcs', async (c) => {
		try {
			const stub = getStub<Fleets>(c.env.FLEETS, 'default')
			const characterIds = await stub.listMonitoredFleetCommanders()

			return c.json({ characterIds })
		} catch (error) {
			return c.json(
				{
					success: false,
					error: 'Failed to list monitored fleet commanders',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.post('/api/monitored-fcs', async (c) => {
		try {
			const body = await c.req.json<{ characterId: string }>()

			if (
				!body.characterId ||
				typeof body.characterId !== 'string' ||
				body.characterId.trim() === ''
			) {
				return c.json(
					{
						success: false,
						message: 'characterId is required and must be a non-empty string',
					},
					400
				)
			}

			const stub = getStub<Fleets>(c.env.FLEETS, 'default')
			const added = await stub.addMonitoredFleetCommander(body.characterId)

			if (!added) {
				return c.json(
					{
						success: false,
						message: 'Fleet commander is already being monitored',
					},
					409
				)
			}

			return c.json({
				success: true,
				message: 'Fleet commander added to monitoring list',
			})
		} catch (error) {
			return c.json(
				{
					success: false,
					error: 'Failed to add monitored fleet commander',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.delete('/api/monitored-fcs/:characterId', async (c) => {
		try {
			const characterId = c.req.param('characterId')

			if (!characterId || characterId.trim() === '') {
				return c.json(
					{
						success: false,
						message: 'characterId parameter is required',
					},
					400
				)
			}

			const stub = getStub<Fleets>(c.env.FLEETS, 'default')
			const removed = await stub.removeMonitoredFleetCommander(characterId)

			if (!removed) {
				return c.json(
					{
						success: false,
						message: 'Fleet commander not found in monitoring list',
					},
					404
				)
			}

			return c.json({
				success: true,
				message: 'Fleet commander removed from monitoring list',
			})
		} catch (error) {
			return c.json(
				{
					success: false,
					error: 'Failed to remove monitored fleet commander',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
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

// Export default worker with fetch and scheduled handlers
export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

// Export the Durable Object classes
export { FleetsDO as Fleets }
export { FleetMonitorDO as FleetMonitor }
