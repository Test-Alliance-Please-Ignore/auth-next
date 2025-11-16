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

	.get('/example', async (c) => {
		// Example: Access the Durable Object using getStub()
		const id = c.req.query('id') ?? '98000001'
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, id)

		// Get configuration as an example
		const config = await stub.getConfiguration()

		return c.json({ id, config })
	})

	.post('/test/workflow/:corporationId', async (c) => {
		// Test endpoint to manually trigger a workflow for a corporation
		const corporationId = c.req.param('corporationId')

		try {
			// Create a workflow instance
			const instance = await c.env.EVE_CORPORATION_SYNC.create({
				params: {
					corporationId,
					trigger: 'api',
				},
			})

			// Get the workflow status
			const status = await instance.status()

			return c.json({
				success: true,
				corporationId,
				workflow: {
					id: instance.id,
					status: status.status,
				},
				message: 'Workflow instance created successfully',
			})
		} catch (error) {
			console.error('[Test Workflow] Failed to create workflow:', error)
			return c.json(
				{
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
	})

	.get('/test/workflow/:corporationId/status', async (c) => {
		// Test endpoint to check workflow status
		const corporationId = c.req.param('corporationId')

		try {
			// Get the workflow instance by corporation ID (used as instance ID)
			const instance = await c.env.EVE_CORPORATION_SYNC.get(corporationId)

			if (!instance) {
				return c.json(
					{
						success: false,
						message: 'No workflow found for this corporation',
					},
					404
				)
			}

			const status = await instance.status()

			return c.json({
				success: true,
				corporationId,
				workflow: {
					id: instance.id,
					status: status.status,
					output: status.output,
				},
			})
		} catch (error) {
			console.error('[Test Workflow Status] Failed to get status:', error)
			return c.json(
				{
					success: false,
					error: error instanceof Error ? error.message : String(error),
				},
				500
			)
		}
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
