import type { OreRarity } from './types'

export const RARITY_COLORS: Record<OreRarity, string> = {
	R4: '#6c757d',
	R8: '#0d6efd',
	R16: '#198754',
	R32: '#e8a33d',
	R64: '#dc3545',
}

const ORE_TYPE_RARITY: Record<string, OreRarity> = {
	// Moon ore type IDs
	'45490': 'R4', '45491': 'R4', '45492': 'R4', '45493': 'R4',
	'45494': 'R8', '45495': 'R8', '45496': 'R8', '45497': 'R8',
	'45498': 'R16', '45499': 'R16', '45500': 'R16', '45501': 'R16',
	'45502': 'R32', '45503': 'R32', '45504': 'R32', '45506': 'R32',
	'45510': 'R64', '45511': 'R64', '45512': 'R64', '45513': 'R64',
	// Moon goo material type IDs
	'16633': 'R4', '16634': 'R4', '16635': 'R4', '16636': 'R4',
	'16637': 'R8', '16638': 'R8', '16639': 'R8', '16640': 'R8',
	'16641': 'R16', '16642': 'R16', '16643': 'R16', '16644': 'R16',
	'16646': 'R32', '16647': 'R32', '16648': 'R32', '16649': 'R32',
	'16650': 'R64', '16651': 'R64', '16652': 'R64', '16653': 'R64',
}

export function getOreColor(oreTypeId: string): string {
	const rarity = ORE_TYPE_RARITY[oreTypeId]
	return rarity ? RARITY_COLORS[rarity] : '#555555'
}

export function getOreRarity(oreTypeId: string): OreRarity | undefined {
	return ORE_TYPE_RARITY[oreTypeId]
}
