import { describe, expect, it } from 'vitest'

import {
	formatAmount,
	isNonNegativeIntegerString,
	isPositiveIntegerString,
	negateAmount,
	parseAmount,
} from '../money'

describe('parseAmount', () => {
	it('parses plain integer strings to BigInt', () => {
		expect(parseAmount('0')).toBe(0n)
		expect(parseAmount('1')).toBe(1n)
		expect(parseAmount('100')).toBe(100n)
	})

	it('treats null / undefined / empty string as zero', () => {
		expect(parseAmount(null)).toBe(0n)
		expect(parseAmount(undefined)).toBe(0n)
		expect(parseAmount('')).toBe(0n)
	})

	it('truncates any fractional component toward the integer part', () => {
		// The DB stores integer points, but a bare `numeric` column (or a SUM) could yield a decimal
		// suffix; parseAmount floors it by splitting on '.' rather than rejecting. Documented behavior.
		expect(parseAmount('100.00')).toBe(100n)
		expect(parseAmount('100.99')).toBe(100n)
		expect(parseAmount('5.5')).toBe(5n)
	})

	it('preserves values beyond Number.MAX_SAFE_INTEGER exactly (the reason for BigInt)', () => {
		// 2^53 + 1 — not representable as a JS number, so a float-based parse would corrupt it.
		expect(parseAmount('9007199254740993')).toBe(9007199254740993n)
		expect(parseAmount('999999999999999999999')).toBe(999999999999999999999n)
	})

	it('tolerates a negative integer string (callers gate positivity separately)', () => {
		expect(parseAmount('-100')).toBe(-100n)
	})
})

describe('formatAmount', () => {
	it('renders a BigInt as its decimal string', () => {
		expect(formatAmount(0n)).toBe('0')
		expect(formatAmount(100n)).toBe('100')
		expect(formatAmount(-100n)).toBe('-100')
	})

	it('round-trips with parseAmount for integer strings', () => {
		for (const s of ['0', '1', '42', '1000000', '9007199254740993']) {
			expect(formatAmount(parseAmount(s))).toBe(s)
		}
	})
})

describe('negateAmount', () => {
	it('flips the sign of a decimal-string amount', () => {
		expect(negateAmount('100')).toBe('-100')
		expect(negateAmount('-100')).toBe('100')
		expect(negateAmount('1')).toBe('-1')
	})

	it('keeps zero as an unsigned "0"', () => {
		expect(negateAmount('0')).toBe('0')
	})

	it('is its own inverse', () => {
		expect(negateAmount(negateAmount('250'))).toBe('250')
	})
})

describe('isPositiveIntegerString', () => {
	it('accepts strictly-positive integers', () => {
		expect(isPositiveIntegerString('1')).toBe(true)
		expect(isPositiveIntegerString('100')).toBe(true)
		// Leading zeros are permitted (regex is digit-only, not canonical-form).
		expect(isPositiveIntegerString('007')).toBe(true)
	})

	it('rejects zero, negatives, decimals, blanks and non-digits', () => {
		expect(isPositiveIntegerString('0')).toBe(false)
		expect(isPositiveIntegerString('')).toBe(false)
		expect(isPositiveIntegerString('-5')).toBe(false)
		expect(isPositiveIntegerString('1.5')).toBe(false)
		expect(isPositiveIntegerString(' 5')).toBe(false)
		expect(isPositiveIntegerString('5 ')).toBe(false)
		expect(isPositiveIntegerString('abc')).toBe(false)
	})
})

describe('isNonNegativeIntegerString', () => {
	it('accepts zero and positive integers (incl. leading zeros)', () => {
		expect(isNonNegativeIntegerString('0')).toBe(true)
		expect(isNonNegativeIntegerString('1')).toBe(true)
		expect(isNonNegativeIntegerString('100')).toBe(true)
		expect(isNonNegativeIntegerString('007')).toBe(true)
	})

	it('rejects the empty string, negatives, decimals and non-digits', () => {
		// \d+ requires at least one digit, so '' does NOT match.
		expect(isNonNegativeIntegerString('')).toBe(false)
		expect(isNonNegativeIntegerString('-1')).toBe(false)
		expect(isNonNegativeIntegerString('1.0')).toBe(false)
		expect(isNonNegativeIntegerString('abc')).toBe(false)
	})
})
