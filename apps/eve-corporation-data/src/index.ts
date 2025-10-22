import { getStub } from '@repo/do-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { withNotFound, withOnError } from '@repo/hono-helpers'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import type { App } from './context'
import { EveCorporationDataDO } from './durable-object'

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
		return c.text('EveCorporationData Durable Object Worker')
	})

	.get('/example', async (c) => {
		// Example: Access the Durable Object using getStub()
		const id = c.req.query('id') ?? 'corp-98000001'
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, id)

		// Get configuration as an example
		const config = await stub.getConfiguration()

		return c.json({ id, config })
	})

export default app

// Export the Durable Object class
export { EveCorporationDataDO as EveCorporationData }
