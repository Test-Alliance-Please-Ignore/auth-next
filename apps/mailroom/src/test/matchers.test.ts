import { describe, expect, it, vi } from 'vitest'

import {
	always,
	createEmailContext,
	recipientDomainIs,
	recipientIs,
	recipientLocalPartIs,
	senderDomainIs,
	senderIs,
	subjectMatches,
} from '../email'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { EmailLogger } from '../email'
import type { MakeMessageOptions } from './make-message'

const log: EmailLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function ctxFor(options: MakeMessageOptions) {
	return createEmailContext(makeMessage(options), {}, fakeExecutionCtx(), log)
}

describe('matchers', () => {
	it('recipient matchers are case-insensitive', () => {
		const ctx = ctxFor({ to: 'Team@PleaseIgnore.app' })
		expect(recipientLocalPartIs('team')(ctx)).toBe(true)
		expect(recipientDomainIs('pleaseignore.app')(ctx)).toBe(true)
		expect(recipientIs('team@pleaseignore.app')(ctx)).toBe(true)
		expect(recipientLocalPartIs('other')(ctx)).toBe(false)
	})

	it('sender matchers read the envelope sender', () => {
		const ctx = ctxFor({ from: 'Bob@Mail.Example.com' })
		expect(senderDomainIs('mail.example.com')(ctx)).toBe(true)
		expect(senderIs('bob@mail.example.com')(ctx)).toBe(true)
		expect(senderDomainIs('example.com')(ctx)).toBe(false)
	})

	it('subjectMatches reads the decoded subject header without parsing the body', () => {
		const ctx = ctxFor({ headers: { subject: '[ALERT] disk full' } })
		expect(subjectMatches(/\[ALERT\]/)(ctx)).toBe(true)
		expect(subjectMatches(/nope/)(ctx)).toBe(false)
	})

	it('always matches', () => {
		expect(always()(ctxFor({}))).toBe(true)
	})
})
