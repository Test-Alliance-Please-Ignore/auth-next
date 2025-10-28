import { logger } from '@repo/hono-helpers'

import type { UserDiscordRefreshPayload } from './workflows/user-discord-refresh'
import type { Env } from './context'

/**
 * Generate a random jitter delay in seconds (0-30 minutes)
 * Uses crypto.getRandomValues for cryptographically secure randomness
 *
 * @returns Random number of seconds between 0 and 1800 (30 minutes)
 */
function generateJitterSeconds(): number {
	// Generate random value between 0 and 1800 (30 minutes in seconds)
	const array = new Uint32Array(1)
	crypto.getRandomValues(array)
	// Map to range 0-1800
	return Math.floor((array[0] / 4294967295) * 1800)
}

/**
 * Scheduled handler for the orchestrator worker
 *
 * Runs every 5 minutes (cron: "* /5 * * * *")
 *
 * Flow:
 * 1. Fetches batch of users that need Discord refresh (up to 50 users)
 * 2. For each user, creates a workflow instance with random jitter delay
 * 3. Workflows execute asynchronously with delays spread across 30 minutes
 *
 * This approach ensures:
 * - Users are refreshed at least every 30 minutes
 * - Load is spread across time to prevent thundering herd
 * - System is resilient to transient failures (workflow retries)
 */
export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const batchStartTime = Date.now()

		try {
			logger.info('[Orchestrator] Starting Discord refresh batch', {
				scheduledTime: new Date(event.scheduledTime).toISOString(),
				cron: event.cron,
			})

			// Fetch users that need Discord refresh
			// Default: 50 users per batch, users with lastDiscordRefresh > 30 minutes ago
			const users = await env.CORE.getUsersForDiscordRefresh(50, 30)

			logger.info('[Orchestrator] Fetched users for refresh', {
				userCount: users.length,
			})

			if (users.length === 0) {
				logger.info('[Orchestrator] No users need refresh at this time')
				return
			}

			// Create workflow instances for each user with jitter
			const workflowPromises = users.map(async (user) => {
				const jitterSeconds = generateJitterSeconds()

				const payload: UserDiscordRefreshPayload = {
					userId: user.userId,
					discordUserId: user.discordUserId,
					jitterDelaySeconds: jitterSeconds,
				}

				try {
					// Create workflow instance
					// Workflow ID includes timestamp to ensure uniqueness
					const workflowId = `user-discord-refresh-${user.userId}-${Date.now()}`
					const instance = await env.USER_DISCORD_REFRESH.create({
						id: workflowId,
						params: payload,
					})

					logger.info('[Orchestrator] Created workflow instance', {
						userId: user.userId,
						workflowId: instance.id,
						jitterMinutes: Math.floor(jitterSeconds / 60),
					})

					return {
						userId: user.userId,
						workflowId: instance.id,
						success: true,
					}
				} catch (error) {
					logger.error('[Orchestrator] Failed to create workflow', {
						userId: user.userId,
						error,
					})

					return {
						userId: user.userId,
						workflowId: null,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					}
				}
			})

			// Wait for all workflow creations to complete
			const results = await Promise.allSettled(workflowPromises)

			// Count successes and failures
			const stats = {
				total: results.length,
				succeeded: 0,
				failed: 0,
			}

			for (const result of results) {
				if (result.status === 'fulfilled' && result.value.success) {
					stats.succeeded++
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
				error,
				durationMs: Date.now() - batchStartTime,
			})

			// Re-throw to signal failure to Cloudflare
			throw error
		}
	},
}
