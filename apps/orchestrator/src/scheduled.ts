import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { createDb, workflowInstances, WorkflowStatus } from '@repo/orchestrator'

import type {
	CorporationConfigData,
	EveCorporationData,
	EveCorporationSyncDataType,
} from '@repo/eve-corporation-data'
import type { Discord } from '@repo/discord'
import type { Env } from './context'
import type { UserDiscordRefreshPayload } from './workflows/user-discord-refresh'

/**
 * Generate a random jitter delay in seconds (0-10 minutes)
 * Uses crypto.getRandomValues for cryptographically secure randomness
 *
 * @returns Random number of seconds between 0 and 600 (10 minutes)
 */
function generateJitterSeconds(): number {
	// Generate random value between 0 and 600 (10 minutes in seconds)
	const array = new Uint32Array(1)
	crypto.getRandomValues(array)
	// Map to range 0-600
	return Math.floor((array[0] / 4294967295) * 600)
}

export function generateWorkflowId(workflowType: string, resourceId: string): string {
	return `${workflowType}-${resourceId}-${Date.now()}`
}

async function createCorporationRefreshWorkflow(
	env: Env,
	workflowType: EveCorporationSyncDataType,
	corporationData: CorporationConfigData
): Promise<void> {
	const db = createDb(env.DATABASE_URL)
	const workflowId = generateWorkflowId(
		`eve-corporation-sync-${workflowType}`,
		corporationData.corporationId
	)
	const existingWorkflow = await db.query.workflowInstances.findFirst({
		where: eq(workflowInstances.id, workflowId),
	})

	if (existingWorkflow) {
		logger.info('[Orchestrator] Workflow instance already exists', {
			corporationId: corporationData.corporationId,
			workflowId,
		})
		return
	}

	logger.info('[Orchestrator] Queueing corporation sync workflow for starting', {
		corporationId: corporationData.corporationId,
		workflowId,
		workflowType,
	})

	await db.insert(workflowInstances).values({
		id: workflowId,
		workflowType: `eve-corporation-sync-${workflowType}`,
		resourceId: corporationData.corporationId,
		status: WorkflowStatus.Pending,
	})

	try {
		await env.EVE_CORPORATION_SYNC.create({
			id: workflowId,
			params: {
				corporationId: corporationData.corporationId,
				dataTypes: [workflowType],
				trigger: 'cron',
			},
		})

		await db
			.update(workflowInstances)
			.set({
				status: WorkflowStatus.Created,
				updatedAt: new Date(),
			})
			.where(eq(workflowInstances.id, workflowId))

		logger.info('[Orchestrator] Corporation sync workflow created', {
			corporationId: corporationData.corporationId,
			workflowId,
			workflowType,
		})
	} catch (error) {
		logger.error('[Orchestrator] Failed to queue corporation sync workflow', {
			corporationId: corporationData.corporationId,
			workflowId,
			workflowType,
			errorMessage: error instanceof Error ? error.message : String(error),
		})

		await db
			.update(workflowInstances)
			.set({
				status: WorkflowStatus.NotCreated,
				errorMessage: error instanceof Error ? error.message : String(error),
				updatedAt: new Date(),
			})
			.where(eq(workflowInstances.id, workflowId))
	}
}

export async function scheduleCorpDataRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	using corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'global')

	logger.info('[Orchestrator] Starting corporation data refresh batch', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	const corporations = await corpStub.getCorporationsNeedingRefresh()
	for (const corporation of corporations.members) {
		logger.info('[Orchestrator] Creating corporation sync workflow for members', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'members', corporation)
	}
	for (const corporation of corporations['member-tracking']) {
		logger.info('[Orchestrator] Creating corporation sync workflow for member tracking', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'member-tracking', corporation)
	}
	for (const corporation of corporations.wallets) {
		logger.info('[Orchestrator] Creating corporation sync workflow for wallets', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'wallets', corporation)
	}
	for (const corporation of corporations['wallet-journal']) {
		logger.info('[Orchestrator] Creating corporation sync workflow for wallet journal', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'wallet-journal', corporation)
	}
	for (const corporation of corporations['wallet-transactions']) {
		logger.info('[Orchestrator] Creating corporation sync workflow for wallet transactions', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'wallet-transactions', corporation)
	}
	for (const corporation of corporations.assets) {
		logger.info('[Orchestrator] Creating corporation sync workflow for assets', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'assets', corporation)
	}
	for (const corporation of corporations.structures) {
		logger.info('[Orchestrator] Creating corporation sync workflow for structures', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'structures', corporation)
	}
	for (const corporation of corporations.orders) {
		logger.info('[Orchestrator] Creating corporation sync workflow for orders', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'orders', corporation)
	}
	for (const corporation of corporations.contracts) {
		logger.info('[Orchestrator] Creating corporation sync workflow for contracts', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'contracts', corporation)
	}
	for (const corporation of corporations['industry-jobs']) {
		logger.info('[Orchestrator] Creating corporation sync workflow for industry jobs', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'industry-jobs', corporation)
	}
	for (const corporation of corporations.killmails) {
		logger.info('[Orchestrator] Creating corporation sync workflow for killmails', {
			corporationId: corporation.corporationId,
		})
		await createCorporationRefreshWorkflow(env, 'killmails', corporation)
	}
}

/**
 * Scheduled handler for the orchestrator worker
 *
 * Runs every 5 minutes (cron: "* /5 * * * *")
 *
 * Flow:
 * 1. Fetches batch of users that need Discord refresh (up to 50 users)
 * 2. For each user, creates a workflow instance with random jitter delay (0-10 minutes)
 * 3. Workflows execute asynchronously with delays spread across 10 minutes
 *
 * This approach ensures:
 * - Users are refreshed at least every 30 minutes
 * - Load is spread across time to prevent thundering herd
 * - System is resilient to transient failures (workflow retries)
 */
export async function scheduleDiscordRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()
	const db = createDb(env.DATABASE_URL)

	try {
		logger.info('[Orchestrator] Starting Discord refresh batch', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})

		// Fetch users that need Discord refresh
		// Query Discord database directly via RPC (15-minute minimum interval)
		using discordStub = getStub<Discord>(env.DISCORD, 'default')
		const discordUsers = await discordStub.getUsersNeedingRefresh(50, 15)

		logger.info('[Orchestrator] Fetched users for refresh', {
			userCount: discordUsers.length,
		})

		if (discordUsers.length === 0) {
			logger.info('[Orchestrator] No users need refresh at this time')
			return
		}

		// Create workflow instances for each user with jitter
		const workflowPromises = discordUsers.map(async (discordUser) => {
			// Map coreUserId to userId for workflow
			const userId = discordUser.coreUserId

			// Use idempotent workflow ID (no timestamp)
			const workflowId = generateWorkflowId('user-discord-refresh', userId)

			const existingWorkflow = await db.query.workflowInstances.findFirst({
				where: eq(workflowInstances.id, workflowId),
			})

			if (existingWorkflow) {
				logger.info('[Orchestrator] Workflow instance already exists', {
					userId,
					workflowId,
				})
				return {
					userId,
					workflowId: existingWorkflow.id,
					skipped: true,
					success: true,
				}
			}

			try {
				// Generate jitter for this workflow
				const jitterSeconds = generateJitterSeconds()

				const payload: UserDiscordRefreshPayload = {
					userId,
					discordUserId: discordUser.discordUserId,
					jitterDelaySeconds: jitterSeconds,
				}

				await db.insert(workflowInstances).values({
					id: workflowId,
					workflowType: 'user-discord-refresh',
					resourceId: userId,
					status: WorkflowStatus.Pending,
				})

				// Create workflow instance
				const instance = await env.USER_DISCORD_REFRESH.create({
					id: workflowId,
					params: payload,
				})

				await db
					.update(workflowInstances)
					.set({
						status: WorkflowStatus.Created,
					})
					.where(eq(workflowInstances.id, workflowId))

				logger.info('[Orchestrator] Created workflow instance', {
					userId,
					workflowId: instance.id,
					jitterMinutes: Math.floor(jitterSeconds / 60),
				})

				return {
					userId,
					workflowId: instance.id,
					skipped: false,
					success: true,
				}
			} catch (error) {
				logger.error('[Orchestrator] Failed to create workflow', {
					userId,
					workflowId,
					errorMessage: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
					errorName: error instanceof Error ? error.name : undefined,
					bindingAvailable: typeof env.USER_DISCORD_REFRESH !== 'undefined',
				})

				await db
					.update(workflowInstances)
					.set({
						status: WorkflowStatus.NotCreated,
						errorMessage: error instanceof Error ? error.message : String(error),
					})
					.where(eq(workflowInstances.id, workflowId))

				return {
					userId,
					workflowId: null,
					skipped: false,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}
			}
		})

		// Wait for all workflow creations to complete
		const results = await Promise.allSettled(workflowPromises)

		// Count created, skipped, and failed workflows
		const stats = {
			total: results.length,
			created: 0,
			skipped: 0,
			failed: 0,
		}

		for (const result of results) {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					if (result.value.skipped) {
						stats.skipped++
					} else {
						stats.created++
					}
				} else {
					stats.failed++
				}
			} else {
				stats.failed++
			}
		}

		const duration = Date.now() - batchStartTime

		logger.info('[Orchestrator] Discord refresh batch complete', {
			...stats,
			durationMs: duration,
		})
	} catch (error) {
		logger.error('[Orchestrator] Scheduled handler error', {
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			errorName: error instanceof Error ? error.name : undefined,
			durationMs: Date.now() - batchStartTime,
		})

		// Re-throw to signal failure to Cloudflare
		throw error
	}
}

export async function scheduled(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	const promises = []

	if (env.SHOULD_REFRESH_USER_DISCORD) {
		promises.push(scheduleDiscordRefresh(event, env))
	}

	if (env.SHOULD_REFRESH_CORPORATION_DATA) {
		promises.push(scheduleCorpDataRefresh(event, env))
	}

	await Promise.all(promises)
}
