import { WorkersLogger, withLogTags } from 'workers-tagged-logger'

import type { LogLevel } from 'workers-tagged-logger'

export type LogTagHints = {
	// add common tags here so that they show up as hints
	// in `logger.setTags()` and `logger.withTags()`
	url: string
}

export async function withWorkerLogLevelContext<T>(
	logLevel: LogLevel,
	callback: () => Promise<T> | T
): Promise<T> {
	return await withLogTags({ tags: { $logger: { level: logLevel } } }, async () => {
		return await callback()
	})
}

export function resolveLogLevel(
	value: string | undefined | null,
	fallback: LogLevel = 'warn'
): LogLevel {
	if (!value) {
		return fallback
	}

	const normalized = value.trim().toLowerCase()
	if (
		normalized === 'debug' ||
		normalized === 'info' ||
		normalized === 'log' ||
		normalized === 'warn' ||
		normalized === 'error'
	) {
		return normalized
	}

	return fallback
}

export const logger = new WorkersLogger<LogTagHints>({
	minimumLogLevel: 'warn',
})
