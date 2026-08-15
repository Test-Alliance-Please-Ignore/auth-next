import { describe, expect, it } from 'vitest'

import {
	filterValidOreTypeIds,
	getValidCompositionSortOreTypeId,
} from '../../../../client/features/moon-scan/system-view'

describe('moon scan system view state', () => {
	it('removes persisted ore filters that are not present in the current system', () => {
		expect(filterValidOreTypeIds(['ore-a', 'stale-ore', 'ore-a'], new Set(['ore-a']))).toEqual([
			'ore-a',
			'ore-a',
		])
	})

	it('clears a persisted composition sort key that is not present in the current system', () => {
		expect(getValidCompositionSortOreTypeId('stale-ore', new Set(['ore-a']))).toBe('')
		expect(getValidCompositionSortOreTypeId('ore-a', new Set(['ore-a']))).toBe('ore-a')
	})
})
