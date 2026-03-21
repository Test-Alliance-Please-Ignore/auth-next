import { describe, expect, it } from 'vitest'

import { computeRuleMutationRecalcStart } from '../projection-rule-freshness'

describe('computeRuleMutationRecalcStart', () => {
	it('returns null when no mutation is newer than projection', () => {
		const result = computeRuleMutationRecalcStart({
			projectionUpdatedAt: new Date('2026-03-20T10:00:00.000Z'),
			openPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
			earliestRuleSetMutationAt: new Date('2026-03-20T09:00:00.000Z'),
			membershipMutationAt: null,
		})
		expect(result).toBeNull()
	})

	it('bounds recalc start to open period start when mutation is before open month', () => {
		const result = computeRuleMutationRecalcStart({
			projectionUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
			openPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
			earliestRuleSetMutationAt: new Date('2026-02-20T12:00:00.000Z'),
			membershipMutationAt: null,
		})
		expect(result?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
	})

	it('handles zero-wallet-delta membership mutation signal', () => {
		const result = computeRuleMutationRecalcStart({
			projectionUpdatedAt: new Date('2026-03-10T00:00:00.000Z'),
			openPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
			earliestRuleSetMutationAt: null,
			membershipMutationAt: new Date('2026-03-12T15:30:00.000Z'),
		})
		expect(result?.toISOString()).toBe('2026-03-12T15:30:00.000Z')
	})
})
