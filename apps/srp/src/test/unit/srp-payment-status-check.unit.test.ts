import { describe, expect, it } from 'vitest'

import {
	buildKillmailReasonNeedle,
	parseAmountToBigInt,
} from '../../workflows/srp-payment-status-check-utils'

describe('srp-payment-status-check helpers', () => {
	it('builds expected SRP killmail reason needle', () => {
		expect(buildKillmailReasonNeedle('123456')).toBe('SRP - KM#123456')
	})

	it('parses integer and decimal ISK amounts to integer bigint', () => {
		expect(parseAmountToBigInt('1000000')).toBe(1000000n)
		expect(parseAmountToBigInt('1000000.99')).toBe(1000000n)
	})

	it('returns null for invalid amounts', () => {
		expect(parseAmountToBigInt('')).toBeNull()
		expect(parseAmountToBigInt('abc')).toBeNull()
		expect(parseAmountToBigInt(undefined)).toBeNull()
	})
})
