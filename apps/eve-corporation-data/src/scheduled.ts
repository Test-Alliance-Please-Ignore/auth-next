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
 * Uses corporationId as the workflow instance ID for idempotency.
 * If a workflow is already running for this corporation, it will be skipped gracefully.
 *
 * @returns Object indicating whether workflow was created or already running
 */
async function createWorkflowInstance(
	env: Env,
	corporationId: string,
	corporationName: string
): Promise<{ created: boolean; instanceId: string }> {
	try {
		logger.info('[BackgroundRefresh] Creating workflow instance', {
			corporationId,
			corporationName,
		})

		// Use corporationId as instance ID for idempotency
		// This ensures only one workflow runs per corporation at a time
		const instance = await env.EVE_CORPORATION_SYNC.create({
			id: corporationId,
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
		// Check if workflow is already running
		if (error instanceof Error && error.message.includes('already exists')) {
			logger.info('[BackgroundRefresh] Workflow already running, skipping', {
				corporationId,
				corporationName,
			})

			return {
				created: false,
				instanceId: corporationId,
			}
		}

		// Re-throw other errors
		logger.error('[BackgroundRefresh] Failed to create workflow instance', {
			corporationId,
			corporationName,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
