import { withLogTags } from 'workers-tagged-logger'

import { logger, resolveLogLevel, withWorkerLogLevelContext } from './logger'

export type LogLevelEnv = {
	LOG_LEVEL?: string | null
}

export async function withWorkerLogContext<T>(
	source: string,
	env: LogLevelEnv,
	callback: () => Promise<T> | T,
	tags?: Record<string, unknown>
): Promise<T> {
	return await withWorkerLogLevelContext(resolveLogLevel(env.LOG_LEVEL), async () => {
		return await withLogTags({ source, ...tags }, async () => {
			logger.setLogLevel(resolveLogLevel(env.LOG_LEVEL))
			return await callback()
		})
	})
}
