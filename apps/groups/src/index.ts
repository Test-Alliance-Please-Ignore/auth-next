import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

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

export default app

// Export the Durable Object class
export { GroupsDO as Groups }
