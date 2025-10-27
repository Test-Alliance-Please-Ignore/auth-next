import { and, eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { managedCorporations } from './db/schema'

import type { Env } from './context'

/**
 * Background Corporation Data Refresh Handler
 *
 * This handler runs on a scheduled cron trigger (hourly) and:
 * 1. Queries for corporations with includeInBackgroundRefresh = true
 * 2. Sends refresh messages to ALL queues for each corporation
 * 3. Updates lastSync timestamps
 * 4. Handles errors gracefully
 */
export async function scheduledHandler(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
	const start = Date.now()
	logger.info('[BackgroundRefresh] Starting scheduled refresh', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	const db = createDb(env.DATABASE_URL)

	try {
		// Get all corporations that should be refreshed
		const corporations = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.includeInBackgroundRefresh, true),
				eq(managedCorporations.isActive, true),
				eq(managedCorporations.isVerified, true)
			),
		})

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

		// Update lastSync for successful corporations
		const successfulCorporations = results
			.map((result, index) => (result.status === 'fulfilled' ? corporations[index] : null))
			.filter((c) => c !== null)

		if (successfulCorporations.length > 0) {
			const now = new Date()
			await Promise.allSettled(
				successfulCorporations.map((corp) =>
					db
						.update(managedCorporations)
						.set({
							lastSync: now,
							updatedAt: now,
						})
						.where(eq(managedCorporations.corporationId, corp.corporationId))
				)
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

	// Refresh all data types
	messagesToSend.push(
		{
			queue: env.CORP_PUBLIC_REFRESH_QUEUE,
			message: { corporationId },
			type: 'public',
		},
		{
			queue: env.CORP_MEMBERS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'members',
		},
		{
			queue: env.CORP_MEMBER_TRACKING_REFRESH_QUEUE,
			message: { corporationId },
			type: 'memberTracking',
		},
		{
			queue: env.CORP_WALLETS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'wallets',
		},
		{
			queue: env.CORP_WALLET_JOURNAL_REFRESH_QUEUE,
			message: { corporationId },
			type: 'walletJournal',
		},
		{
			queue: env.CORP_WALLET_TRANSACTIONS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'walletTransactions',
		},
		{
			queue: env.CORP_ASSETS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'assets',
		},
		{
			queue: env.CORP_STRUCTURES_REFRESH_QUEUE,
			message: { corporationId },
			type: 'structures',
		},
		{
			queue: env.CORP_ORDERS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'orders',
		},
		{
			queue: env.CORP_CONTRACTS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'contracts',
		},
		{
			queue: env.CORP_INDUSTRY_JOBS_REFRESH_QUEUE,
			message: { corporationId },
			type: 'industryJobs',
		},
		{
			queue: env.CORP_KILLMAILS_REFRESH_QUEUE,
			message: { corporationId },
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
