/**
 * Core types for the modular inbound-email framework.
 *
 * The framework is intentionally decoupled from this specific worker: nothing in
 * `src/email/` imports an app module, so it can be lifted into a shared `@repo/email`
 * package when a second consumer appears. It depends only on the ambient Cloudflare
 * Workers types (`ForwardableEmailMessage`, `ExecutionContext`) and `postal-mime`.
 */

/** A parsed email address, split into its parts (all lowercased except `name`). */
export interface EmailAddress {
	/** Full address, e.g. `"alice@example.com"`. */
	readonly address: string
	/** Local part before the `@`, lowercased, e.g. `"alice"`. */
	readonly localPart: string
	/** Domain after the `@`, lowercased, e.g. `"example.com"`. */
	readonly domain: string
	/** Display name, if the source header carried one. */
	readonly name?: string
}

/** Metadata for a single MIME attachment (the content bytes are not retained). */
export interface ParsedAttachment {
	readonly filename: string | null
	readonly mimeType: string
	readonly disposition: string | null
	/** Size of the decoded attachment content in bytes. */
	readonly size: number
	readonly contentId: string | null
}

/** Normalized result of fully parsing a message's MIME body. */
export interface ParsedEmail {
	readonly subject: string | null
	readonly messageId: string | null
	readonly inReplyTo: string | null
	readonly references: readonly string[]
	readonly date: string | null
	readonly from: EmailAddress | null
	readonly to: readonly EmailAddress[]
	readonly cc: readonly EmailAddress[]
	readonly text: string | null
	readonly html: string | null
	readonly attachments: readonly ParsedAttachment[]
}

/** The trustworthy SMTP envelope (MAIL FROM / RCPT TO). */
export interface EmailEnvelope {
	readonly from: string
	readonly to: string
}

/** Minimal structured logger the framework writes through (defaults to console). */
export interface EmailLogger {
	info(message: string, data?: Record<string, unknown>): void
	warn(message: string, data?: Record<string, unknown>): void
	error(message: string, data?: Record<string, unknown>): void
}

/**
 * Everything a matcher or handler needs about one inbound message.
 *
 * Envelope, recipient/sender parts, headers, and subject are all cheap (no body parse).
 * Call {@link EmailContext.parsed} only when a handler genuinely needs the decoded body
 * or attachments — parsing buffers up to 25 MiB and costs CPU.
 */
export interface EmailContext<Env = unknown> {
	/** SMTP envelope (trustworthy; header addresses can be spoofed). */
	readonly envelope: EmailEnvelope
	/** RCPT TO recipient, e.g. `"team@pleaseignore.app"`. */
	readonly recipient: string
	/** Lowercased local part of the recipient, e.g. `"team"`. */
	readonly recipientLocalPart: string
	/** Lowercased domain of the recipient, e.g. `"pleaseignore.app"`. */
	readonly recipientDomain: string
	/** MAIL FROM sender, e.g. `"alice@example.com"`. */
	readonly sender: string
	/** Lowercased domain of the sender. */
	readonly senderDomain: string
	/** Raw MIME headers — cheap access, no body parse. */
	readonly headers: Headers
	/** RFC 2047-decoded `Subject` header, or `null`. Cheap — read from headers, no body parse. */
	readonly subject: string | null
	/** Size of the raw MIME message in bytes. */
	readonly rawSize: number
	/** Worker environment bindings. */
	readonly env: Env
	/** Execution context — use `executionCtx.waitUntil()` to offload slow side-effect I/O. */
	readonly executionCtx: ExecutionContext
	/** Structured logger. */
	readonly log: EmailLogger
	/** Lazily parse & memoize the full MIME body (buffers `raw` once). */
	parsed(): Promise<ParsedEmail>
}

/**
 * The terminal fate of a message, or a signal to keep routing.
 * - `forward` — hand off to a verified destination (no `send_email` binding required).
 * - `reject`  — permanent SMTP bounce (deliberate policy; NEVER use for internal errors).
 * - `consume` — accept and intentionally discard (the only sanctioned no-op).
 * - `next`    — not terminal; continue to the next matching route.
 */
export type EmailDisposition =
	| { readonly type: 'forward'; readonly to: string; readonly headers?: Headers }
	| { readonly type: 'reject'; readonly reason: string }
	| { readonly type: 'consume' }
	| { readonly type: 'next' }

/** A predicate deciding whether a route applies to a message. */
export type EmailMatcher<Env = unknown> = (ctx: EmailContext<Env>) => boolean | Promise<boolean>

/**
 * A route's action. Return a terminal {@link EmailDisposition}, or return `next` (or
 * nothing) to fall through to later routes. A handler that only performs a side-effect
 * should wrap itself with `sideEffect` so a bug can never bounce or misroute mail.
 */
export type EmailHandler<Env = unknown> = (
	ctx: EmailContext<Env>
) => EmailDisposition | void | Promise<EmailDisposition | void>

/** A named `{ match, handle }` pair. */
export interface EmailRoute<Env = unknown> {
	readonly name: string
	readonly match: EmailMatcher<Env>
	readonly handle: EmailHandler<Env>
}

/** Options for `createEmailHandler`. */
export interface EmailHandlerOptions<Env = unknown> {
	/**
	 * Resolver for a VERIFIED destination that receives mail when inbound processing
	 * fails internally (bad MIME, a handler throwing, a forward failing). Keeping mail
	 * flowing to a human is safer than a permanent bounce. If unset — or if the fallback
	 * forward itself fails — the absolute last resort is a permanent reject.
	 */
	readonly fallbackForwardAddress?: (env: Env) => string | undefined
	/** Permanent reject message used only as the absolute last resort. */
	readonly lastResortRejectMessage?: string
	/** Injectable logger (defaults to a console-backed logger). */
	readonly logger?: EmailLogger
	/** Invoked on internal error before the fallback runs — wire `captureException` here. */
	readonly onError?: (error: unknown, ctx: EmailContext<Env>) => void
}
