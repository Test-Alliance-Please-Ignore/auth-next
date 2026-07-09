import { describe, expect, it } from 'vitest'

import { parseEmail } from '../email'

const SIMPLE = [
	'From: Alice <alice@example.com>',
	'To: team@pleaseignore.app',
	'Subject: Hello',
	'Message-ID: <abc@example.com>',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'This is the body.',
	'',
].join('\r\n')

describe('parseEmail', () => {
	it('parses envelope headers and the text body', async () => {
		const parsed = await parseEmail(new TextEncoder().encode(SIMPLE))
		expect(parsed.subject).toBe('Hello')
		expect(parsed.messageId).toBe('<abc@example.com>')
		expect(parsed.from?.address).toBe('alice@example.com')
		expect(parsed.from?.name).toBe('Alice')
		expect(parsed.to.map((addr) => addr.address)).toContain('team@pleaseignore.app')
		expect(parsed.text?.trim()).toBe('This is the body.')
		expect(parsed.attachments).toHaveLength(0)
	})

	it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
		const bytes = new TextEncoder().encode(SIMPLE)
		const parsed = await parseEmail(bytes.buffer as ArrayBuffer)
		expect(parsed.subject).toBe('Hello')
	})

	it('expands group addresses and drops undisclosed-recipients', async () => {
		const mime = [
			'From: alice@example.com',
			'To: undisclosed-recipients:;',
			'Cc: Friends: carol@example.com, dave@example.com;',
			'Subject: Group test',
			'',
			'body',
			'',
		].join('\r\n')
		const parsed = await parseEmail(new TextEncoder().encode(mime))
		// No phantom { address: '' } entry for the empty group.
		expect(parsed.to.every((addr) => addr.address !== '')).toBe(true)
		// Group members are expanded to concrete mailboxes.
		expect(parsed.cc.map((addr) => addr.address)).toEqual(['carol@example.com', 'dave@example.com'])
	})
})
