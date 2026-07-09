/**
 * Modular inbound-email framework.
 *
 * A Hono-router-analogue for Cloudflare Email Routing: an ordered table of routes, each a
 * `{ match, handle }` pair, resolved to exactly one terminal disposition by a handler that
 * guarantees no silent drops. Decoupled from this worker — safe to lift into `@repo/email`.
 */
export { createEmailContext } from './context'
export { consume, forward, next, reject } from './dispositions'
export { createEmailHandler } from './handler'
export { sideEffect } from './helpers'
export { parseEmail } from './parse'
export { EmailRouter } from './router'
export { consoleLogger, errorMessage } from './util'
export { decodeMimeHeader, splitAddress } from './address'
export {
	always,
	recipientDomainIs,
	recipientIs,
	recipientLocalPartIs,
	recipientLocalPartMatches,
	senderDomainIs,
	senderIs,
	senderMatches,
	subjectMatches,
} from './matchers'

export type {
	EmailAddress,
	EmailContext,
	EmailDisposition,
	EmailEnvelope,
	EmailHandler,
	EmailHandlerOptions,
	EmailLogger,
	EmailMatcher,
	EmailRoute,
	ParsedAttachment,
	ParsedEmail,
} from './types'
