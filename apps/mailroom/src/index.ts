import { Hono } from 'hono'

import { captureException, withNotFound, withOnError, withSentry, withWorkersLogger } from '@repo/hono-helpers'

import { createEmailHandler, errorMessage } from './email'
import { emailRouter } from './routes'

import type { App, Env } from './context'

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			withWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	// Health endpoint (for local dev / uptime checks). Inbound email arrives via the
	// email() handler below, wired by an Email Routing rule — not by an HTTP route.
	.get('/', (c) =>
		c.json({ service: 'mailroom', role: 'inbound-email', status: 'ok', name: c.env.NAME })
	)

/**
 * Cloudflare inbound-email handler: routes each message through the modular router and
 * guarantees exactly one terminal action, forwarding to a fallback mailbox on failure.
 */
const email = createEmailHandler<Env>(emailRouter, {
	fallbackForwardAddress: (env) => env.FALLBACK_FORWARD_ADDRESS,
	onError: (error, ctx) =>
		captureException(error instanceof Error ? error : new Error(errorMessage(error)), {
			tags: { worker: 'mailroom', phase: 'email', recipientDomain: ctx.recipientDomain },
			extra: {
				from: ctx.sender,
				to: ctx.recipient,
				subject: ctx.subject ?? undefined,
				bytes: ctx.rawSize,
			},
		}),
})

/**
 * Export BOTH handlers through Sentry's wrapper. `@sentry/cloudflare` proxies each handler
 * method it finds on the object it is given, so `email` MUST be a property here (not bolted
 * onto the outside after `withSentry(app)`) or it runs with no initialized Sentry client.
 * Hono's `app.fetch` is a pre-bound arrow class field, so no `.bind` is needed.
 */
export default withSentry({
	fetch: app.fetch,
	email,
} satisfies ExportedHandler<Env>)
