import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { Core } from '@repo/core'
import type { Discord } from '@repo/discord'
import type { EveCorporationData } from '@repo/eve-corporation-data'
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

export async function scheduleCorpDataRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()

	try {
		const uniqueID = env.EVE_CORPORATION_DATA_DO.newUniqueId()
		const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA_DO, uniqueID)

		logger.info('[Orchestrator] Starting corporation data refresh batch', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})

		const corporationIds = await corpStub.getCorporationsNeedingRefresh()

		logger.info('[Orchestrator] Found corporations needing refresh', {
			count: corporationIds.length,
			corporationIds,
		})

		if (corporationIds.length === 0) {
			logger.info('[Orchestrator] No corporations need refresh at this time')
			return
		}

		const rpcStartedAt = Date.now()
		const result = await env.EVE_CORPORATION_DATA.triggerCorporationSyncBatch(
			corporationIds,
			'cron'
		)
		const rpcDurationMs = Date.now() - rpcStartedAt

		const duration = Date.now() - batchStartTime

		logger.info('[Orchestrator] Corporation data refresh batch complete', {
			totalCorporations: result.total,
			workflowsCreated: result.created,
			failed: result.failed,
			rpcMethod: 'EVE_CORPORATION_DATA.triggerCorporationSyncBatch',
			rpcDurationMs,
			durationMs: duration,
		})

		if (result.failed > 0) {
			logger.error('[Orchestrator] Some corporation sync workflows failed to dispatch', {
				failed: result.failed,
				errors: result.workflows
					.filter((workflow) => !workflow.success)
					.map((workflow) => ({
						corporationId: workflow.corporationId,
						error: workflow.error ?? 'Unknown error',
					})),
			})
		}
	} catch (error) {
		const duration = Date.now() - batchStartTime
		logger.error('[Orchestrator] Unexpected error during corporation data refresh', {
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			rpcMethod: 'EVE_CORPORATION_DATA.triggerCorporationSyncBatch',
			durationMs: duration,
		})

		// Re-throw to signal failure to Cloudflare
		throw error
	}
}

/**
 * Scheduled handler for the orchestrator worker
 *
 * Runs every 5 minutes (cron: "* /5 * * * *")
 *
 * Flow:
 * 1. Fetches batch of users that need Discord refresh (up to 50 users)
 * 2. For each user, creates a workflow with random jitter delay (0-10 minutes)
 * 3. Workflows execute asynchronously with delays spread across 10 minutes
 *
 * This approach ensures:
 * - Users are refreshed at least every 30 minutes
 * - Load is spread across time to prevent thundering herd
 * - System is resilient to transient failures (workflow retries)
 */
export async function scheduleDiscordRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()

	try {
		logger.info('[Orchestrator] Starting Discord refresh batch', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})

		// Fetch users that need Discord refresh
		// Query Discord database directly via RPC (15-minute minimum interval)
		const discordStub = getStub<Discord>(env.DISCORD, 'default')
		const discordUsers = await discordStub.getUsersNeedingRefresh(50, 15)

		logger.info('[Orchestrator] Fetched users for refresh', {
			userCount: discordUsers.length,
		})

		if (discordUsers.length === 0) {
			logger.info('[Orchestrator] No users need refresh at this time')
			return
		}

		// Create workflows for each user with jitter
		const workflowPromises = discordUsers.map(async (discordUser) => {
			// Map coreUserId to userId for workflow
			const userId = discordUser.coreUserId

			// Use idempotent workflow ID (no timestamp)
			const workflowId = generateWorkflowId('user-discord-refresh', userId)

			try {
				// Generate jitter for this workflow
				const jitterSeconds = generateJitterSeconds()

				const payload: UserDiscordRefreshPayload = {
					userId,
					discordUserId: discordUser.discordUserId,
					jitterDelaySeconds: jitterSeconds,
				}

				// Create workflow
				const instance = await env.USER_DISCORD_REFRESH.create({
					id: workflowId,
					params: payload,
				})

				logger.info('[Orchestrator] Created workflow', {
					userId,
					workflowId: instance.id,
					jitterMinutes: Math.floor(jitterSeconds / 60),
				})

				return {
					userId,
					workflowId: instance.id,
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

				return {
					userId,
					workflowId: null,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}
			}
		})

		// Wait for all workflow creations to complete
		const results = await Promise.allSettled(workflowPromises)

		// Count created and failed workflows
		const stats = {
			total: results.length,
			created: 0,
			failed: 0,
		}

		for (const result of results) {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					stats.created++
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

export async function scheduleUserRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	const batchStartTime = Date.now()

	try {
		logger.info('[Orchestrator] Starting user refresh batch', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})

		const stub = getStub<Core>(env.CORE_DO, 'default')
		const userIds = await stub.listUsersNeedingRefresh(50)

		if (userIds.length === 0) {
			logger.info('[Orchestrator] No users need refresh at this time')
			return
		}

		const triggerResults = await Promise.allSettled(
			userIds.map(async (userId) =>
				env.CORE.triggerUserRefresh(userId, {
					source: 'orchestrator-scheduled-batch',
					bypassThrottle: true,
					refreshMode: 'scheduled',
				})
			)
		)

		const workflows = triggerResults.map((result, index) => {
			if (result.status === 'fulfilled') {
				return {
					userId: userIds[index],
					dispatched: result.value.status === 'triggered',
					status: result.value.status,
					triggered: result.value.triggered,
					workflowInstanceId: result.value.workflowInstanceId,
					error: result.value.error,
					errorName: undefined as string | undefined,
				}
			}

			const errorMessage =
				result.reason instanceof Error ? result.reason.message : String(result.reason)
			return {
				userId: userIds[index],
				dispatched: false,
				status: 'failed' as const,
				triggered: false,
				workflowInstanceId: undefined as string | undefined,
				error: errorMessage,
				errorName: result.reason instanceof Error ? result.reason.name : undefined,
			}
		})

		const dispatchedCount = workflows.filter((workflow) => workflow.dispatched).length
		const failedCount = workflows.length - dispatchedCount

		logger.info('[Orchestrator] User refresh batch complete', {
			total: workflows.length,
			dispatched: dispatchedCount,
			failed: failedCount,
			durationMs: Date.now() - batchStartTime,
		})

		if (failedCount > 0) {
			logger.error('[Orchestrator] Some user refresh workflows failed to dispatch', {
				total: workflows.length,
				dispatched: dispatchedCount,
				failed: failedCount,
				failures: workflows
					.filter((workflow) => !workflow.dispatched)
					.map((workflow) => ({
						userId: workflow.userId,
						status: workflow.status,
						triggered: workflow.triggered,
						error: workflow.error,
						errorName: workflow.errorName,
					})),
			})
		}
	} catch (error) {
		logger.error('[Orchestrator] Scheduled user refresh batch failed', {
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			errorName: error instanceof Error ? error.name : undefined,
			durationMs: Date.now() - batchStartTime,
		})
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

	if (env.SHOULD_REFRESH_USER_REFRESH) {
		promises.push(scheduleUserRefresh(event, env))
	}

	if (env.SHOULD_REFRESH_CORPORATION_DATA) {
		promises.push(scheduleCorpDataRefresh(event, env))
	}

	await Promise.all(promises)
}
