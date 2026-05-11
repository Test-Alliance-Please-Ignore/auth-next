// Moon ore static metadata. Reprocessing outputs and quantities come from the
// SDE typeMaterials table via getTypeMaterials() — not hardcoded here.

export const FUEL_BLOCK_TYPE_ID = '4247'
export const MAGMATIC_GAS_TYPE_ID = '81143'

// All moon ore type IDs by rarity tier (from SDE invTypes)
export const MOON_ORE_TYPE_IDS = [
	// R4
	'45490', '45491', '45492', '45493',
	// R8
	'45494', '45495', '45496', '45497',
	// R16
	'45498', '45499', '45500', '45501',
	// R32
	'45502', '45503', '45504', '45506',
	// R64
	'45510', '45511', '45512', '45513',
]

// All moon goo material type IDs by rarity tier (from SDE typeMaterials)
export const MOON_GOO_TYPE_IDS = [
	// R4
	'16633', '16634', '16635', '16636',
	// R8
	'16637', '16638', '16639', '16640',
	// R16
	'16641', '16642', '16643', '16644',
	// R32
	'16646', '16647', '16648', '16649',
	// R64
	'16650', '16651', '16652', '16653',
]

// All moon ores have the same volume — not stored in the SDE
export const MOON_ORE_VOLUME_M3 = 10

export function getOreVolume(_oreTypeId: string): number {
	return MOON_ORE_VOLUME_M3
}
