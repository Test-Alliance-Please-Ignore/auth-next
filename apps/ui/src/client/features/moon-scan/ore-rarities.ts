import type { OreRarity } from './types'
import { ORE_TYPE_RARITY } from '@repo/moon-scan'

export const RARITY_COLORS: Record<OreRarity, string> = {
	R4: '#6c757d',
	R8: '#0d6efd',
	R16: '#198754',
	R32: '#e8a33d',
	R64: '#dc3545',
}

export function getOreColor(oreTypeId: string): string {
	const rarity = ORE_TYPE_RARITY[oreTypeId]
	return rarity ? RARITY_COLORS[rarity] : '#555555'
}

export function getOreRarity(oreTypeId: string): OreRarity | undefined {
	return ORE_TYPE_RARITY[oreTypeId]
}
