import { Hono } from 'hono'

import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { BillsDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { BillDiscordNotifyWorkflow } from './workflows/bill-discord-notify'
import { BillPaymentStatusCheckWorkflow } from './workflows/bill-payment-status-check'
import { BillScheduleExecutorWorkflow } from './workflows/bill-schedule-executor'

import type { App, Env } from './context'

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
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
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

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

// Export the Durable Object class
export { BillsDO as Bills }

// Export the Workflow classes
export { BillScheduleExecutorWorkflow }
export { BillPaymentStatusCheckWorkflow }
export { BillDiscordNotifyWorkflow }

// Export the scheduled handler
export { scheduledHandler }
