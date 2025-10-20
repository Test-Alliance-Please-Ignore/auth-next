import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

// import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'

// import type { EveCharacterData } from '@repo/eve-character-data'
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

export default {
	fetch: app.fetch,
}

// Export the Durable Object class
export { EveCharacterDataDO as EveCharacterData }
