import { Hono } from 'hono'

import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import type { App } from './context'

/**
 * Broadcasts Worker
 *
 * This worker exports the Broadcasts Durable Object.
 * All HTTP routes are handled by the core worker, which calls the DO via RPC.
 * This minimal HTTP handler is only for health checks.
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
	.get('/', async (c) =>
		c.json({
			status: 'ok',
			service: 'broadcasts',
			version: c.env.SENTRY_RELEASE || 'dev',
		})
	)

export default app

// Export the Durable Object class
export { BroadcastsDO as Broadcasts } from './durable-object'
