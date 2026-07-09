import { decodeMimeHeader, splitAddress } from './address'
import { parseEmail } from './parse'

import type { EmailContext, EmailLogger, ParsedEmail } from './types'

/** Build the per-message {@link EmailContext} from a raw inbound message. */
export function createEmailContext<Env>(
	message: ForwardableEmailMessage,
	env: Env,
	executionCtx: ExecutionContext,
	log: EmailLogger
): EmailContext<Env> {
	const recipient = message.to
	const sender = message.from
	const recipientParts = splitAddress(recipient)
	const senderParts = splitAddress(sender)
	let parsedPromise: Promise<ParsedEmail> | undefined

	return {
		envelope: { from: sender, to: recipient },
		recipient,
		recipientLocalPart: recipientParts.localPart,
		recipientDomain: recipientParts.domain,
		sender,
		senderDomain: senderParts.domain,
		headers: message.headers,
		subject: decodeMimeHeader(message.headers.get('subject')),
		rawSize: message.rawSize,
		env,
		executionCtx,
		log,
		parsed() {
			// `message.raw` is single-use — buffer it exactly once, then memoize the parse.
			if (!parsedPromise) {
				parsedPromise = new Response(message.raw).arrayBuffer().then(parseEmail)
			}
			return parsedPromise
		},
	}
}
