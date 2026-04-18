import { describe, expect, it } from 'vitest'

import { buildEquippedByType } from '../../lib/equipment'

// EVE flag constants (from slot-flags.ts ranges)
const FLAG_LOW_0 = 11
const FLAG_MID_0 = 19
const FLAG_HIGH_0 = 27
const FLAG_RIG_0 = 92
const FLAG_CARGO = 5 // not an equipped slot

describe('buildEquippedByType', () => {
	it('returns empty map for empty items array', () => {
		expect(buildEquippedByType([])).toEqual(new Map())
	})

	it('filters out cargo and non-equipped flags', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_CARGO, item_type_id: 100, quantity_destroyed: 1 },
		])
		expect(result.size).toBe(0)
	})

	it('filters out items with missing flag', () => {
		const result = buildEquippedByType([
			{ flag: 0, item_type_id: 100, quantity_destroyed: 1 },
		])
		expect(result.size).toBe(0)
	})

	it('filters out items with missing item_type_id', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_LOW_0, item_type_id: 0, quantity_destroyed: 1 },
		])
		expect(result.size).toBe(0)
	})

	it('includes low slot items', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_LOW_0, item_type_id: 200, quantity_destroyed: 1 },
		])
		expect(result.get('200')).toBe(1)
	})

	it('includes mid slot items', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_MID_0, item_type_id: 201, quantity_destroyed: 1 },
		])
		expect(result.get('201')).toBe(1)
	})

	it('includes high slot items', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_HIGH_0, item_type_id: 202, quantity_destroyed: 1 },
		])
		expect(result.get('202')).toBe(1)
	})

	it('includes rig slot items', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_RIG_0, item_type_id: 203, quantity_destroyed: 1 },
		])
		expect(result.get('203')).toBe(1)
	})

	it('sums quantity_destroyed + quantity_dropped for the same item', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_LOW_0, item_type_id: 300, quantity_destroyed: 2, quantity_dropped: 3 },
		])
		expect(result.get('300')).toBe(5)
	})

	it('defaults missing quantity fields to 0', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_LOW_0, item_type_id: 301 },
		])
		expect(result.get('301')).toBe(0)
	})

	it('groups multiple entries of the same typeId across different slots', () => {
		// Same module in multiple slots (e.g., two shield extenders)
		const result = buildEquippedByType([
			{ flag: FLAG_MID_0, item_type_id: 400, quantity_destroyed: 1 },
			{ flag: FLAG_MID_0 + 1, item_type_id: 400, quantity_destroyed: 1 },
		])
		expect(result.get('400')).toBe(2)
	})

	it('keeps separate entries for distinct type IDs', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_LOW_0, item_type_id: 500, quantity_destroyed: 1 },
			{ flag: FLAG_MID_0, item_type_id: 501, quantity_destroyed: 2 },
		])
		expect(result.get('500')).toBe(1)
		expect(result.get('501')).toBe(2)
		expect(result.size).toBe(2)
	})

	it('mixed equipped and non-equipped — only equipped survive', () => {
		const result = buildEquippedByType([
			{ flag: FLAG_HIGH_0, item_type_id: 600, quantity_destroyed: 1 },
			{ flag: FLAG_CARGO, item_type_id: 601, quantity_destroyed: 10 },
		])
		expect(result.get('600')).toBe(1)
		expect(result.has('601')).toBe(false)
		expect(result.size).toBe(1)
	})
})
