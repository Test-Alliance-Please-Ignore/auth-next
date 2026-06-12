import { WorkflowEntrypoint } from 'cloudflare:workers'

import * as mumbleService from '../services/mumble.service'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'

/**
 * Workflow parameters
 */
export interface UserMumbleRefreshWorkflowParams {
	/** Users whose Mumble groups should be re-pushed (1 for events, N for bulk changes) */
	userIds: string[]
	/** Source identifier for observability (e.g. 'group-joined', 'group-left', 'group-deleted') */
	source: string
	/** Optional delay before executing the refresh, used to stagger batch runs (0–600 seconds). */
	jitterDelaySeconds?: number
}

type WorkflowStepStatus = 'ok' | 'failed' | 'skipped'

export interface UserMumbleRefreshWorkflowResult {
	status: 'completed' | 'failed'
	userIds: string[]
	source: string
	workflowInstanceId: string
	steps: Record<string, WorkflowStepStatus>
	totalSynced?: number
	totalSkipped?: number
	error?: {
		message: string
		stack?: string
	}
}

/**
 * User Mumble Refresh Workflow
 *
 * Pushes current auth-next group memberships for the given users to the
 * murmur-control control plane (replace-all per user via :groups). Users
 * without a provisioned Mumble account are skipped inside the mumble worker.
 *
 * Triggered by membership change events (group join/leave/remove, group
 * deletion, etc.) with retries and structured observability.
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all
 * in-memory state. Services must be accessed via this.env inside each
 * step.do() callback.
 */
export class UserMumbleRefreshWorkflow extends WorkflowEntrypoint<
	Env,
	UserMumbleRefreshWorkflowParams
> {
	async run(
		event: WorkflowEvent<UserMumbleRefreshWorkflowParams>,
		step: WorkflowStep
	): Promise<UserMumbleRefreshWorkflowResult> {
		const { userIds, source, jitterDelaySeconds = 0 } = event.payload
		const workflowInstanceId = event.instanceId
		const steps: Record<string, WorkflowStepStatus> = {}
		const logContext = { userIds, source, workflowInstanceId }

		await step.do('init-workflow', async () => ({
			userIds,
			source,
			workflowInstanceId,
			startedAt: new Date().toISOString(),
		}))
		steps['init-workflow'] = 'ok'

		if (jitterDelaySeconds > 0) {
			await step.sleep('apply-jitter', `${jitterDelaySeconds} seconds`)
			steps['apply-jitter'] = 'ok'
		}

		console.log('[UserMumbleRefreshWorkflow] Starting', logContext)

		try {
			const syncResult = await step.do(
				'sync-mumble-groups',
				{
					retries: {
						limit: 3,
						delay: '2 seconds',
						backoff: 'exponential',
					},
					timeout: '1 minute',
				},
				async () => {
					return mumbleService.syncUsersMumbleGroups(this.env, userIds, source)
				}
			)
			steps['sync-mumble-groups'] = 'ok'

			console.log('[UserMumbleRefreshWorkflow] Mumble sync completed', {
				...logContext,
				totalSynced: syncResult.synced.length,
				totalSkipped: syncResult.skipped.length,
			})

			return {
				status: 'completed',
				userIds,
				source,
				workflowInstanceId,
				steps,
				totalSynced: syncResult.synced.length,
				totalSkipped: syncResult.skipped.length,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			steps['workflow'] = 'failed'
			console.error('[UserMumbleRefreshWorkflow] Workflow failed', {
				...logContext,
				error: errorMessage,
				stack: error instanceof Error ? error.stack : undefined,
			})
			return {
				status: 'failed',
				userIds,
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
