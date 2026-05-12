import { describe, expect, it } from 'vitest'

import { computeQueueSeverity } from './legacy-match'

describe('computeQueueSeverity', () => {
	it('returns critical when cross-user conflicts exist', () => {
		expect(
			computeQueueSeverity({
				crossModernUserQueueMatches: 1,
				multipleLegacyMatchesForModernUser: false,
			})
		).toBe('critical')
	})

	it('returns high for multi-legacy match without cross-user conflict', () => {
		expect(
			computeQueueSeverity({
				crossModernUserQueueMatches: 0,
				multipleLegacyMatchesForModernUser: true,
			})
		).toBe('high')
	})

	it('returns none for single clean match', () => {
		expect(
			computeQueueSeverity({
				crossModernUserQueueMatches: 0,
				multipleLegacyMatchesForModernUser: false,
			})
		).toBe('none')
	})
})
