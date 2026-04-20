import { describe, expect, it } from 'vitest'

import { roundDownToMillionISK } from '@repo/srp'

describe('roundDownToMillionISK', () => {
	it('leaves exact multiples of 1M unchanged', () =>
		expect(roundDownToMillionISK('1000000')).toBe('1000000'))

	it('rounds 1,999,999 down to 1,000,000', () =>
		expect(roundDownToMillionISK('1999999')).toBe('1000000'))

	it('returns 0 for values under 1M', () => expect(roundDownToMillionISK('999999')).toBe('0'))

	it('returns 0 for zero', () => expect(roundDownToMillionISK('0')).toBe('0'))

	it('rounds 100,500,000 down to 100,000,000', () =>
		expect(roundDownToMillionISK('100500000')).toBe('100000000'))

	it('handles large ISK values (10B)', () =>
		expect(roundDownToMillionISK('10999999999')).toBe('10999000000'))

	it('handles exact 1B', () => expect(roundDownToMillionISK('1000000000')).toBe('1000000000'))
})
