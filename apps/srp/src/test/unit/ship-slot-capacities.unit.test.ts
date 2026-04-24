import { describe, expect, it } from 'vitest'

import {
	DEFAULT_NON_POD_SLOT_CAPACITIES,
	DEFAULT_POD_SLOT_CAPACITIES,
	parseShipSlotCapacitiesFromDogmaAttributes,
} from '../../lib/ship-slot-capacities'

describe('parseShipSlotCapacitiesFromDogmaAttributes', () => {
	it('maps known dogma attributes to slot capacities', () => {
		const capacities = parseShipSlotCapacitiesFromDogmaAttributes([
			{ attribute_id: 14, value: 8 }, // high
			{ attribute_id: 13, value: 5 }, // mid
			{ attribute_id: 12, value: 6 }, // low
			{ attribute_id: 1137, value: 3 }, // rig
			{ attribute_id: 1367, value: 4 }, // sub
		])

		expect(capacities).toEqual({
			high: 8,
			mid: 5,
			low: 6,
			rig: 3,
			sub: 4,
			implant: 0,
		})
	})

	it('clamps out-of-range values to UI-supported maxima', () => {
		const capacities = parseShipSlotCapacitiesFromDogmaAttributes([
			{ attribute_id: 14, value: 99 },
			{ attribute_id: 13, value: -3 },
			{ attribute_id: 12, value: 8.9 },
			{ attribute_id: 1137, value: 9 },
			{ attribute_id: 1367, value: 7 },
		])

		expect(capacities).toEqual({
			high: 8,
			mid: 0,
			low: 8,
			rig: 3,
			sub: 4,
			implant: 0,
		})
	})

	it('returns zeroed non-pod defaults when attributes are missing', () => {
		expect(parseShipSlotCapacitiesFromDogmaAttributes(undefined)).toEqual(
			DEFAULT_NON_POD_SLOT_CAPACITIES
		)
		expect(parseShipSlotCapacitiesFromDogmaAttributes([])).toEqual(
			DEFAULT_NON_POD_SLOT_CAPACITIES
		)
	})

	it('keeps pod defaults as explicit 10 implant slots', () => {
		expect(DEFAULT_POD_SLOT_CAPACITIES).toEqual({
			high: 0,
			mid: 0,
			low: 0,
			rig: 0,
			sub: 0,
			implant: 10,
		})
	})
})
