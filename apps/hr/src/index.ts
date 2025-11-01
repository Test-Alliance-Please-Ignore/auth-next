import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import { HrDO } from './durable-object'

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
		return c.json({
			service: 'hr',
			status: 'ok',
			message: 'HR Durable Object Worker - Access via RPC from core worker',
		})
	})

export default app

// Export the Durable Object class
export { HrDO as Hr }
