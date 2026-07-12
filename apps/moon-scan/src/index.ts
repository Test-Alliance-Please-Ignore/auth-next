import { Hono } from 'hono'

import { withNotFound, withOnError, withSentry, withWorkersLogger } from '@repo/hono-helpers'

import { MoonScanDO as MoonScanDOClass } from './durable-object'

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
	.get('/', (c) => c.text('Moon Scan Worker'))

export default withSentry(app)

export { MoonScanDOClass as MoonScanDO }
