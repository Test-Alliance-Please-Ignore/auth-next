import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import { FleetsDO } from './durable-object'
import { FleetMonitorDO } from './fleet-monitor'
import { scheduledHandler } from './scheduled'

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
