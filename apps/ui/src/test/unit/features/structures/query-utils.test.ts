import { describe, expect, it } from 'vitest'

import {
	buildStructureListContentKey,
	getEffectiveStructureSortByForTab,
} from '../../../../client/features/structures/query-utils'

describe('structure query utils', () => {
	it('falls back to the tab default sort when a value is not supported on that tab', () => {
		expect(getEffectiveStructureSortByForTab('skyhooks', 'planet')).toBe('skyhookSurplusFullness')
		expect(getEffectiveStructureSortByForTab('sovereignty', 'planet')).toBe('fuel')
		expect(getEffectiveStructureSortByForTab('moon-drills', 'planet')).toBe('planet')
	})

	it('produces the same cache key for unsupported and default sorts on the same tab', () => {
		const baseArgs = {
			tab: 'skyhooks' as const,
			page: 2,
			pageSize: 25,
			sortDirection: 'asc' as const,
			filters: {
				corporationId: '123',
				isRaidable: 'true',
			},
		}

		const invalidSortKey = buildStructureListContentKey({
			...baseArgs,
			sortBy: 'planet',
		})
		const defaultSortKey = buildStructureListContentKey({
			...baseArgs,
			sortBy: 'skyhookSurplusFullness',
		})

		expect(invalidSortKey).toBe(defaultSortKey)
		expect(invalidSortKey).toContain(':skyhookSurplusFullness:asc:')
	})

	it('keeps valid tab-specific sorts intact', () => {
		expect(
			getEffectiveStructureSortByForTab('skyhooks', 'raidable')
		).toBe('raidable')
		expect(
			getEffectiveStructureSortByForTab('sovereignty', 'activityDefenseMultiplier')
		).toBe('activityDefenseMultiplier')
	})
})
