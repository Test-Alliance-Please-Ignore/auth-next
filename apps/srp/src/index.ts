import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { SrpDO } from './durable-object'

import type { Srp } from '@repo/srp'
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
		return c.text('Srp Durable Object Worker')
	})

	/**
	 * Preview SRP valuation for a killmail without creating a request.
	 * Query params: characterId, killmailId, killmailHash (all required)
	 */
	.get('/preview', async (c) => {
		const characterId = c.req.query('characterId')
		const killmailId = c.req.query('killmailId')
		const killmailHash = c.req.query('killmailHash')

		if (!characterId || !killmailId || !killmailHash) {
			return c.json(
				{ error: 'characterId, killmailId, and killmailHash query parameters are required' },
				400
			)
		}

		const stub = getStub<Srp>(c.env.SRP, 'default')
		const preview = await stub.previewValuation(characterId, killmailId, killmailHash)
		return c.json(preview)
	})

export default app

// Export the Durable Object class
export { SrpDO as Srp }
