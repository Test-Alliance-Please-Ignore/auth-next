import {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
} from '@repo/universe'

// Re-export canonical moon extraction IDs from @repo/universe.
export {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
}

// All moon ores have the same volume — not stored in the SDE
export const MOON_ORE_VOLUME_M3 = 10

export function getOreVolume(_oreTypeId: string): number {
	return MOON_ORE_VOLUME_M3
}
