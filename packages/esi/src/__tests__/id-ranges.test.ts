import { describe, expect, it } from 'vitest'

import {
	getIdClassification,
	isStructureId,
	MAX_STRUCTURE_ID,
	MIN_STRUCTURE_ID,
} from '../id-ranges'

describe('getIdClassification', () => {
	it('classifies structure IDs at the documented boundaries', () => {
		const minResult = getIdClassification(MIN_STRUCTURE_ID)
		const maxResult = getIdClassification(MAX_STRUCTURE_ID)

		expect(minResult).toMatchObject({
			type: 'structure',
			range: { from: MIN_STRUCTURE_ID, to: MAX_STRUCTURE_ID },
		})
		expect(maxResult).toMatchObject({
			type: 'structure',
			range: { from: MIN_STRUCTURE_ID, to: MAX_STRUCTURE_ID },
		})
	})

	it('classifies well-known entity types (stations, regions, etc.)', () => {
		const stationResult = getIdClassification(60_000_123)
		const regionResult = getIdClassification(10_500_000)

		expect(stationResult.type).toBe('station')
		expect(stationResult.description).toMatch(/Stations/)

		expect(regionResult.type).toBe('region')
		expect(regionResult.description).toMatch(/Regions/)
	})

	it('returns invalid for non-numeric input', () => {
		const result = getIdClassification('  ')
		expect(result.type).toBe('invalid')
	})

	it('returns unknown for IDs outside documented ranges', () => {
		const result = getIdClassification(MAX_STRUCTURE_ID + 1)
		expect(result.type).toBe('unknown')
	})
})

describe('isStructureId', () => {
	it('returns true for IDs inside the structure range', () => {
		expect(isStructureId(MIN_STRUCTURE_ID)).toBe(true)
		expect(isStructureId(MIN_STRUCTURE_ID + 42)).toBe(true)
		expect(isStructureId(MAX_STRUCTURE_ID)).toBe(true)
	})

	it('returns false for IDs outside the structure range', () => {
		expect(isStructureId(MIN_STRUCTURE_ID - 1)).toBe(false)
		expect(isStructureId(MAX_STRUCTURE_ID + 1)).toBe(false)
		expect(isStructureId('not-a-number')).toBe(false)
	})
})
