import { getStub } from '@repo/do-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { withNotFound, withOnError } from '@repo/hono-helpers'
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import type { App, Env } from './context'
import { EveCorporationDataDO } from './durable-object'
import * as queueConsumers from './queue/consumers'

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
		const id = c.req.query('id') ?? '98000001'
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, id)

		// Get configuration as an example
		const config = await stub.getConfiguration()

		return c.json({ id, config })
	})

// Map queue names to their handlers
const queueHandlers = {
	'corp-public-refresh': queueConsumers.publicRefreshQueue,
	'corp-members-refresh': queueConsumers.membersRefreshQueue,
	'corp-member-tracking-refresh': queueConsumers.memberTrackingRefreshQueue,
	'corp-wallets-refresh': queueConsumers.walletsRefreshQueue,
	'corp-wallet-journal-refresh': queueConsumers.walletJournalRefreshQueue,
	'corp-wallet-transactions-refresh': queueConsumers.walletTransactionsRefreshQueue,
	'corp-assets-refresh': queueConsumers.assetsRefreshQueue,
	'corp-structures-refresh': queueConsumers.structuresRefreshQueue,
	'corp-orders-refresh': queueConsumers.ordersRefreshQueue,
	'corp-contracts-refresh': queueConsumers.contractsRefreshQueue,
	'corp-industry-jobs-refresh': queueConsumers.industryJobsRefreshQueue,
	'corp-killmails-refresh': queueConsumers.killmailsRefreshQueue,
} as const

// Export default worker with both fetch and queue handlers
export default {
	fetch: app.fetch.bind(app),
	async queue(
		batch: MessageBatch,
		env: Env,
		ctx: ExecutionContext
	): Promise<void> {
		const queueName = batch.queue as keyof typeof queueHandlers
		const handler = queueHandlers[queueName]

		if (!handler) {
			console.error(`No handler found for queue: ${batch.queue}`)
			return
		}

		await handler(batch, env, ctx)
	},
}

// Export the Durable Object class
export { EveCorporationDataDO as EveCorporationData }
