// Static EVE moon ore reprocessing data. Quantities at base (per 100 units).
// Actual yield = floor(oreUnits / batchSize) * quantity * reprocessingYield

export interface OreReprocessingOutput {
	materialTypeId: string
	materialName: string
	quantity: number
	batchSize: number
}

export interface OreStaticData {
	oreName: string
	volumeM3: number // m³ per unit
	outputs: OreReprocessingOutput[]
}

// Fuel block type IDs (Nitrogen, the most common in null/low)
export const FUEL_BLOCK_TYPE_ID = '4247'
export const MAGMATIC_GAS_TYPE_ID = '81143'

const MOON_ORE_DATA: Record<string, OreStaticData> = {
	// ─── R4 ──────────────────────────────────────────────────────────────────
	// Bitumens
	'45490': {
		oreName: 'Bitumens',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 6000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16633', materialName: 'Hydrocarbons', quantity: 65, batchSize: 100 },
		],
	},
	// Coesite
	'45491': {
		oreName: 'Coesite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16634', materialName: 'Silicates', quantity: 65, batchSize: 100 },
		],
	},
	// Sylvite
	'45492': {
		oreName: 'Sylvite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16635', materialName: 'Evaporite Deposits', quantity: 65, batchSize: 100 },
		],
	},
	// Zeolites
	'45493': {
		oreName: 'Zeolites',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16636', materialName: 'Atmospheric Gases', quantity: 65, batchSize: 100 },
		],
	},

	// ─── R8 ──────────────────────────────────────────────────────────────────
	// Cobaltite
	'45494': {
		oreName: 'Cobaltite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16637', materialName: 'Cobalt', quantity: 40, batchSize: 100 },
		],
	},
	// Euxenite
	'45495': {
		oreName: 'Euxenite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16638', materialName: 'Scandium', quantity: 40, batchSize: 100 },
		],
	},
	// Titanite
	'45496': {
		oreName: 'Titanite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16639', materialName: 'Titanium', quantity: 40, batchSize: 100 },
		],
	},
	// Scheelite
	'45497': {
		oreName: 'Scheelite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16640', materialName: 'Tungsten', quantity: 40, batchSize: 100 },
		],
	},

	// ─── R16 ─────────────────────────────────────────────────────────────────
	// Otavite
	'45498': {
		oreName: 'Otavite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16641', materialName: 'Cadmium', quantity: 15, batchSize: 100 },
		],
	},
	// Sperrylite
	'45499': {
		oreName: 'Sperrylite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16642', materialName: 'Platinum', quantity: 15, batchSize: 100 },
		],
	},
	// Vanadinite
	'45500': {
		oreName: 'Vanadinite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16643', materialName: 'Vanadium', quantity: 15, batchSize: 100 },
		],
	},
	// Chromite
	'45501': {
		oreName: 'Chromite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '35', materialName: 'Pyerite', quantity: 2000, batchSize: 100 },
			{ materialTypeId: '36', materialName: 'Mexallon', quantity: 400, batchSize: 100 },
			{ materialTypeId: '16644', materialName: 'Chromium', quantity: 15, batchSize: 100 },
		],
	},

	// ─── R32 ─────────────────────────────────────────────────────────────────
	// Carnotite
	'45502': {
		oreName: 'Carnotite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16636', materialName: 'Atmospheric Gases', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16637', materialName: 'Cobalt', quantity: 10, batchSize: 100 },
			{ materialTypeId: '16648', materialName: 'Technetium', quantity: 50, batchSize: 100 },
		],
	},
	// Zircon
	'45503': {
		oreName: 'Zircon',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16636', materialName: 'Atmospheric Gases', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16638', materialName: 'Scandium', quantity: 10, batchSize: 100 },
			{ materialTypeId: '16649', materialName: 'Hafnium', quantity: 50, batchSize: 100 },
		],
	},
	// Pollucite
	'45504': {
		oreName: 'Pollucite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16634', materialName: 'Silicates', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16639', materialName: 'Titanium', quantity: 10, batchSize: 100 },
			{ materialTypeId: '16650', materialName: 'Caesium', quantity: 50, batchSize: 100 },
		],
	},
	// Loparite
	'45506': {
		oreName: 'Loparite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16635', materialName: 'Evaporite Deposits', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16640', materialName: 'Tungsten', quantity: 10, batchSize: 100 },
			{ materialTypeId: '16651', materialName: 'Promethium', quantity: 50, batchSize: 100 },
		],
	},

	// ─── R64 ─────────────────────────────────────────────────────────────────
	// Xenotime
	'45510': {
		oreName: 'Xenotime',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16641', materialName: 'Cadmium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16644', materialName: 'Chromium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16652', materialName: 'Dysprosium', quantity: 50, batchSize: 100 },
		],
	},
	// Monazite
	'45511': {
		oreName: 'Monazite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16642', materialName: 'Platinum', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16648', materialName: 'Technetium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16653', materialName: 'Neodymium', quantity: 50, batchSize: 100 },
		],
	},
	// Ytterbite
	'45512': {
		oreName: 'Ytterbite',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16643', materialName: 'Vanadium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16649', materialName: 'Hafnium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16654', materialName: 'Thulium', quantity: 50, batchSize: 100 },
		],
	},
	// Cinnabar
	'45513': {
		oreName: 'Cinnabar',
		volumeM3: 10,
		outputs: [
			{ materialTypeId: '16633', materialName: 'Hydrocarbons', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16650', materialName: 'Caesium', quantity: 15, batchSize: 100 },
			{ materialTypeId: '16655', materialName: 'Mercury', quantity: 50, batchSize: 100 },
		],
	},
}

export function getMoonOreData(oreTypeId: string): OreStaticData | undefined {
	return MOON_ORE_DATA[oreTypeId]
}

/** All unique material type IDs across all moon ore reprocessing outputs */
export function getAllMaterialTypeIds(): string[] {
	const ids = new Set<string>()
	for (const ore of Object.values(MOON_ORE_DATA)) {
		for (const output of ore.outputs) {
			ids.add(output.materialTypeId)
		}
	}
	return Array.from(ids)
}
