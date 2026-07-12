import { Hono } from 'hono'

import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { DoctrinesDO } from './durable-object'

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
		return c.text('Doctrines Durable Object Worker')
	})

export default app

// Export the Durable Object class
export { DoctrinesDO as Doctrines }
