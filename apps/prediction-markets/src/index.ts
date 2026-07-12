import { Hono } from 'hono'

import { withNotFound, withOnError, withSentry, withWorkersLogger } from '@repo/hono-helpers'

import { PredictionMarketsDO } from './durable-object'

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

	.get('/', async (c) => {
		return c.text('Prediction Markets Durable Object Worker')
	})

// Export the Hono app wrapped with Sentry for automatic error tracking
export default withSentry(app)

// Export the Durable Object class
export { PredictionMarketsDO as PredictionMarkets }
