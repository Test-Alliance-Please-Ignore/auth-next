import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import {
	logger,
	withNotFound,
	withOnError,
	withWorkerLogContext,
	withWorkersLogger,
} from '@repo/hono-helpers'
import { createWorkflowBatch } from '@repo/workflow-utils'

import { EveCorporationDataDO } from './durable-object'
import { scheduledHandler } from './scheduled'
import { EveCorporationSyncWorkflow } from './workflows/sync-workflow'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App, Env } from './context'

const app = new Hono<App>()
	.use('*', (c, next) =>
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
	async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
		await withWorkerLogContext('eve-corporation-data-queue', env, async () => {
			// No queue consumers anymore - this handler exists only because
			// we have the hr-member-departed producer binding which requires
			// a queue handler to be defined
			logger.warn('Received unexpected queue message', {
				queue: batch.queue,
				message: 'all queue consumers have been migrated to workflows',
			})
		})
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
	 * Read healthy director counts for a page of corporations. Corporation
	 * Durable Objects are independent, so keep the internal fan-out bounded.
	 */
	async getHealthyDirectorCounts(corporationIds: string[]): Promise<Record<string, number | null>> {
		const uniqueCorporationIds = [...new Set(corporationIds)]
		const counts: Record<string, number | null> = {}
		const BATCH_CONCURRENCY = 4

		for (let i = 0; i < uniqueCorporationIds.length; i += BATCH_CONCURRENCY) {
			const batch = uniqueCorporationIds.slice(i, i + BATCH_CONCURRENCY)
			await Promise.all(
				batch.map(async (corporationId) => {
					try {
						const stub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
						counts[corporationId] = await stub.getHealthyDirectorCount(corporationId)
					} catch (error) {
						logger.warn('[EveCorporationDataWorker] Failed to read director health count', {
							corporationId,
							error: error instanceof Error ? error.message : String(error),
						})
						counts[corporationId] = null
					}
				})
			)
		}

		return counts
	}

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
				const instances = await createWorkflowBatch(this.env.EVE_CORPORATION_SYNC, batch)
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
