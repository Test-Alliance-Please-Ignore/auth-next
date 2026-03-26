import { WorkflowEntrypoint } from 'cloudflare:workers'

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

type WorkflowStepStatus = 'ok' | 'failed' | 'skipped'

interface RpcCallRecord {
	method:
		| 'CORE.syncUserDiscordAccess'
		| 'CORE.updateUserDiscordRefreshTimestamp'
		| 'CORE.logUserActivity'
	status: 'ok' | 'failed'
	durationMs: number
	error?: string
}

export interface UserDiscordRefreshWorkflowResult {
	status: 'completed' | 'failed'
	userId: string
	discordUserId: string
	workflowInstanceId: string
	steps: Record<string, WorkflowStepStatus>
	rpcCalls: RpcCallRecord[]
	success?: boolean
	totalInvited?: number
	totalUpdated?: number
	totalFailed?: number
	guildsProcessed?: number
	error?: {
		message: string
		stack?: string
	}
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
	async run(
		event: WorkflowEvent<UserDiscordRefreshPayload>,
		step: WorkflowStep
	): Promise<UserDiscordRefreshWorkflowResult> {
		const { userId, discordUserId, jitterDelaySeconds } = event.payload
		const workflowInstanceId = event.instanceId
		const steps: Record<string, WorkflowStepStatus> = {}
		const rpcCalls: RpcCallRecord[] = []

		if (!userId || !discordUserId) {
			throw new Error('Missing required payload: userId and discordUserId are required')
		}

		try {
			await step.do('init-workflow', async () => {
				return {
					userId,
					discordUserId,
					workflowInstanceId,
					startedAt: new Date().toISOString(),
				}
			})
			steps['init-workflow'] = 'ok'

			// Step 1: Apply jitter delay if specified
			if (jitterDelaySeconds && jitterDelaySeconds > 0) {
				await step.sleep('apply-jitter', `${jitterDelaySeconds} seconds`)
				steps['apply-jitter'] = 'ok'
			} else {
				steps['apply-jitter'] = 'skipped'
			}

			// Step 2: Execute Discord refresh with retry logic
			const refreshStepResult = await step.do(
				'refresh-discord-access',
				{
					retries: {
						limit: 3,
						delay: 2000, // 2 seconds initial delay
						backoff: 'exponential',
					},
				},
				async () => {
					const rpcResult = await this.env.CORE.syncUserDiscordAccess(userId)
					if (!rpcResult.ok || !rpcResult.result) {
						const message = rpcResult.error?.message || 'syncUserDiscordAccess returned no result'
						console.error('[UserDiscordRefreshWorkflow] RPC failed', {
							workflowInstanceId,
							userId,
							method: 'CORE.syncUserDiscordAccess',
							error: message,
							rpcRequestId: rpcResult.rpcRequestId,
							durationMs: rpcResult.durationMs,
						})
						throw new Error(message)
					}
					return {
						refreshResult: rpcResult.result,
						rpc: {
							method: 'CORE.syncUserDiscordAccess' as const,
							status: 'ok' as const,
							durationMs: rpcResult.durationMs,
						},
					}
				}
			)
			steps['refresh-discord-access'] = 'ok'
			rpcCalls.push(refreshStepResult.rpc)
			const refreshResult = refreshStepResult.refreshResult

			// Step 3: Handle refresh result
			const success = refreshResult.totalFailed === 0

			const timestampStepResult = await step.do('update-refresh-timestamp', async () => {
				const rpcResult = await this.env.CORE.updateUserDiscordRefreshTimestamp(userId)
				if (!rpcResult.ok) {
					throw new Error(
						rpcResult.error?.message || 'updateUserDiscordRefreshTimestamp returned failure'
					)
				}
				return {
					method: 'CORE.updateUserDiscordRefreshTimestamp' as const,
					status: 'ok' as const,
					durationMs: rpcResult.durationMs,
				}
			})
			steps['update-refresh-timestamp'] = 'ok'
			rpcCalls.push(timestampStepResult)

			const activityLogStepResult = await step.do('log-refresh-activity', async () => {
				const rpcResult = await this.env.CORE.logUserActivity(userId, 'discord.refresh', {
					success,
					totalInvited: refreshResult.totalInvited,
					totalUpdated: refreshResult.totalUpdated,
					totalFailed: refreshResult.totalFailed,
					workflowInstanceId,
					results: refreshResult.results.map((r) => ({
						...r,
					})),
				})
				if (!rpcResult.ok) {
					throw new Error(rpcResult.error?.message || 'logUserActivity returned failure')
				}
				return {
					method: 'CORE.logUserActivity' as const,
					status: 'ok' as const,
					durationMs: rpcResult.durationMs,
				}
			})
			steps['log-refresh-activity'] = 'ok'
			rpcCalls.push(activityLogStepResult)

			// Return workflow result
			return {
				status: 'completed',
				userId,
				discordUserId,
				workflowInstanceId,
				steps,
				rpcCalls,
				success,
				totalInvited: refreshResult.totalInvited,
				totalUpdated: refreshResult.totalUpdated,
				totalFailed: refreshResult.totalFailed,
				guildsProcessed: refreshResult.results.length,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			steps['workflow'] = 'failed'
			console.error('[UserDiscordRefreshWorkflow] Workflow failed', {
				workflowInstanceId,
				userId,
				discordUserId,
				steps,
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			})
			return {
				status: 'failed',
				userId,
				discordUserId,
				workflowInstanceId,
				steps,
				rpcCalls,
				error: {
					message: errorMessage,
					stack: error instanceof Error ? error.stack : undefined,
				},
			}
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
