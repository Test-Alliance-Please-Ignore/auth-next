import { next } from './dispositions'
import { errorMessage } from './util'

import type { EmailContext, EmailHandler } from './types'

/**
 * Wrap a side-effect function as a non-terminal route handler: it runs the effect,
 * swallows any error (logging it), and always returns `next` so routing continues.
 *
 * Use this for observability/persistence routes that should never influence the message's
 * terminal fate — a bug in the side-effect can then never bounce or misroute mail. For
 * slow I/O, call `ctx.executionCtx.waitUntil(...)` inside the effect so the handler
 * returns promptly.
 */
export function sideEffect<Env = unknown>(
	effect: (ctx: EmailContext<Env>) => void | Promise<void>
): EmailHandler<Env> {
	return async (ctx) => {
		try {
			await effect(ctx)
		} catch (error) {
			ctx.log.error('email side-effect handler failed (continuing)', {
				error: errorMessage(error),
			})
		}
		return next
	}
}
