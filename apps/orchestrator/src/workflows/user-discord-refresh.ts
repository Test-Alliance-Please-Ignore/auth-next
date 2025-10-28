import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { DiscordRefreshService } from '../services/discord-refresh.service'

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
export class UserDiscordRefreshWorkflow extends WorkflowEntrypoint<
	Env,
	UserDiscordRefreshPayload
> {
	/**
	 * Main workflow entry point
	 */
	async run(event: WorkflowEvent<UserDiscordRefreshPayload>, step: WorkflowStep) {
		const { userId, discordUserId, jitterDelaySeconds } = event.payload

		if (!userId || !discordUserId) {
			throw new Error('Missing required payload: userId and discordUserId are required')
		}

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
				const refreshService = new DiscordRefreshService(this.env)
				return await refreshService.refreshUserDiscordAccess(userId, discordUserId)
			}
		)

		// Step 3: Handle refresh result
		await step.do('handle-result', async () => {
			// Update refresh timestamp if successful
			if (refreshResult.success) {
				await this.env.CORE.updateUserDiscordRefreshTimestamp(userId)
			}

			// Log activity
			await this.env.CORE.logUserActivity(userId, 'discord.refresh', {
				success: refreshResult.success,
				tokenRefreshed: refreshResult.tokenRefreshed,
				serversJoined: refreshResult.serversJoined,
				rolesUpdated: refreshResult.rolesUpdated,
				errors: refreshResult.errors,
				authRevoked: refreshResult.authRevoked,
			})

			return {
				logged: true,
				timestampUpdated: refreshResult.success,
			}
		})

		// Return workflow result
		return {
			userId,
			discordUserId,
			success: refreshResult.success,
			tokenRefreshed: refreshResult.tokenRefreshed,
			serversJoined: refreshResult.serversJoined,
			rolesUpdated: refreshResult.rolesUpdated,
			errorCount: refreshResult.errors.length,
			authRevoked: refreshResult.authRevoked,
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
