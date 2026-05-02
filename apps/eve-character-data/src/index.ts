import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { logger, withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'
import { EveCharacterSyncWorkflow } from './workflows/sync-workflow'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App, Env } from './context'
import type { EveCharacterSyncParams } from './workflows/sync-workflow'

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

	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	const characterIds = await tokenStoreStub.getCharactersNeedingDataSync()

	logger.info('[EveCharacterData] Characters fetched for sync batch', {
		count: characterIds.length,
	})

	if (characterIds.length === 0) {
		logger.info('[EveCharacterData] No characters need sync at this time')
		return
	}

	const workflowOptions = await buildCharacterSyncWorkflowOptions({
		characterIds,
		resolveCharacterOwner: async (characterId) => env.CORE.getCharacterOwner(characterId),
		trigger: 'cron',
	})

	const BATCH_SIZE = 75
	let created = 0
	let failed = 0

	for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
		const batch = workflowOptions.slice(i, i + BATCH_SIZE)
		try {
			await env.EVE_CHARACTER_SYNC.createBatch(batch)
			created += batch.length
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
		totalCharacters: characterIds.length,
		ownedUserWorkflows: workflowOptions.filter((workflow) => Boolean(workflow.params.userId)).length,
		unownedCharacterWorkflows: workflowOptions.filter((workflow) => !workflow.params.userId).length,
		created,
		failed,
		durationMs: Date.now() - batchStartTime,
	})
}

export async function buildCharacterSyncWorkflowOptions(params: {
	characterIds: string[]
	resolveCharacterOwner: (characterId: string) => Promise<{ userId: string; isPrimary: boolean } | null>
	trigger: EveCharacterSyncParams['trigger']
}): Promise<Array<{ id: string; params: EveCharacterSyncParams }>> {
	const perUserCharacterIds = new Map<string, string[]>()
	const unownedCharacterIds: string[] = []
	for (const characterId of params.characterIds) {
		try {
			const owner = await params.resolveCharacterOwner(characterId)
			if (!owner?.userId) {
				unownedCharacterIds.push(characterId)
				continue
			}
			const bucket = perUserCharacterIds.get(owner.userId) ?? []
			bucket.push(characterId)
			perUserCharacterIds.set(owner.userId, bucket)
		} catch (error) {
			logger.warn('[EveCharacterData] Failed to resolve character owner; falling back to standalone sync', {
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			unownedCharacterIds.push(characterId)
		}
	}

	const perUserEntries = [...perUserCharacterIds.entries()]
	const total = perUserEntries.length + unownedCharacterIds.length
	const JITTER_WINDOW_SECONDS = 7200

	return [
		...perUserEntries.map(([userId, userCharacterIds]) => ({
			id: `user-character-sync-${userId}-${crypto.randomUUID()}`,
			params: {
				userId,
				characterIds: userCharacterIds,
				trigger: params.trigger,
				jitterDelaySeconds: 0,
			},
		})),
		...unownedCharacterIds.map((characterId) => ({
			id: `character-sync-${characterId}-${crypto.randomUUID()}`,
			params: {
				characterIds: [characterId],
				characterId,
				trigger: params.trigger,
				jitterDelaySeconds: 0,
			},
		})),
	].map((workflow, index) => ({
		...workflow,
		params: {
			...workflow.params,
			jitterDelaySeconds: total > 0 ? Math.floor((index / total) * JITTER_WINDOW_SECONDS) : 0,
		},
	}))
}

export default {
	fetch: app.fetch.bind(app),
	async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
		await scheduledHandler(event, env)
	},
}

export { EveCharacterDataDO as EveCharacterData }
export { EveCharacterSyncWorkflow }
