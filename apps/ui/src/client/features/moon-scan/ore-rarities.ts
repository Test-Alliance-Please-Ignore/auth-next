import type { OreRarity } from './types'

export const RARITY_COLORS: Record<OreRarity, string> = {
	R4: '#6c757d',
	R8: '#0d6efd',
	R16: '#198754',
	R32: '#e8a33d',
	R64: '#dc3545',
}

const ORE_TYPE_RARITY: Record<string, OreRarity> = {
	'45490': 'R4', '45491': 'R4', '45492': 'R4', '45493': 'R4',
	'45494': 'R8', '45495': 'R8', '45496': 'R8', '45497': 'R8',
	'45498': 'R16', '45499': 'R16', '45500': 'R16', '45501': 'R16',
	'45502': 'R32', '45503': 'R32', '45504': 'R32', '45506': 'R32',
	'45510': 'R64', '45511': 'R64', '45512': 'R64', '45513': 'R64',
}

export function getOreColor(oreTypeId: string): string {
	const rarity = ORE_TYPE_RARITY[oreTypeId]
	return rarity ? RARITY_COLORS[rarity] : '#555555'
}

export function getOreRarity(oreTypeId: string): OreRarity | undefined {
	return ORE_TYPE_RARITY[oreTypeId]
}
