import { createEmailContext } from './context'
import { consoleLogger, errorMessage } from './util'

import type { EmailRouter } from './router'
import type { EmailContext, EmailDisposition, EmailHandlerOptions, EmailLogger } from './types'

const DEFAULT_LAST_RESORT = 'This message could not be processed and was not accepted.'

/**
 * Build a Cloudflare `email()` handler from an {@link EmailRouter}.
 *
 * Guarantees the no-silent-drop invariant: EXACTLY ONE terminal action
 * (`setReject` / `forward`) fires on every code path, and the handler never rethrows.
 * On internal failure it forwards to a configured fallback mailbox rather than
 * permanently rejecting legitimate mail (`setReject` is always a permanent bounce).
 *
 * The guarantee is hardened against its own injection points: a throwing `onError`
 * callback, a throwing injected `logger`, or a throwing `fallbackForwardAddress` resolver
 * can never preempt the terminal action, and an outer net applies the same
 * forward-to-fallback (else reject) for anything unforeseen — including a failure while
 * building the context.
 */
export function createEmailHandler<Env>(
	router: EmailRouter<Env>,
	options: EmailHandlerOptions<Env> = {}
): (message: ForwardableEmailMessage, env: Env, executionCtx: ExecutionContext) => Promise<void> {
	const log: EmailLogger = options.logger ?? consoleLogger
	const lastResort = options.lastResortRejectMessage ?? DEFAULT_LAST_RESORT

	return async function email(message, env, executionCtx): Promise<void> {
		try {
			const ctx = createEmailContext(message, env, executionCtx, log)

			let disposition: EmailDisposition
			try {
				disposition = await router.route(ctx)
			} catch (error) {
				swallow(() => options.onError?.(error, ctx))
				swallow(() =>
					log.error('email routing failed; applying error fallback', {
						recipient: ctx.recipient,
						sender: ctx.sender,
						error: errorMessage(error),
					})
				)
				await applyErrorFallback(message, ctx.env, options, lastResort, log)
				return
			}

			await applyDisposition(message, ctx, disposition, options, lastResort, log)
		} catch (fatal) {
			// Nothing above is expected to escape (`applyDisposition`/`applyErrorFallback` are
			// internally guarded), but a context-construction failure or any unforeseen throw must
			// NEVER drop mail. `applyErrorFallback` only needs `env` (not the possibly-unbuilt ctx),
			// so we still forward-to-fallback here rather than jumping straight to a permanent reject.
			swallow(() =>
				log.error('email handler hit an unexpected error; applying error fallback', {
					error: errorMessage(fatal),
				})
			)
			await applyErrorFallback(message, env, options, lastResort, log)
		}
	}
}

/** Apply the chosen disposition; on failure, fall back safely. Exactly one terminal action. */
async function applyDisposition<Env>(
	message: ForwardableEmailMessage,
	ctx: EmailContext<Env>,
	disposition: EmailDisposition,
	options: EmailHandlerOptions<Env>,
	lastResort: string,
	log: EmailLogger
): Promise<void> {
	switch (disposition.type) {
		case 'forward':
			try {
				await message.forward(disposition.to, disposition.headers)
			} catch (error) {
				swallow(() => options.onError?.(error, ctx))
				swallow(() =>
					log.error('email forward failed; applying error fallback', {
						to: disposition.to,
						error: errorMessage(error),
					})
				)
				await applyErrorFallback(message, ctx.env, options, lastResort, log)
			}
			return
		case 'reject':
			// Deliberate policy — a permanent bounce is intended here.
			message.setReject(disposition.reason)
			return
		case 'consume':
			// Accept and intentionally discard (the only sanctioned no-op).
			swallow(() =>
				log.info('email consumed (intentionally discarded)', {
					recipient: ctx.recipient,
					sender: ctx.sender,
				})
			)
			return
		case 'next':
			// The router never returns `next`; treat it as an internal inconsistency.
			swallow(() =>
				log.error('router returned a non-terminal disposition; applying error fallback', {
					recipient: ctx.recipient,
				})
			)
			await applyErrorFallback(message, ctx.env, options, lastResort, log)
			return
		default: {
			// Exhaustiveness guard: adding a new EmailDisposition member without a case here is a
			// compile error, and at runtime an unhandled type is funnelled to the safe fallback
			// rather than silently dropped.
			const _exhaustive: never = disposition
			void _exhaustive
			swallow(() =>
				log.error('unhandled disposition; applying error fallback', {
					type: (disposition as { type?: string }).type,
					recipient: ctx.recipient,
				})
			)
			await applyErrorFallback(message, ctx.env, options, lastResort, log)
			return
		}
	}
}

/**
 * Safe terminal action for internal failures: forward to the fallback mailbox if
 * configured (mail is preserved), else permanently reject as an absolute last resort.
 * Never throws — the resolver, the forward, and every log call are individually guarded.
 */
async function applyErrorFallback<Env>(
	message: ForwardableEmailMessage,
	env: Env,
	options: EmailHandlerOptions<Env>,
	lastResort: string,
	log: EmailLogger
): Promise<void> {
	let fallback: string | undefined
	try {
		fallback = options.fallbackForwardAddress?.(env)
	} catch (error) {
		swallow(() =>
			log.error('fallback-address resolver threw; using last-resort reject', {
				error: errorMessage(error),
			})
		)
	}

	if (fallback) {
		try {
			await message.forward(fallback)
			return
		} catch (error) {
			swallow(() =>
				log.error('fallback forward failed; using last-resort reject', {
					fallback,
					error: errorMessage(error),
				})
			)
		}
	}

	// Last resort — synchronous, cannot fail.
	message.setReject(lastResort)
}

/** Run a diagnostic side-effect (onError/logger) without ever letting it preempt the terminal action. */
function swallow(fn: () => void): void {
	try {
		fn()
	} catch {
		// A diagnostic hook must never defeat the guaranteed terminal action.
	}
}
