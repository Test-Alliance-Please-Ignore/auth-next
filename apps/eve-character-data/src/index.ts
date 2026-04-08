import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { logger, withNotFound, withOnError } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'
import { EveCharacterSyncWorkflow } from './workflows/sync-workflow'

import type { EveTokenStore } from '@repo/eve-token-store'
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

	const tokenStoreStub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	const characterIds = await tokenStoreStub.getCharactersNeedingDataSync()

	logger.info('[EveCharacterData] Characters fetched for sync batch', {
		count: characterIds.length,
	})

	if (characterIds.length === 0) {
		logger.info('[EveCharacterData] No characters need sync at this time')
		return
	}

	const total = characterIds.length
	const JITTER_WINDOW_SECONDS = 7200
	// Spread jitter proportionally across 2 hours to reduce request bursts and 429 retries.
	const workflowOptions = characterIds.map((characterId, index) => ({
		id: `character-sync-${characterId}-${crypto.randomUUID()}`,
		params: {
			characterId,
			trigger: 'cron' as const,
			jitterDelaySeconds: Math.floor((index / total) * JITTER_WINDOW_SECONDS),
		},
	}))

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
		total,
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
