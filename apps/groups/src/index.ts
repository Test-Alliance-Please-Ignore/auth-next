import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { GroupsDO } from './durable-object'

import type { App } from './context'

const app = new Hono<App>()
	.use('*', (c, next) =>
		useWorkersLogger(c.env.NAME, {
			environment: c.env.ENVIRONMENT,
			release: c.env.SENTRY_RELEASE,
		})(c, next)
	)
	.onError(withOnError())
	.notFound(withNotFound())
	.get('/', async (c) =>
		c.json({
			status: 'ok',
			service: 'groups',
			version: c.env.SENTRY_RELEASE || 'dev',
		})
	)

// Export Hono app wrapped with Sentry for automatic error tracking
export default withSentry(app)

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { GroupsDO as Groups }
