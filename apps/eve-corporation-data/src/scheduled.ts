import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

/**
 * Background Corporation Data Refresh Handler
 *
 * This handler runs on a scheduled cron trigger (hourly) and:
 * 1. Queries the core worker for corporations with includeInBackgroundRefresh = true
 * 2. Sends refresh messages to ALL queues for each corporation
 * 3. Updates lastSync timestamps via core worker RPC
 * 4. Handles errors gracefully
 */
export async function scheduledHandler(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
	const start = Date.now()
	logger.info('[BackgroundRefresh] Starting scheduled refresh', {
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

		// Process each corporation - refresh all data types
		const results = await Promise.allSettled(
			corporations.map((corp) => refreshCorporation(env, corp.corporationId))
		)

		// Count successes and failures
		const succeeded = results.filter((r) => r.status === 'fulfilled').length
		const failed = results.filter((r) => r.status === 'rejected').length

		// Update lastSync for successful corporations via Core RPC
		const successfulCorporations = results
			.map((result, index) => (result.status === 'fulfilled' ? corporations[index] : null))
			.filter((c) => c !== null)

		if (successfulCorporations.length > 0) {
			await Promise.allSettled(
				successfulCorporations.map((corp) => env.CORE.updateCorporationLastSync(corp.corporationId))
			)
		}

		const duration = Date.now() - start

		logger.info('[BackgroundRefresh] Scheduled refresh completed', {
			totalCorporations: corporations.length,
			succeeded,
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

			logger.error('[BackgroundRefresh] Some corporations failed to refresh', {
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
 * Send refresh messages to all queues for a specific corporation
 */
async function refreshCorporation(env: Env, corporationId: string): Promise<void> {
	const messagesToSend: Array<{ queue: Queue; message: Record<string, unknown>; type: string }> =
		[]

	// Base message with required fields
	const timestamp = Date.now()
	const baseMessage = {
		corporationId,
		timestamp,
		requesterId: 'scheduled-refresh',
	}

	// Refresh all data types
	messagesToSend.push(
		{
			queue: env['corp-public-refresh'],
			message: baseMessage,
			type: 'public',
		},
		{
			queue: env['corp-members-refresh'],
			message: baseMessage,
			type: 'members',
		},
		{
			queue: env['corp-member-tracking-refresh'],
			message: baseMessage,
			type: 'memberTracking',
		},
		{
			queue: env['corp-wallets-refresh'],
			message: baseMessage,
			type: 'wallets',
		},
		{
			queue: env['corp-wallet-journal-refresh'],
			message: baseMessage,
			type: 'walletJournal',
		},
		{
			queue: env['corp-wallet-transactions-refresh'],
			message: baseMessage,
			type: 'walletTransactions',
		},
		{
			queue: env['corp-assets-refresh'],
			message: baseMessage,
			type: 'assets',
		},
		{
			queue: env['corp-structures-refresh'],
			message: baseMessage,
			type: 'structures',
		},
		{
			queue: env['corp-orders-refresh'],
			message: baseMessage,
			type: 'orders',
		},
		{
			queue: env['corp-contracts-refresh'],
			message: baseMessage,
			type: 'contracts',
		},
		{
			queue: env['corp-industry-jobs-refresh'],
			message: baseMessage,
			type: 'industryJobs',
		},
		{
			queue: env['corp-killmails-refresh'],
			message: baseMessage,
			type: 'killmails',
		}
	)

	logger.info('[BackgroundRefresh] Sending queue messages for corporation', {
		corporationId,
		messageCount: messagesToSend.length,
		types: messagesToSend.map((m) => m.type),
	})

	// Send all messages in parallel
	const results = await Promise.allSettled(
		messagesToSend.map(({ queue, message, type }) =>
			queue
				.send(message)
				.then(() => {
					logger.debug('[BackgroundRefresh] Queue message sent', {
						corporationId,
						type,
					})
				})
				.catch((error: unknown) => {
					logger.error('[BackgroundRefresh] Failed to send queue message', {
						corporationId,
						type,
						error: error instanceof Error ? error.message : String(error),
					})
					throw error
				})
		)
	)

	// Check if any messages failed
	const failedMessages = results.filter((r) => r.status === 'rejected')
	if (failedMessages.length > 0) {
		throw new Error(
			`Failed to send ${failedMessages.length} out of ${messagesToSend.length} queue messages`
		)
	}
}
