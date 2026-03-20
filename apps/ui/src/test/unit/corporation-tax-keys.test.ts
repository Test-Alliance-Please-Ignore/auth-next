import { expect, it } from 'vitest'

import { corporationTaxKeys } from '../../client/hooks/useCorporationTax'

it('member summary query key changes when filter tuple changes', () => {
	const baseKey = corporationTaxKeys.memberSummary('1234', {
		fromDate: '2026-03-01T00:00:00.000Z',
		toDate: '2026-03-31T23:59:59.999Z',
	})
	const characterFilteredKey = corporationTaxKeys.memberSummary('1234', {
		characterQuery: 'Zen',
		fromDate: '2026-03-01T00:00:00.000Z',
		toDate: '2026-03-31T23:59:59.999Z',
	})
	const dateShiftedKey = corporationTaxKeys.memberSummary('1234', {
		fromDate: '2026-02-01T00:00:00.000Z',
		toDate: '2026-02-28T23:59:59.999Z',
	})
	const topRefTypesKey = corporationTaxKeys.memberSummary('1234', {
		fromDate: '2026-03-01T00:00:00.000Z',
		toDate: '2026-03-31T23:59:59.999Z',
		topRefTypesLimit: 5,
	})

	expect(characterFilteredKey).not.toEqual(baseKey)
	expect(dateShiftedKey).not.toEqual(baseKey)
	expect(topRefTypesKey).not.toEqual(baseKey)
})
