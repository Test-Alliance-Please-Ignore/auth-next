import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

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

async function createCorporationRefreshWorkflow(env: Env, corporationId: string): Promise<void> {
	// Generate unique workflow ID with UUID to allow multiple concurrent workflows
	const workflowId = `${corporationId}-${crypto.randomUUID()}`

	logger.info('[Orchestrator] Creating corporation sync workflow', {
		corporationId,
		workflowId,
	})

	try {
		await env.EVE_CORPORATION_SYNC.create({
			id: workflowId,
			params: {
				corporationId,
				trigger: 'cron',
			},
		})

		logger.info('[Orchestrator] Corporation sync workflow created', {
			corporationId,
			workflowId,
		})
	} catch (error) {
		logger.error('[Orchestrator] Failed to create corporation sync workflow', {
			corporationId,
			workflowId,
			errorMessage: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}

export async function scheduleCorpDataRefresh(event: ScheduledEvent, env: Env): Promise<void> {
	const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'global')

	logger.info('[Orchestrator] Starting corporation data refresh batch', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	const corporationIds = await corpStub.getCorporationsNeedingRefresh()

	logger.info('[Orchestrator] Found corporations needing refresh', {
		count: corporationIds.length,
		corporationIds,
	})

	// Create one workflow per corporation (handles all data types)
	// Add jitter to spread out workflow creations and avoid thundering herd
	for (const corporationId of corporationIds) {
		logger.info('[Orchestrator] Creating corporation sync workflow for all data types', {
			corporationId,
		})

		try {
			await createCorporationRefreshWorkflow(env, corporationId)
		} catch (error) {
			// Log error but continue with other corporations
			logger.error('[Orchestrator] Failed to create workflow for corporation', {
				corporationId,
				errorMessage: error instanceof Error ? error.message : String(error),
			})
		}

		// Add jitter delay (200-500ms) between workflow creations to avoid throttling
		const jitterMs = 200 + Math.floor(Math.random() * 300)
		await new Promise((resolve) => setTimeout(resolve, jitterMs))
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
