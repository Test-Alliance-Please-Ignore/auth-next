import { logger } from '@repo/hono-helpers'

type BackgroundTaskMetadata = Record<string, unknown>

type BackgroundTaskOptions = {
	warnAfterMs?: number
	verbose?: boolean
}

export type BackgroundTaskExecutionContext = Pick<ExecutionContext, 'waitUntil'>

const DEFAULT_WARN_AFTER_MS = 5_000

export function waitUntilWithTelemetry(
	executionCtx: BackgroundTaskExecutionContext,
	label: string,
	task: () => Promise<unknown>,
	metadata: BackgroundTaskMetadata = {},
	options: BackgroundTaskOptions = {}
): void {
	const startedAt = Date.now()
	const warnAfterMs = options.warnAfterMs ?? DEFAULT_WARN_AFTER_MS
	const verbose = options.verbose ?? false
	let settled = false

	if (verbose) {
		logger.debug('[BackgroundTask] queued', {
			label,
			warnAfterMs,
			...metadata,
		})
	}

	const warningTimer = setTimeout(() => {
		if (settled) {
			return
		}

		logger.warn('[BackgroundTask] still running', {
			label,
			elapsedMs: Date.now() - startedAt,
			warnAfterMs,
			...metadata,
		})
	}, warnAfterMs)

	executionCtx.waitUntil(
		(async () => {
			if (verbose) {
				logger.debug('[BackgroundTask] started', {
					label,
					...metadata,
				})
			}

			try {
				await task()
				settled = true
				if (verbose) {
					logger.debug('[BackgroundTask] completed', {
						label,
						durationMs: Date.now() - startedAt,
						...metadata,
					})
				}
			} catch (error) {
				settled = true
				logger.error('[BackgroundTask] failed', {
					label,
					durationMs: Date.now() - startedAt,
					error: error instanceof Error ? error.message : String(error),
					...metadata,
				})
				throw error
			} finally {
				clearTimeout(warningTimer)
			}
		})()
	)
}
