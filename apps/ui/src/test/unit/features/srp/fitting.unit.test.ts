import { describe, expect, it } from 'vitest'

import {
	transformKillmailToCargoItems,
	transformKillmailToFittingItems,
	transformKillmailToShipMaintenanceBayShips,
} from '@/features/srp/utils/fitting'

describe('SRP killmail fitting transforms', () => {
	it('renders a ship maintenance bay ship as cargo without its nested contents', () => {
		const items = [
			{ flag: 27, item_type_id: 4292, quantity_dropped: 1 },
			{
				flag: 90,
				item_type_id: 11400,
				quantity_dropped: 1,
				items: [{ flag: 27, item_type_id: 4027, quantity_dropped: 1 }],
			},
		]

		expect(transformKillmailToFittingItems(items, [])).toEqual([
			expect.objectContaining({ typeId: '4292', slotType: 'high' }),
		])
		expect(transformKillmailToCargoItems(items)).toEqual([])
		expect(transformKillmailToShipMaintenanceBayShips(items)).toEqual([
			expect.objectContaining({
				typeId: '11400',
				quantity: 1,
				contents: [expect.objectContaining({ typeId: '4027', quantity: 1 })],
			}),
		])
	})
})
