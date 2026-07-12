import { Hono } from 'hono'

import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'
import { LegacyDO } from './durable-object'

import type { App } from './context'

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
	.get('/', (c) =>
		c.json({
			service: 'legacy',
			status: 'ok',
			mode: 'rpc-only',
		})
	)

export default app
export { LegacyDO as Legacy }
