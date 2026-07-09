import { describe, expect, it } from 'vitest'

import { decodeMimeHeader, splitAddress } from '../email'

describe('splitAddress', () => {
	it('splits and lowercases the local part and domain', () => {
		expect(splitAddress('Alice@Example.COM')).toEqual({ localPart: 'alice', domain: 'example.com' })
	})
	it('uses the last @ for addresses containing multiple @', () => {
		expect(splitAddress('a@b@example.com')).toEqual({ localPart: 'a@b', domain: 'example.com' })
	})
	it('tolerates a missing domain', () => {
		expect(splitAddress('malformed')).toEqual({ localPart: 'malformed', domain: '' })
	})
})

describe('decodeMimeHeader', () => {
	it('passes through plain ASCII', () => {
		expect(decodeMimeHeader('Hello there')).toBe('Hello there')
	})
	it('returns null for null', () => {
		expect(decodeMimeHeader(null)).toBeNull()
	})
	it('decodes a base64 encoded-word', () => {
		// "SGVsbG8gd29ybGQ=" is base64 for "Hello world".
		expect(decodeMimeHeader('=?utf-8?B?SGVsbG8gd29ybGQ=?=')).toBe('Hello world')
	})
	it('decodes a quoted-printable encoded-word with underscores', () => {
		expect(decodeMimeHeader('=?utf-8?Q?Hello_world?=')).toBe('Hello world')
	})
	it('decodes non-ASCII quoted-printable bytes', () => {
		// "=C3=A9" is "é" in UTF-8.
		expect(decodeMimeHeader('=?utf-8?Q?caf=C3=A9?=')).toBe('café')
	})
	it('collapses whitespace between adjacent encoded-words', () => {
		expect(decodeMimeHeader('=?utf-8?B?SGVsbG8=?= =?utf-8?B?d29ybGQ=?=')).toBe('Helloworld')
	})
	it('keeps surrounding text around an encoded-word', () => {
		expect(decodeMimeHeader('RE: =?utf-8?Q?caf=C3=A9?= today')).toBe('RE: café today')
	})
	it('preserves the separating space after an undecodable encoded-word', () => {
		// An unsupported charset is left verbatim; the space before the next word must survive.
		const input = '=?x-unknown-charset?B?%%%?= =?utf-8?B?d29ybGQ=?='
		const out = decodeMimeHeader(input)
		expect(out).toContain(' world')
		expect(out).toContain('=?x-unknown-charset?B?%%%?=')
	})
})
