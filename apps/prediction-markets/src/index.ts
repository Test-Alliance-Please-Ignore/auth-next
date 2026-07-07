import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { PredictionMarketsDO } from './durable-object'

import type { App } from './context'

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
		return c.text('Prediction Markets Durable Object Worker')
	})

// Export the Hono app wrapped with Sentry for automatic error tracking
export default withSentry(app)

// Export the Durable Object class
export { PredictionMarketsDO as PredictionMarkets }
