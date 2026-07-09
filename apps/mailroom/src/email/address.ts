/** Split an email address into its lowercased local part and domain. Tolerant of malformed input. */
export function splitAddress(address: string): { localPart: string; domain: string } {
	const trimmed = address.trim().toLowerCase()
	const at = trimmed.lastIndexOf('@')
	if (at === -1) return { localPart: trimmed, domain: '' }
	return { localPart: trimmed.slice(0, at), domain: trimmed.slice(at + 1) }
}

/**
 * Best-effort RFC 2047 decoder for header values (e.g. `Subject`).
 *
 * Decodes `=?charset?B?..?=` (base64) and `=?charset?Q?..?=` (quoted-printable)
 * encoded-words, collapsing whitespace between two adjacent encoded-words per the spec.
 * A word that fails to decode is left verbatim, and a plain-ASCII header passes through
 * unchanged. This lets `subjectMatches` read the subject WITHOUT a full MIME body parse.
 */
export function decodeMimeHeader(value: string | null | undefined): string | null {
	if (value == null) return null
	if (!value.includes('=?')) return value

	const encodedWord = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g
	let result = ''
	let lastIndex = 0
	let previousWasEncoded = false
	let match: RegExpExecArray | null

	while ((match = encodedWord.exec(value)) !== null) {
		const gap = value.slice(lastIndex, match.index)
		// Per RFC 2047, whitespace separating two adjacent encoded-words is ignored.
		if (!(previousWasEncoded && gap.trim() === '')) result += gap
		const decoded = decodeEncodedWord(match[1], match[2], match[3])
		result += decoded ?? match[0]
		lastIndex = match.index + match[0].length
		// Only collapse the following whitespace if THIS word actually decoded; a verbatim
		// (undecodable) word keeps the space that separates it from the next token.
		previousWasEncoded = decoded != null
	}
	result += value.slice(lastIndex)
	return result
}

function decodeEncodedWord(charset: string, encoding: string, text: string): string | null {
	try {
		const bytes =
			encoding.toLowerCase() === 'b' ? base64ToBytes(text) : quotedPrintableToBytes(text)
		return new TextDecoder(charset).decode(bytes)
	} catch {
		return null
	}
}

function base64ToBytes(text: string): Uint8Array {
	const binary = atob(text)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

function quotedPrintableToBytes(text: string): Uint8Array {
	// In the 'Q' encoding, '_' represents 0x20 and '=XX' is a hex byte.
	const out: number[] = []
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === '_') {
			out.push(0x20)
		} else if (ch === '=' && i + 2 < text.length) {
			out.push(parseInt(text.slice(i + 1, i + 3), 16))
			i += 2
		} else {
			out.push(ch.charCodeAt(0))
		}
	}
	return Uint8Array.from(out)
}
