import PostalMime from 'postal-mime'

import { splitAddress } from './address'

import type { Address, Attachment, Mailbox } from 'postal-mime'
import type { EmailAddress, ParsedAttachment, ParsedEmail } from './types'

/** Fully parse a raw MIME message into a normalized {@link ParsedEmail}. */
export async function parseEmail(raw: ArrayBuffer | Uint8Array | string): Promise<ParsedEmail> {
	const email = await PostalMime.parse(raw)
	return {
		subject: email.subject ?? null,
		messageId: email.messageId ?? null,
		inReplyTo: email.inReplyTo ?? null,
		references: normalizeReferences(email.references),
		date: email.date ?? null,
		from: email.from ? (expandAddress(email.from)[0] ?? null) : null,
		to: (email.to ?? []).flatMap(expandAddress),
		cc: (email.cc ?? []).flatMap(expandAddress),
		text: email.text ?? null,
		html: email.html ?? null,
		attachments: (email.attachments ?? []).map(toAttachment),
	}
}

/**
 * Flatten a postal-mime {@link Address} into concrete mailboxes. A group address
 * (`"Team: a@x, b@y;"`) expands to its members; `undisclosed-recipients:;` and any entry
 * without an address yields none (rather than a phantom `{ address: '' }`).
 */
function expandAddress(address: Address): EmailAddress[] {
	if (address.group) return address.group.map(mailboxToAddress)
	return address.address ? [mailboxToAddress(address)] : []
}

function mailboxToAddress(mailbox: Mailbox): EmailAddress {
	const raw = mailbox.address.trim()
	const { localPart, domain } = splitAddress(raw)
	return { address: raw, localPart, domain, name: mailbox.name || undefined }
}

function toAttachment(attachment: Attachment): ParsedAttachment {
	const content = attachment.content
	const size =
		typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength
	return {
		filename: attachment.filename ?? null,
		mimeType: attachment.mimeType,
		disposition: attachment.disposition ?? null,
		size,
		contentId: attachment.contentId ?? null,
	}
}

function normalizeReferences(references: string | undefined): string[] {
	if (!references) return []
	return references
		.split(/\s+/)
		.map((ref) => ref.trim())
		.filter(Boolean)
}
