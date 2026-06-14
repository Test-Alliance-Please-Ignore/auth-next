import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { logger, withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'
import { buildCharacterSyncWorkflowOptions } from './workflows/build-character-sync-workflow-options'
import { EveCharacterSyncWorkflow } from './workflows/sync-workflow'

import type { App, Env } from './context'

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

async function scheduledHandler(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()

	logger.info('[EveCharacterData] Starting character data sync batch', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	let userBatches: Array<{ userId: string; characterIds: string[] }> = []
	let unownedCharacterIds: string[] = []
	try {
		logger.info('[EveCharacterData] Fetching users needing character data sync', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})
		;({ userBatches, unownedCharacterIds } =
			await env.CORE.getUsersNeedingCharacterDataSync())
		logger.info('[EveCharacterData] Users fetched for sync batch', {
			count: userBatches.length,
			unownedCount: unownedCharacterIds.length,
			totalCharacterCount:
				userBatches.reduce((total, batch) => total + batch.characterIds.length, 0) +
				unownedCharacterIds.length,
		})
	} catch (error) {
		logger.error('[EveCharacterData] Failed to fetch users needing character data sync', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}

	if (userBatches.length === 0 && unownedCharacterIds.length === 0) {
		logger.info('[EveCharacterData] No users need sync at this time', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})
		return
	}

	let workflowOptions: Array<{ id: string; params: { userId?: string; characterIds?: string[]; characterId?: string; trigger: 'cron' | 'api'; jitterDelaySeconds?: number } }> = []
	try {
		logger.info('[EveCharacterData] Building character sync workflow options', {
			userBatchCount: userBatches.length,
			unownedCount: unownedCharacterIds.length,
		})
		workflowOptions = await buildCharacterSyncWorkflowOptions({
			characterIds: [
				...userBatches.flatMap((batch) => batch.characterIds),
				...unownedCharacterIds,
			],
			resolveCharacterOwner: async (characterId) => env.CORE.getCharacterOwner(characterId),
			resolveUserCharacterIds: async (userId) => env.CORE.getUserCharacterIds(userId),
			trigger: 'cron',
		})
		logger.info('[EveCharacterData] Built character sync workflow options', {
			workflowCount: workflowOptions.length,
			ownedUserWorkflows: workflowOptions.filter((workflow) => Boolean(workflow.params.userId)).length,
			unownedCharacterWorkflows: workflowOptions.filter((workflow) => !workflow.params.userId).length,
		})
	} catch (error) {
		logger.error('[EveCharacterData] Failed to build character sync workflow options', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			userBatchCount: userBatches.length,
			unownedCount: unownedCharacterIds.length,
		})
		throw error
	}

	if (workflowOptions.length === 0) {
		logger.warn('[EveCharacterData] No workflow options were produced from due characters', {
			userBatchCount: userBatches.length,
			unownedCount: unownedCharacterIds.length,
		})
		return
	}

	const BATCH_SIZE = 75
	let created = 0
	let failed = 0

	for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
		const batch = workflowOptions.slice(i, i + BATCH_SIZE)
		try {
			logger.info('[EveCharacterData] Dispatching character sync workflow batch', {
				batchIndex: i / BATCH_SIZE,
				batchSize: batch.length,
				firstWorkflowId: batch[0]?.id ?? null,
				lastWorkflowId: batch[batch.length - 1]?.id ?? null,
			})
			const instances = await env.EVE_CHARACTER_SYNC.createBatch(batch)
			created += batch.length
			logger.info('[EveCharacterData] Dispatched character sync workflow batch', {
				batchIndex: i / BATCH_SIZE,
				batchSize: batch.length,
				createdInstances: instances.length,
				firstInstanceId: instances[0]?.id ?? null,
				lastInstanceId: instances[instances.length - 1]?.id ?? null,
			})
		} catch (error) {
			failed += batch.length
			logger.error('[EveCharacterData] Failed to dispatch workflow batch', {
				batchIndex: i / BATCH_SIZE,
				batchSize: batch.length,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	logger.info('[EveCharacterData] Character data sync batch complete', {
		totalWorkflowInstances: workflowOptions.length,
		totalUsers: userBatches.length,
		totalCharacters:
			userBatches.reduce((total, batch) => total + batch.characterIds.length, 0) +
			unownedCharacterIds.length,
		ownedUserWorkflows: userBatches.length,
		unownedCharacterWorkflows: unownedCharacterIds.length,
		created,
		failed,
		durationMs: Date.now() - batchStartTime,
	})
}

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env)
	},
}

export { EveCharacterDataDO as EveCharacterData }
export { EveCharacterSyncWorkflow }
