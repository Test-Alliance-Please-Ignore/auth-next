import { useWorkersLogger } from 'workers-tagged-logger'

import { logger, resolveLogLevel, withWorkerLogLevelContext } from '../helpers/logger'

import type { Context, MiddlewareHandler, Next } from 'hono'

type WorkersLoggerTags = Parameters<typeof useWorkersLogger>[1]

export function withWorkersLogger(
	source: string,
	tags?: WorkersLoggerTags
): MiddlewareHandler<any> {
	const baseMiddleware = useWorkersLogger(source, tags) as MiddlewareHandler<any>

	return (c, next) =>
		withWorkerLogLevelContext(resolveLogLevel(c.env.LOG_LEVEL), () =>
			baseMiddleware(c as unknown as Context<any>, async () => {
				logger.setLogLevel(resolveLogLevel(c.env.LOG_LEVEL))
				return await next()
			})
		)
}
