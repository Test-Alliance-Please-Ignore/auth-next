import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import { BillsDO } from './durable-object'
import { BillScheduleExecutorWorkflow } from './workflows/bill-schedule-executor'

/**
 * Bills Worker
 *
 * Provides HTTP endpoints for the bills system (if needed).
 * Primary interaction is via RPC methods on the Bills Durable Object.
 *
 * Singleton DO Pattern: Use getStub<Bills>(env.BILLS, 'default')
 */
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
		return c.text('Bills Worker - Use RPC methods via Bills DO')
	})

	.get('/health', async (c) => {
		return c.json({
			status: 'ok',
			service: 'bills',
			timestamp: new Date().toISOString(),
		})
	})

export default app

// Export the Durable Object class
export { BillsDO as Bills }

// Export the Workflow class
export { BillScheduleExecutorWorkflow }
