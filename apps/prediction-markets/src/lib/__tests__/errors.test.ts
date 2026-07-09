import { describe, expect, it } from 'vitest'

import { isExpectedError, PmError } from '../errors'
import { assertTransition } from '../state-machine'

describe('PmError', () => {
	it('sets message === code so RPC-boundary string matching keeps working', () => {
		const err = new PmError('MARKET_NOT_FOUND')
		expect(err).toBeInstanceOf(Error)
		expect(err.message).toBe('MARKET_NOT_FOUND')
		expect(err.code).toBe('MARKET_NOT_FOUND')
		expect(err.name).toBe('PmError')
	})

	it('defaults to expected=true (a normal user-facing rejection)', () => {
		expect(new PmError('INSUFFICIENT_FUNDS').expected).toBe(true)
	})

	it('honors expected=false for internal invariants', () => {
		expect(new PmError('MARKET_CREATE_FAILED', { expected: false }).expected).toBe(false)
	})

	it('appends a detail suffix to the message (e.g. RATE_LIMITED:1234) while keeping the bare code', () => {
		const err = new PmError('RATE_LIMITED', { detail: 1234 })
		expect(err.message).toBe('RATE_LIMITED:1234')
		expect(err.code).toBe('RATE_LIMITED')
		// Core parses the retry-after off the message prefix.
		expect(err.message.startsWith('RATE_LIMITED')).toBe(true)
	})
})

describe('isExpectedError', () => {
	it('returns the PmError verdict (expected rejections are not paged)', () => {
		expect(isExpectedError(new PmError('MARKET_CLOSED'))).toBe(true)
		expect(isExpectedError(new PmError('RATE_LIMITED', { detail: 5 }))).toBe(true)
		expect(isExpectedError(new PmError('MARKET_CREATE_FAILED', { expected: false }))).toBe(false)
	})

	it('treats the state-machine assertTransition throw as expected (matched by message prefix)', () => {
		let thrown: unknown
		try {
			assertTransition('resolved', 'open') // terminal -> illegal
		} catch (e) {
			thrown = e
		}
		expect(thrown).toBeInstanceOf(Error)
		expect(isExpectedError(thrown)).toBe(true)
	})

	it('treats an arbitrary infra error (or non-error) as unexpected (pages)', () => {
		expect(isExpectedError(new Error('Failed query: relation "pm_bets" does not exist'))).toBe(
			false
		)
		expect(isExpectedError('boom')).toBe(false)
		expect(isExpectedError(undefined)).toBe(false)
	})
})
