import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

/**
 * Background Corporation Data Refresh Handler
 *
 * This handler runs on a scheduled cron trigger (every 15 minutes) and:
 * 1. Queries the core worker for corporations with includeInBackgroundRefresh = true
 * 2. Creates workflow instances for each corporation
 * 3. Handles "already running" workflows gracefully
 * 4. Tracks instance creation success/failure
 */
export async function scheduledHandler(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
	const start = Date.now()
	logger.info('[BackgroundRefresh] Starting scheduled refresh via workflows', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	try {
		// Get corporations that should be refreshed via Core RPC
		const corporations = await env.CORE.getCorporationsForBackgroundRefresh()

		logger.info('[BackgroundRefresh] Found corporations to refresh', {
			count: corporations.length,
			corporationIds: corporations.map((c) => c.corporationId),
		})

		if (corporations.length === 0) {
			logger.info('[BackgroundRefresh] No corporations to refresh, exiting')
			return
		}

		// Create workflow instances for each corporation
		const results = await Promise.allSettled(
			corporations.map((corp) => createWorkflowInstance(env, corp.corporationId, corp.name))
		)

		// Count successes, failures, and already running
		const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.created).length
		const alreadyRunning = results.filter(
			(r) => r.status === 'fulfilled' && !r.value.created
		).length
		const failed = results.filter((r) => r.status === 'rejected').length

		const duration = Date.now() - start

		logger.info('[BackgroundRefresh] Scheduled refresh completed', {
			totalCorporations: corporations.length,
			workflowsCreated: succeeded,
			alreadyRunning,
			failed,
			durationMs: duration,
		})

		// Log failed corporations for debugging
		if (failed > 0) {
			const failedCorporations = results
				.map((result, index) =>
					result.status === 'rejected' ? { ...corporations[index], error: result.reason } : null
				)
				.filter((c) => c !== null)

			logger.error('[BackgroundRefresh] Some workflow creations failed', {
				failed,
				errors: failedCorporations.map((c) => ({
					corporationId: c.corporationId,
					name: c.name,
					error: c.error instanceof Error ? c.error.message : String(c.error),
				})),
			})
		}
	} catch (error) {
		logger.error('[BackgroundRefresh] Unexpected error during scheduled refresh', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}
}

/**
 * Create a workflow instance for a specific corporation
 *
 * Checks if a workflow is already running for this corporation to maintain idempotency.
 * Uses timestamped IDs to avoid conflicts with completed workflows that are still retained.
 *
 * @returns Object indicating whether workflow was created or already running
 */
async function createWorkflowInstance(
	env: Env,
	corporationId: string,
	corporationName: string
): Promise<{ created: boolean; instanceId: string }> {
	try {
		// Check if a workflow is already running for this corporation
		try {
			const existingInstance = await env.EVE_CORPORATION_SYNC.get(corporationId)
			const status = await existingInstance.status()

			if (status.status === 'running' || status.status === 'queued' || status.status === 'waiting') {
				logger.info('[BackgroundRefresh] Workflow already running, skipping', {
					corporationId,
					corporationName,
					status: status.status,
				})

				return {
					created: false,
					instanceId: corporationId,
				}
			}
		} catch {
			// No existing instance, proceed to create new one
		}

		// Create new workflow instance with timestamped ID to avoid conflicts with completed workflows
		const instance = await env.EVE_CORPORATION_SYNC.create({
			id: `${corporationId}-${Date.now()}`,
			params: {
				corporationId,
				trigger: 'cron',
			},
		})

		logger.info('[BackgroundRefresh] Workflow instance created', {
			corporationId,
			corporationName,
			instanceId: instance.id,
		})

		return {
			created: true,
			instanceId: instance.id,
		}
	} catch (error) {
		logger.error('[BackgroundRefresh] Failed to create workflow instance', {
			corporationId,
			corporationName,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
