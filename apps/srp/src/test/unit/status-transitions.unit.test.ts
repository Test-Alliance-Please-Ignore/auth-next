import { describe, expect, it } from 'vitest'

import { isValidStatusTransition } from '@repo/srp'

describe('isValidStatusTransition with payment_pending', () => {
	it('allows payer to move approved -> payment_pending', () => {
		expect(isValidStatusTransition('approved', 'payment_pending', 'payer')).toBe(true)
	})

	it('allows payer to move payment_pending -> paid', () => {
		expect(isValidStatusTransition('payment_pending', 'paid', 'payer')).toBe(true)
	})

	it('does not allow reviewer to move approved -> payment_pending', () => {
		expect(isValidStatusTransition('approved', 'payment_pending', 'reviewer')).toBe(false)
	})

	it('does not allow reviewer to move payment_pending -> paid', () => {
		expect(isValidStatusTransition('payment_pending', 'paid', 'reviewer')).toBe(false)
	})
})
