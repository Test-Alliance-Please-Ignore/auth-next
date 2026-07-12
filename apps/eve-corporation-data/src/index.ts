import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { EveCorporationDataDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { EveCorporationSyncWorkflow } from './workflows/sync-workflow'

import type { EveCorporationData } from '@repo/eve-corporation-data'
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

/**
 * Eve Corporation Data Worker RPC service
 * Exposes workflow dispatch methods for internal callers.
 */
export class EveCorporationDataWorker extends WorkerEntrypoint<Env> {
	/**
	 * Trigger corporation sync workflows in batches.
	 */
	async triggerCorporationSyncBatch(
		corporationIds: string[],
		trigger: 'cron' | 'api' = 'cron'
	): Promise<{
		total: number
		created: number
		failed: number
		workflows: Array<{
			corporationId: string
			success: boolean
			workflowId?: string
			error?: string
		}>
	}> {
		if (corporationIds.length === 0) {
			return {
				total: 0,
				created: 0,
				failed: 0,
				workflows: [],
			}
		}

		const workflowOptions = corporationIds.map((corporationId) => ({
			id: `${corporationId}-${crypto.randomUUID()}`,
			params: {
				corporationId,
				trigger,
			},
		}))

		const BATCH_SIZE = 75
		const workflows: Array<{
			corporationId: string
			success: boolean
			workflowId?: string
			error?: string
		}> = []

		for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
			const batch = workflowOptions.slice(i, i + BATCH_SIZE)
			try {
				const instances = await this.env.EVE_CORPORATION_SYNC.createBatch(batch)
				for (const [index, instance] of instances.entries()) {
					workflows.push({
						corporationId: batch[index]!.params.corporationId,
						success: true,
						workflowId: instance.id,
					})
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				for (const item of batch) {
					workflows.push({
						corporationId: item.params.corporationId,
						success: false,
						error: errorMessage,
					})
				}
			}
		}

		const created = workflows.filter((workflow) => workflow.success).length

		return {
			total: corporationIds.length,
			created,
			failed: workflows.length - created,
			workflows,
		}
	}
}

// Export the Workflow class
export { EveCorporationSyncWorkflow }
