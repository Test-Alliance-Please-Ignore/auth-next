import { logger } from '@repo/hono-helpers'

import {
	computeNextAttemptAtMs,
	enrichQueueEntry,
	selectPriorityDrain,
	type EnrichedQueueEntry,
	type QueueEntry,
	type RefreshBucket,
} from './workflows/utils/background-refresh-batching'
import { refreshSharedSovereigntySystems } from './workflows/utils/sovereignty-systems-cache'

import type { Env } from './context'

const BACKGROUND_REFRESH_QUEUE_KEY = 'background-refresh:workflow-create-queue:v1'
// Keep the per-run fan-out small so the workflow creator does not overwhelm
// Workers or ESI. The KV queue retains the remainder for later cron ticks.
const BACKGROUND_REFRESH_DRAIN_LIMIT = 20
const RATE_LIMIT_BACKOFF_BASE_MS = 15_000
const RATE_LIMIT_BACKOFF_MAX_MS = 10 * 60 * 1000

function isWorkflowCreationRateLimitError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error)
	return msg.includes('rate_limit.workflow_instance_creation')
}

function computeQueueBackoffMs(attempt: number): number {
	const exp = Math.min(6, Math.max(0, attempt))
	const base = Math.min(RATE_LIMIT_BACKOFF_MAX_MS, RATE_LIMIT_BACKOFF_BASE_MS * 2 ** exp)
	return Math.floor(base * (0.5 + Math.random() * 0.5))
}

async function loadQueue(cache: KVNamespace): Promise<QueueEntry[]> {
	const raw = await cache.get(BACKGROUND_REFRESH_QUEUE_KEY)
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw) as QueueEntry[]
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(entry) =>
				typeof entry?.corporationId === 'string' &&
				typeof entry?.name === 'string' &&
				typeof entry?.nextAttemptAtMs === 'number' &&
				typeof entry?.attempt === 'number'
		)
	} catch {
		return []
	}
}

async function saveQueue(cache: KVNamespace, queue: QueueEntry[]): Promise<void> {
	await cache.put(BACKGROUND_REFRESH_QUEUE_KEY, JSON.stringify(queue))
}

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
		const now = Date.now()

		logger.info('[BackgroundRefresh] Found corporations to refresh', {
			count: corporations.length,
			corporationIds: corporations.map((c) => c.corporationId),
		})

		if (corporations.length === 0) {
			logger.info('[BackgroundRefresh] No corporations to refresh, exiting')
			return
		}

		// Warm the shared sovereignty snapshot once before creating corp workflows.
		// Corp workflows read this from the global corporation-data DO instead of
		// refetching the same system map independently.
		try {
			const sovereigntySystems = await refreshSharedSovereigntySystems(env)
			logger.info('[BackgroundRefresh] Warmed shared sovereignty systems cache', {
				count: sovereigntySystems.length,
			})
		} catch (error) {
			logger.warn('[BackgroundRefresh] Failed to warm shared sovereignty systems cache', {
				error: error instanceof Error ? error.message : String(error),
			})
		}

		const corporationsById = new Map(
			corporations.map((corp) => [corp.corporationId, corp] as const)
		)
		const existingQueue = await loadQueue(env.CACHE)

		// Keep only currently configured corps, then merge in new corps not already queued.
		const queueByCorpId = new Map<string, QueueEntry>()
		for (const queued of existingQueue) {
			const configured = corporationsById.get(queued.corporationId)
			if (!configured) continue
			queueByCorpId.set(queued.corporationId, {
				...queued,
				name: configured.name,
				nextAttemptAtMs: computeNextAttemptAtMs(configured, now, queued.nextAttemptAtMs),
			})
		}
		for (const corp of corporations) {
			if (!queueByCorpId.has(corp.corporationId)) {
				queueByCorpId.set(corp.corporationId, {
					corporationId: corp.corporationId,
					name: corp.name,
					nextAttemptAtMs: computeNextAttemptAtMs(corp, now),
					attempt: 0,
				})
			}
		}

		const queue = [...queueByCorpId.values()].sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs)
		// The queue is persisted across cron ticks. Each run drains up to the
		// configured limit, then requeues anything that was not selected.
		const due = queue
			.filter((entry) => entry.nextAttemptAtMs <= now)
			.map((entry) => {
				const corporation = corporationsById.get(entry.corporationId)
				if (!corporation) return null
				return enrichQueueEntry(entry, corporation, now)
			})
			.filter((entry): entry is EnrichedQueueEntry => entry !== null)
		const deferred = queue.filter((entry) => entry.nextAttemptAtMs > now)
		const dueSelection = selectPriorityDrain(due, BACKGROUND_REFRESH_DRAIN_LIMIT)
		let draining = [...dueSelection.draining]

		if (draining.length < BACKGROUND_REFRESH_DRAIN_LIMIT && deferred.length > 0) {
			const deferredEntries = deferred
				.map((entry) => {
					const corporation = corporationsById.get(entry.corporationId)
					if (!corporation) return null
					return enrichQueueEntry(entry, corporation, now)
				})
				.filter((entry): entry is EnrichedQueueEntry => entry !== null)
			const deferredSelection = selectPriorityDrain(
				deferredEntries,
				BACKGROUND_REFRESH_DRAIN_LIMIT - draining.length
			)
			draining = [...draining, ...deferredSelection.draining]
		}

		let workflowsCreated = 0
		let alreadyRunning = 0
		let failed = 0
		const failures: Array<{ corporationId: string; name: string; error: string }> = []
		const requeued: QueueEntry[] = []

		for (const corp of draining) {
			try {
				const result = await createWorkflowInstance(env, corp.corporationId, corp.name)
				if (result.created) {
					workflowsCreated++
				} else {
					alreadyRunning++
				}
			} catch (error) {
				failed++
				const errorMessage = error instanceof Error ? error.message : String(error)
				failures.push({
					corporationId: corp.corporationId,
					name: corp.name,
					error: errorMessage,
				})
				const nextAttempt =
					now +
					(isWorkflowCreationRateLimitError(error)
						? computeQueueBackoffMs(corp.attempt + 1)
						: RATE_LIMIT_BACKOFF_BASE_MS)
				requeued.push({
					corporationId: corp.corporationId,
					name: corp.name,
					nextAttemptAtMs: nextAttempt,
					attempt: corp.attempt + 1,
				})
			}
		}

		const drainingIds = new Set(draining.map((entry) => entry.corporationId))
		const nextQueue = [
			...queue.filter((entry) => !drainingIds.has(entry.corporationId)),
			...requeued,
		].sort(
			(a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs
		)
		await saveQueue(env.CACHE, nextQueue)

		const duration = Date.now() - start

		logger.info('[BackgroundRefresh] Scheduled refresh completed', {
			totalCorporations: corporations.length,
			workflowsCreated,
			alreadyRunning,
			failed,
			drainByBucket: draining.reduce(
				(acc, entry) => {
					acc[entry.bucket] = (acc[entry.bucket] ?? 0) + 1
					return acc
				},
				{} as Record<RefreshBucket, number>
			),
			queueDepth: nextQueue.length,
			drained: draining.length,
			deferred: deferred.length,
			durationMs: duration,
		})

		// Log failed corporations for debugging
		if (failed > 0) {
			logger.error('[BackgroundRefresh] Some workflow creations failed', {
				failed,
				errors: failures,
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
