import { WorkflowEntrypoint } from 'cloudflare:workers'

import { createWorkflowInstanceUpdater } from '@repo/orchestrator'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'

/**
 * Workflow payload for user Discord refresh
 */
export interface UserDiscordRefreshPayload {
	userId: string
	discordUserId: string
	/** Optional jitter delay in seconds (0-1800 = 0-30 minutes) */
	jitterDelaySeconds?: number
}

/**
 * User Discord Refresh Workflow
 *
 * Refreshes Discord access for a single user including:
 * - Optional jitter delay to prevent thundering herd
 * - OAuth token refresh
 * - Server membership sync
 * - Role assignment updates
 * - Audit logging
 *
 * Triggered by the orchestrator scheduled handler every 5 minutes
 */
export class UserDiscordRefreshWorkflow extends WorkflowEntrypoint<Env, UserDiscordRefreshPayload> {
	/**
	 * Main workflow entry point
	 */
	async run(event: WorkflowEvent<UserDiscordRefreshPayload>, step: WorkflowStep) {
		const { userId, discordUserId, jitterDelaySeconds } = event.payload

		if (!userId || !discordUserId) {
			throw new Error('Missing required payload: userId and discordUserId are required')
		}

		const updater = createWorkflowInstanceUpdater(event.instanceId, this.env.DATABASE_URL)
		await updater.markRunning()

		try {
			// Step 1: Apply jitter delay if specified
			if (jitterDelaySeconds && jitterDelaySeconds > 0) {
				await step.sleep('apply-jitter', `${jitterDelaySeconds} seconds`)
			}

			// Step 2: Execute Discord refresh with retry logic
			const refreshResult = await step.do(
				'refresh-discord-access',
				{
					retries: {
						limit: 3,
						delay: 2000, // 2 seconds initial delay
						backoff: 'exponential',
					},
				},
				async () => {
					return await this.env.CORE.syncUserDiscordAccess(userId)
				}
			)

			// Step 3: Handle refresh result
			await step.do('handle-result', async () => {
				const success = refreshResult.totalFailed === 0

				// Always update refresh timestamp (even if some operations failed)
				// This prevents the workflow from retrying too aggressively
				await this.env.CORE.updateUserDiscordRefreshTimestamp(userId)

				// Log activity
				await this.env.CORE.logUserActivity(userId, 'discord.refresh', {
					success,
					totalInvited: refreshResult.totalInvited,
					totalUpdated: refreshResult.totalUpdated,
					totalFailed: refreshResult.totalFailed,
					results: refreshResult.results.map((r) => ({
						...r,
					})),
				})

				return {
					logged: true,
					timestampUpdated: true,
				}
			})

			await updater.markCompleted()

			// Return workflow result
			return {
				userId,
				discordUserId,
				success: refreshResult.totalFailed === 0,
				totalInvited: refreshResult.totalInvited,
				totalUpdated: refreshResult.totalUpdated,
				totalFailed: refreshResult.totalFailed,
				guildsProcessed: refreshResult.results.length,
			}
		} catch (error) {
			await updater.markFailed(error)
			throw error
		}
	}
}

/**
 * Workflow Configuration
 *
 * Export the workflow entrypoint for Cloudflare Workers platform.
 * The workflow will be triggered by the orchestrator scheduled handler.
 */
export default UserDiscordRefreshWorkflow
