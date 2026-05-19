import { describe, expect, it } from 'vitest'

import { MOON_GOO_TYPE_IDS, MOON_ORE_TYPE_IDS, ORE_TYPE_RARITY } from '@repo/moon-scan'

import type { OreRarity } from '@repo/moon-scan'

function countByRarity(rarity: OreRarity): number {
	return Object.values(ORE_TYPE_RARITY).filter((value) => value === rarity).length
}

describe('moon scan ore rarity map', () => {
	it('covers every canonical moon ore and moon goo type id', () => {
		const ids = new Set([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])
		for (const typeId of ids) {
			expect(ORE_TYPE_RARITY[typeId]).toBeDefined()
		}
	})

	it('has no rarity keys outside canonical moon type ids', () => {
		const canonicalIds = new Set<string>([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])
		for (const typeId of Object.keys(ORE_TYPE_RARITY)) {
			expect(canonicalIds.has(typeId)).toBe(true)
		}
	})

	it('keeps an even rarity distribution across canonical ids', () => {
		expect(countByRarity('R4')).toBe(8)
		expect(countByRarity('R8')).toBe(8)
		expect(countByRarity('R16')).toBe(8)
		expect(countByRarity('R32')).toBe(8)
		expect(countByRarity('R64')).toBe(8)
	})
})
