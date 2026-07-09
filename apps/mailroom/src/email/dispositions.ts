import type { EmailDisposition } from './types'

/**
 * Forward the message to a verified destination address.
 *
 * `message.forward()` is an inbound-session operation and needs NO `send_email` binding
 * or domain onboarding — the destination only has to be a verified Email Routing address.
 */
export function forward(to: string, headers?: Headers): EmailDisposition {
	return { type: 'forward', to, headers }
}

/**
 * Permanently reject the message with an SMTP error.
 *
 * `setReject` is ALWAYS a permanent bounce — use it as deliberate policy (e.g. unknown
 * recipient, blocked sender), never as the fallback for an internal/framework error.
 */
export function reject(reason: string): EmailDisposition {
	return { type: 'reject', reason }
}

/** Accept and intentionally discard the message. The only sanctioned silent no-op. */
export const consume: EmailDisposition = { type: 'consume' }

/** Not terminal — continue to the next matching route. Equivalent to a handler returning nothing. */
export const next: EmailDisposition = { type: 'next' }
