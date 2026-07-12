import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { SrpDO } from './durable-object'
import { RecentLossRefreshCoordinatorDO } from './recent-loss-refresh-coordinator'
import { scheduledHandler } from './scheduled'
import { SrpPaymentStatusCheckWorkflow } from './workflows/srp-payment-status-check'
import { SrpRecentLossRefreshWorkflow } from './workflows/recent-loss-refresh.workflow'

import type { Srp } from '@repo/srp'
import type { App, Env } from './context'

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

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

// Export the Durable Object class
export { SrpDO as Srp }
export { RecentLossRefreshCoordinatorDO }
export { SrpPaymentStatusCheckWorkflow }
export { SrpRecentLossRefreshWorkflow }
export { scheduledHandler }
