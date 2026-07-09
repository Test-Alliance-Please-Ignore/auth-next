import { next, reject } from './dispositions'
import { errorMessage } from './util'

import type {
	EmailContext,
	EmailDisposition,
	EmailHandler,
	EmailMatcher,
	EmailRoute,
} from './types'

const DEFAULT_NO_MATCH_REASON = 'No handler is configured for this address.'

/**
 * An ordered table of inbound-email routes, evaluated top to bottom.
 *
 * For each route whose matcher returns true, the handler runs. The first handler that
 * returns a terminal disposition (`forward`/`reject`/`consume`) wins; a handler that
 * returns `next` (or nothing) falls through to later routes. If no route produces a
 * terminal disposition, the `otherwise` policy decides (default: permanent reject).
 *
 * A matcher that throws is fail-open (the route is skipped — mail is never bounced on a
 * predicate bug). A handler that throws propagates to `createEmailHandler`, which applies
 * the safe error fallback (forward-to-fallback, not a permanent reject).
 */
export class EmailRouter<Env = unknown> {
	private readonly routes: EmailRoute<Env>[] = []
	private noMatch: EmailHandler<Env> = () => reject(DEFAULT_NO_MATCH_REASON)

	/** Append a route from a matcher + handler. */
	on(match: EmailMatcher<Env>, handle: EmailHandler<Env>, name?: string): this {
		this.routes.push({ name: name ?? `route[${this.routes.length}]`, match, handle })
		return this
	}

	/** Append a pre-built route. */
	use(route: EmailRoute<Env>): this {
		this.routes.push(route)
		return this
	}

	/**
	 * Set the policy for messages no route handled (default: permanent reject).
	 *
	 * Unlike a normal route, the `otherwise` slot is terminal: if its handler returns `next`
	 * (or nothing) the router falls back to the default permanent reject rather than
	 * continuing. Return an explicit `forward`/`reject`/`consume` to control the outcome.
	 */
	otherwise(handle: EmailHandler<Env>): this {
		this.noMatch = handle
		return this
	}

	/** Evaluate the table and resolve exactly one terminal disposition (never `next`). */
	async route(ctx: EmailContext<Env>): Promise<EmailDisposition> {
		for (const route of this.routes) {
			let matched = false
			try {
				matched = await route.match(ctx)
			} catch (error) {
				ctx.log.error('email matcher threw; skipping route (fail-open)', {
					route: route.name,
					error: errorMessage(error),
				})
				continue
			}
			if (!matched) continue

			const disposition = (await route.handle(ctx)) ?? next
			if (disposition.type !== 'next') return disposition
		}

		const fallback = (await this.noMatch(ctx)) ?? reject(DEFAULT_NO_MATCH_REASON)
		return fallback.type === 'next' ? reject(DEFAULT_NO_MATCH_REASON) : fallback
	}
}
