import { Hono } from 'hono'

import { logger, withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { EveCharacterDataDO } from './durable-object'
import { buildUserSyncWorkflowOptions } from './workflows/build-user-sync-workflow-options'
import { EveCharacterSyncWorkflow } from './workflows/sync-workflow'

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

async function scheduledHandler(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()
	const PAGE_SIZE = 100
	const BATCH_SIZE = 75
	const JITTER_WINDOW_SECONDS = 3600

	logger.info('[EveCharacterData] Starting character data sync batch', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	let totalUsers = 0
	let totalCharacters = 0
	let created = 0
	let failed = 0
	let processedUsers = 0

	try {
		logger.info('[EveCharacterData] Fetching first page of users needing character data sync', {
			pageSize: PAGE_SIZE,
		})
		const firstPage = await env.CORE.listUsersWithActiveCharactersPage({ limit: PAGE_SIZE, offset: 0 })
		totalUsers = firstPage.totalCount

		if (totalUsers === 0 || firstPage.users.length === 0) {
			logger.info('[EveCharacterData] No users need sync at this time', {
				scheduledTime: new Date(event.scheduledTime).toISOString(),
				cron: event.cron,
			})
			return
		}

		let offset = 0
		let pageIndex = 0
		let page = firstPage

		while (offset < totalUsers && page.users.length > 0) {
			const pageWorkflowOptions = await buildUserSyncWorkflowOptions({
				userBatches: page.users,
				trigger: 'cron',
				totalCount: totalUsers,
				startIndex: processedUsers,
				jitterWindowSeconds: JITTER_WINDOW_SECONDS,
			})

			logger.info('[EveCharacterData] Built character sync workflow page', {
				pageIndex,
				pageUserCount: page.users.length,
				pageCharacterCount: page.users.reduce((total, batch) => total + batch.characterIds.length, 0),
				pageWorkflowCount: pageWorkflowOptions.length,
				totalUsers,
				firstUserId: page.users[0]?.userId ?? null,
				lastUserId: page.users[page.users.length - 1]?.userId ?? null,
				firstJitterDelaySeconds: pageWorkflowOptions[0]?.params.jitterDelaySeconds ?? null,
				lastJitterDelaySeconds:
					pageWorkflowOptions[pageWorkflowOptions.length - 1]?.params.jitterDelaySeconds ?? null,
			})

			for (let i = 0; i < pageWorkflowOptions.length; i += BATCH_SIZE) {
				const batch = pageWorkflowOptions.slice(i, i + BATCH_SIZE)
				try {
					logger.info('[EveCharacterData] Dispatching character sync workflow batch', {
						pageIndex,
						batchIndex: i / BATCH_SIZE,
						batchSize: batch.length,
						firstWorkflowId: batch[0]?.id ?? null,
						lastWorkflowId: batch[batch.length - 1]?.id ?? null,
					})
					const instances = await env.EVE_CHARACTER_SYNC.createBatch(batch)
					created += batch.length
					logger.info('[EveCharacterData] Dispatched character sync workflow batch', {
						pageIndex,
						batchIndex: i / BATCH_SIZE,
						batchSize: batch.length,
						createdInstances: instances.length,
						firstInstanceId: instances[0]?.id ?? null,
						lastInstanceId: instances[instances.length - 1]?.id ?? null,
					})
				} catch (error) {
					failed += batch.length
					logger.error('[EveCharacterData] Failed to dispatch workflow batch', {
						pageIndex,
						batchIndex: i / BATCH_SIZE,
						batchSize: batch.length,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			processedUsers += page.users.length
			totalCharacters += page.users.reduce((total, batch) => total + batch.characterIds.length, 0)
			offset += page.users.length
			pageIndex += 1
			if (offset >= totalUsers) {
				break
			}

			logger.info('[EveCharacterData] Fetching next page of users needing character data sync', {
				pageIndex,
				offset,
				pageSize: PAGE_SIZE,
			})
			page = await env.CORE.listUsersWithActiveCharactersPage({ limit: PAGE_SIZE, offset })
		}
	} catch (error) {
		logger.error('[EveCharacterData] Failed to page users needing character data sync', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			totalUsers,
			processedUsers,
		})
		throw error
	}

	logger.info('[EveCharacterData] Character data sync batch complete', {
		totalWorkflowInstances: created + failed,
		totalUsers,
		totalCharacters,
		ownedUserWorkflows: totalUsers,
		unownedCharacterWorkflows: 0,
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
