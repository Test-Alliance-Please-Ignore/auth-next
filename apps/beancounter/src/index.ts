import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger, withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { registerCoordinatorRoutes } from './coordinator/routes'
import { StructureCoordinatorDO } from './coordinator/structure-coordinator'
import { StructureMonitorDO } from './structure-monitor'

import type { StructureCoordinator } from '@repo/beancounter'
import type { App } from './context'

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
				service: 'beancounter',
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('Structure Monitor Coordinator Worker')
	})

	// WebSocket endpoint for structure coordinator
	.get('/coordinator/ws', async (c) => {
		try {
			// Get the StructureCoordinator DO stub (using 'default' as the ID)
			const coordinatorStub = getStub<StructureCoordinator>(c.env.STRUCTURE_COORDINATOR, 'default')

			// Forward the request to the Durable Object for WebSocket upgrade
			// The DO will handle the WebSocket protocol from here
			// Note: fetch is available on Durable Object stubs even though not in the RPC interface
			return (
				coordinatorStub as unknown as { fetch: (request: Request) => Promise<Response> }
			).fetch(c.req.raw)
		} catch (error) {
			logger.error('[Worker] WebSocket connection error', { error })
			return c.json(
				{
					error: 'Failed to establish WebSocket connection',
					message: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

registerCoordinatorRoutes(app)

export default {
	fetch: app.fetch.bind(app),
	async scheduled(
		event: ScheduledEvent,
		env: App['Bindings'],
		ctx: ExecutionContext
	): Promise<void> {
		await StructureCoordinatorDO.scheduled(event, env, ctx)
	},
}

// Export the Durable Object classes
export { StructureMonitorDO as StructureMonitor }
export { StructureCoordinatorDO as StructureCoordinator }
