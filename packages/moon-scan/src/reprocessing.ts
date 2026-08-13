import {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
} from '@repo/universe'

// Re-export canonical moon extraction IDs from @repo/universe.
export { FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID, MOON_GOO_TYPE_IDS, MOON_ORE_TYPE_IDS }

// Defensive fallback for older or incomplete universe data. Current SDE rows
// define all moon ores as 10 m3 per unit, and callers prefer those values.
export const MOON_ORE_VOLUME_M3 = 10

export function getOreVolume(_oreTypeId: string): number {
	return MOON_ORE_VOLUME_M3
}

/** Parse an SDE volume while rejecting missing, invalid, and non-positive values. */
export function parseVolumeM3(
	value: string | number | null | undefined,
	fallback: number | null = null
): number | null {
	const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
