import { WorkflowEntrypoint } from 'cloudflare:workers'

import * as discordService from '../services/discord.service'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'
import { logger } from '@repo/hono-helpers'

/**
 * Workflow parameters
 */
export interface UserDiscordRefreshWorkflowParams {
	userId: string
	/** Source identifier for observability (e.g. 'group-joined', 'group-left', 'admin-manual') */
	source: string
	/** Whether Discord role removal is permitted. False for join/add events, true for leave/remove events. */
	allowRemoval?: boolean
	/** Whether this run should hard-strip all roles on managed guilds (managed + unmanaged). */
	hardStripAllRoles?: boolean
	/** Optional delay before executing the refresh, used to stagger batch runs (0–600 seconds). */
	jitterDelaySeconds?: number
}

type WorkflowStepStatus = 'ok' | 'failed' | 'skipped'

export interface UserDiscordRefreshWorkflowResult {
	status: 'completed' | 'failed'
	userId: string
	source: string
	workflowInstanceId: string
	steps: Record<string, WorkflowStepStatus>
	totalInvited?: number
	totalUpdated?: number
	totalFailed?: number
	error?: {
		message: string
		stack?: string
	}
}

/**
 * User Discord Refresh Workflow
 *
 * Syncs Discord access for a single user including:
 * - Server invitation (if user should be in servers they aren't)
 * - Role assignment updates based on corporation/group memberships
 *
 * Triggered by membership change events (group join/leave/remove, invitation acceptance, etc.)
 * with retries and structured observability.
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all in-memory state.
 * Services must be accessed via this.env inside each step.do() callback.
 */
export class UserDiscordRefreshWorkflow extends WorkflowEntrypoint<
	Env,
	UserDiscordRefreshWorkflowParams
> {
	async run(
		event: WorkflowEvent<UserDiscordRefreshWorkflowParams>,
		step: WorkflowStep
	): Promise<UserDiscordRefreshWorkflowResult> {
		const {
			userId,
			source,
			allowRemoval = false,
			hardStripAllRoles = false,
			jitterDelaySeconds = 0,
		} = event.payload
		const workflowInstanceId = event.instanceId
		const steps: Record<string, WorkflowStepStatus> = {}
		const logContext = { userId, source, allowRemoval, hardStripAllRoles, workflowInstanceId }

		await step.do('init-workflow', async () => ({
			userId,
			source,
			allowRemoval,
			hardStripAllRoles,
			workflowInstanceId,
			startedAt: new Date().toISOString(),
		}))
		steps['init-workflow'] = 'ok'

		if (jitterDelaySeconds > 0) {
			await step.sleep('apply-jitter', `${jitterDelaySeconds} seconds`)
			steps['apply-jitter'] = 'ok'
		}

		logger.log('[UserDiscordRefreshWorkflow] Starting', logContext)

		try {
			const refreshResult = await step.do(
				'sync-discord-access',
				{
					retries: {
						limit: 3,
						delay: '2 seconds',
						backoff: 'exponential',
					},
					timeout: '2 minutes',
				},
				async () => {
					return discordService.syncUserDiscordAccess(
						this.env,
						userId,
						allowRemoval,
						hardStripAllRoles
					)
				}
			)
			steps['sync-discord-access'] = 'ok'

			logger.log('[UserDiscordRefreshWorkflow] Discord sync completed', {
				...logContext,
				totalInvited: refreshResult.totalInvited,
				totalUpdated: refreshResult.totalUpdated,
				totalFailed: refreshResult.totalFailed,
			})

			return {
				status: 'completed',
				userId,
				source,
				workflowInstanceId,
				steps,
				totalInvited: refreshResult.totalInvited,
				totalUpdated: refreshResult.totalUpdated,
				totalFailed: refreshResult.totalFailed,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			steps['workflow'] = 'failed'
			logger.error('[UserDiscordRefreshWorkflow] Workflow failed', {
				...logContext,
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			})
			return {
				status: 'failed',
				userId,
				source,
				workflowInstanceId,
				steps,
				error: {
					message: errorMessage,
					stack: error instanceof Error ? error.stack : undefined,
				},
			}
		}
	}
}
