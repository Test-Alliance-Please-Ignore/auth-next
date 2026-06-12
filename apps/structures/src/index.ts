import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'
import internalRoutes from './routes/internal'
import adminStructuresRoutes from './routes/admin/structures'
import structuresRoutes from './routes/structures'

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)
	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.json({ status: 'ok', service: 'structures' })
	})
	.route('/internal', internalRoutes)
	.route('/', structuresRoutes)
	.route('/admin', adminStructuresRoutes)

export default app
