import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { logger, withNotFound, withOnError } from '@repo/hono-helpers'

import type { App, Env } from './context'
import { FulcrumDO } from './durable-object'
import { BulkCharacterReportWorkflow } from './workflows/bulk-character-report.workflow.js'
import { CharacterReportWorkflow } from './workflows/character-report.workflow.js'
import { handleCharacterReportsQueue } from './queue'
import type { CharacterReportQueueMessage } from './queue'
import { scheduledHandler } from './scheduled'
import testRoutes from './test-routes'

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

	// Mount test routes for local development
	.route('/test', testRoutes)

	.get('/', async (c) => {
		return c.json({
			service: 'fulcrum',
			status: 'ok',
			message: 'Fulcrum Character Report Worker - Access via RPC from core worker',
		})
	})

// Export default worker with fetch, queue, and scheduled handlers
export default {
	fetch: app.fetch.bind(app),
	async queue(
		batch: MessageBatch<CharacterReportQueueMessage>,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		if (batch.queue === 'character-reports-queue') {
			await handleCharacterReportsQueue(batch, env, ctx)
		} else {
			logger.error('No handler found for queue', { queue: batch.queue })
		}
	},
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env, ctx)
	},
}

// Export the Durable Object class
export { FulcrumDO as Fulcrum }

// Export the Workflow class
export { CharacterReportWorkflow }
export { BulkCharacterReportWorkflow }
