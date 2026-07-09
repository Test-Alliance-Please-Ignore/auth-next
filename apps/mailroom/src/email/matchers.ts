import type { EmailMatcher } from './types'

/** Matches when the full recipient address equals `address` (case-insensitive). */
export function recipientIs<Env = unknown>(address: string): EmailMatcher<Env> {
	const wanted = address.trim().toLowerCase()
	return (ctx) => ctx.recipient.trim().toLowerCase() === wanted
}

/** Matches when the recipient's local part equals `localPart` (case-insensitive), e.g. `"team"`. */
export function recipientLocalPartIs<Env = unknown>(localPart: string): EmailMatcher<Env> {
	const wanted = localPart.trim().toLowerCase()
	return (ctx) => ctx.recipientLocalPart === wanted
}

/** Matches when the recipient's domain equals `domain` (case-insensitive). */
export function recipientDomainIs<Env = unknown>(domain: string): EmailMatcher<Env> {
	const wanted = domain.trim().toLowerCase()
	return (ctx) => ctx.recipientDomain === wanted
}

/** Matches when the recipient's local part matches `pattern`. */
export function recipientLocalPartMatches<Env = unknown>(pattern: RegExp): EmailMatcher<Env> {
	return (ctx) => test(pattern, ctx.recipientLocalPart)
}

/** Matches when the full sender address equals `address` (case-insensitive). */
export function senderIs<Env = unknown>(address: string): EmailMatcher<Env> {
	const wanted = address.trim().toLowerCase()
	return (ctx) => ctx.sender.trim().toLowerCase() === wanted
}

/** Matches when the sender's domain equals `domain` (case-insensitive). */
export function senderDomainIs<Env = unknown>(domain: string): EmailMatcher<Env> {
	const wanted = domain.trim().toLowerCase()
	return (ctx) => ctx.senderDomain === wanted
}

/** Matches when the full sender address matches `pattern`. */
export function senderMatches<Env = unknown>(pattern: RegExp): EmailMatcher<Env> {
	return (ctx) => test(pattern, ctx.sender)
}

/**
 * Matches when the decoded `Subject` header matches `pattern`. Reads the header only —
 * it does NOT parse the MIME body — so it stays cheap even for a 25 MiB message.
 */
export function subjectMatches<Env = unknown>(pattern: RegExp): EmailMatcher<Env> {
	return (ctx) => ctx.subject != null && test(pattern, ctx.subject)
}

/** Always matches. Useful for a leading side-effect route (e.g. logging every message). */
export function always<Env = unknown>(): EmailMatcher<Env> {
	return () => true
}

/** Test without leaking `lastIndex` state when a global/sticky regex is passed. */
function test(pattern: RegExp, value: string): boolean {
	if (pattern.global || pattern.sticky) pattern.lastIndex = 0
	return pattern.test(value)
}
