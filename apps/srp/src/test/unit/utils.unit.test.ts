import { describe, expect, it } from 'vitest'

import { roundToMillion } from '@repo/srp'

describe('roundToMillion', () => {
	it('leaves exact multiples of 1M unchanged', () =>
		expect(roundToMillion('1000000')).toBe('1000000'))

	it('rounds 1,999,999 to 2,000,000', () =>
		expect(roundToMillion('1999999')).toBe('2000000'))

	it('rounds values under 1M to nearest million', () =>
		expect(roundToMillion('999999')).toBe('1000000'))

	it('rounds 499,999 up to 1,000,000', () => expect(roundToMillion('499999')).toBe('1000000'))

	it('returns 0 for zero', () => expect(roundToMillion('0')).toBe('0'))

	it('rounds 100,500,000 up to 101,000,000', () =>
		expect(roundToMillion('100500000')).toBe('101000000'))

	it('handles large ISK values (10B)', () =>
		expect(roundToMillion('10999999999')).toBe('11000000000'))

	it('handles exact 1B', () => expect(roundToMillion('1000000000')).toBe('1000000000'))
})
