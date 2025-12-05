import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCorporationDataDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { EveCorporationSyncWorkflow } from './workflows/sync-workflow'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App, Env } from './context'

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

// Export default worker with fetch, queue, and scheduled handlers
export default {
	fetch: app.fetch.bind(app),
	async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
		// No queue consumers anymore - this handler exists only because
		// we have the hr-member-departed producer binding which requires
		// a queue handler to be defined
		console.warn(
			`Received unexpected queue message on ${batch.queue} - all queue consumers have been migrated to workflows`
		)
	},
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

// Export the Durable Object class
export { EveCorporationDataDO as EveCorporationData }

// Export the Workflow class
export { EveCorporationSyncWorkflow }
