import {
	always,
	EmailRouter,
	forward,
	next,
	recipientLocalPartIs,
	reject,
	sideEffect,
} from './email'
import { notifyDiscord } from './notify-discord'

import type { Env } from './context'

/**
 * The inbound-email routing table for pleaseignore.app.
 *
 * Routes are evaluated in order; the first terminal disposition wins. Matchers here read
 * only the envelope and headers (no body parse), so they stay cheap even for large mail.
 * This is the place to add new inbound behaviours — each is an isolated, testable route.
 * To act on the decoded body/attachments, call `await ctx.parsed()` inside a handler.
 */
export const emailRouter = new EmailRouter<Env>()
	// Observability: structured-log every inbound message. Non-terminal (returns `next`),
	// and wrapped in `sideEffect` so a logging bug can never bounce or misroute mail.
	.on(
		always(),
		sideEffect((ctx) => {
			ctx.log.info('inbound email received', {
				from: ctx.sender,
				to: ctx.recipient,
				subject: ctx.subject,
				bytes: ctx.rawSize,
			})
		}),
		'log-inbound'
	)

	// markeedragon@ → post the email to a Discord channel (via the shared Discord DO), then
	// consume it. Envelope-only match, so the body is parsed only when it's actually for
	// this address. Sends inline so a Discord failure surfaces (Sentry + forward-to-fallback).
	.on(recipientLocalPartIs('markeedragon'), notifyDiscord, 'markeedragon-to-discord')

	// Example alias: forward "team@…" to a configured, verified destination. The match is
	// envelope-only; the handler forwards only when FORWARD_TEAM_TO is set, otherwise it
	// returns `next` so an unconfigured deploy falls through to the no-match policy below.
	.on(
		recipientLocalPartIs('team'),
		(ctx) => (ctx.env.FORWARD_TEAM_TO ? forward(ctx.env.FORWARD_TEAM_TO) : next),
		'forward-team'
	)

	// No-match policy: unknown recipients receive a deliberate, permanent rejection.
	.otherwise(() => reject('This address does not accept mail.'))
