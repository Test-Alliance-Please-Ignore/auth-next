import { Hono } from 'hono'

import { withNotFound, withOnError, withSentry, withWorkersLogger } from '@repo/hono-helpers'

import type { App } from './context'
import { DonationsDO } from './durable-object'

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
		return c.text('Donations Durable Object Worker')
	})

// Export Hono app wrapped with Sentry for automatic error tracking
export default withSentry(app)

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { DonationsDO as Donations }
