import { describe, expect, it } from 'vitest'

import { generatePaymentToken } from '../../../utils/token'

describe('generatePaymentToken', () => {
	it('does not generate ambiguous characters (l, I, O)', () => {
		for (let i = 0; i < 500; i += 1) {
			const token = generatePaymentToken()
			expect(token).not.toContain('l')
			expect(token).not.toContain('I')
			expect(token).not.toContain('O')
		}
	})
})

