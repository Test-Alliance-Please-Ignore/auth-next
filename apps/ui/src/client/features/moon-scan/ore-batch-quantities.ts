// Per-100-unit reprocessing output quantities for each moon ore type.
// Mirrors the static data in packages/moon-scan/src/reprocessing.ts.
// Key: oreTypeId → materialTypeId → quantity per 100 units
const ORE_BATCH_QTY: Record<string, Record<string, number>> = {
	// R4
	'45490': { '35': 6000, '36': 400, '16633': 65 },  // Bitumens
	'45491': { '35': 2000, '36': 400, '16634': 65 },  // Coesite
	'45492': { '35': 2000, '36': 400, '16635': 65 },  // Sylvite
	'45493': { '35': 2000, '36': 400, '16636': 65 },  // Zeolites
	// R8
	'45494': { '35': 2000, '36': 400, '16637': 40 },  // Cobaltite
	'45495': { '35': 2000, '36': 400, '16638': 40 },  // Euxenite
	'45496': { '35': 2000, '36': 400, '16639': 40 },  // Titanite
	'45497': { '35': 2000, '36': 400, '16640': 40 },  // Scheelite
	// R16
	'45498': { '35': 2000, '36': 400, '16641': 15 },  // Otavite
	'45499': { '35': 2000, '36': 400, '16642': 15 },  // Sperrylite
	'45500': { '35': 2000, '36': 400, '16643': 15 },  // Vanadinite
	'45501': { '35': 2000, '36': 400, '16644': 15 },  // Chromite
	// R32
	'45502': { '16636': 15, '16637': 10, '16648': 50 },  // Carnotite
	'45503': { '16636': 15, '16638': 10, '16649': 50 },  // Zircon
	'45504': { '16634': 15, '16639': 10, '16650': 50 },  // Pollucite
	'45506': { '16635': 15, '16640': 10, '16651': 50 },  // Loparite
	// R64
	'45510': { '16641': 15, '16644': 15, '16652': 50 },  // Xenotime
	'45511': { '16642': 15, '16648': 15, '16653': 50 },  // Monazite
	'45512': { '16643': 15, '16649': 15, '16654': 50 },  // Ytterbite
	'45513': { '16633': 15, '16650': 15, '16655': 50 },  // Cinnabar
}

export function getBatchQuantity(oreTypeId: string, materialTypeId: string): number {
	return ORE_BATCH_QTY[oreTypeId]?.[materialTypeId] ?? 0
}
