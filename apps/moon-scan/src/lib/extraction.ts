import type { MoonScanOre, StructureProfile, StructureType } from '@repo/moon-scan'

export interface ExtractionInput {
	structureType: StructureType
	profile: StructureProfile
	secStatus: number // raw stored value, e.g. -0.3 nullsec, 0.3 lowsec
	cycleDays: number // ignored for Metenox (always 24h)
	reprocessingYield: number // 0.0–1.0
	ores: MoonScanOre[]
	// typeId → m³ per unit (from Universe DO)
	oreVolumes: Record<string, number>
	// typeId → [{ materialTypeId, quantity per batch, batchSize }]
	reprocessingMap: Record<string, Array<{ materialTypeId: string; quantity: number; batchSize: number }>>
	// typeId → ISK sell price (from Markets worker)
	materialPrices: Record<string, number>
	fuelBlockPrice: number
	magmaticGasPrice: number
}

export interface MaterialResult {
	materialTypeId: string
	units: number
	valueIsk: number
}

export interface OreResult {
	oreTypeId: string
	quantity: string // fraction, e.g. "0.252453"
	volumeM3: number
	units: number
	materials: MaterialResult[]
	totalValueIsk: number
}

export interface ExtractionResult {
	ores: OreResult[]
	totalValueIsk: number
	fuelCostIsk: number
	magmaticGasCostIsk: number
	profitIsk: number
	cycleHours: number
	// true for Metenox (24h), false for Athanor/Tatara (cycle-based)
	isPassive: boolean
}

// Mineral group ID — excluded from Metenox output
const MINERAL_GROUP_ID = 18

export function calculateExtraction(input: ExtractionInput): ExtractionResult {
	const {
		profile,
		secStatus,
		cycleDays,
		reprocessingYield,
		ores,
		oreVolumes,
		reprocessingMap,
		materialPrices,
		fuelBlockPrice,
		magmaticGasPrice,
	} = input

	const baseVolumePerHr = parseFloat(profile.baseVolumePerHr)
	const rigBonus = parseFloat(profile.rigBonus)
	const fuelPerHr = parseFloat(profile.fuelPerHr)
	const magmaticGasPerHr = profile.magmaticGasPerHr ? parseFloat(profile.magmaticGasPerHr) : 0
	const baseRate = baseVolumePerHr * (1 + rigBonus)

	let totalVolume: number
	let cycleHours: number
	let fuelUnits: number
	let magmaticGasUnits: number

	if (profile.isPassive) {
		// Metenox: always 24h, with sec status modifier
		const secModifier = secStatus < 0 ? parseFloat(profile.nullsecModifier) : parseFloat(profile.lowsecModifier)
		cycleHours = 24
		totalVolume = baseRate * secModifier * cycleHours
		fuelUnits = fuelPerHr * cycleHours
		magmaticGasUnits = magmaticGasPerHr * cycleHours
	} else {
		// Athanor / Tatara: cycle-based
		const minDays = profile.minCycleDays ?? 1
		const maxDays = profile.maxCycleDays ?? 56
		const clampedDays = Math.max(minDays, Math.min(maxDays, cycleDays))
		cycleHours = clampedDays * 24
		totalVolume = baseRate * cycleHours
		fuelUnits = fuelPerHr * cycleHours
		magmaticGasUnits = 0
	}

	const oreResults: OreResult[] = []

	for (const ore of ores) {
		const fraction = parseFloat(ore.quantity)
		const oreVolumeM3 = totalVolume * fraction
		const unitVolume = oreVolumes[ore.oreTypeId] ?? 0
		const oreUnits = unitVolume > 0 ? oreVolumeM3 / unitVolume : 0

		const materials: MaterialResult[] = []
		const repMap = reprocessingMap[ore.oreTypeId] ?? []

		for (const mat of repMap) {
			// Metenox skips minerals (group 18 check is done by caller passing filtered repMap,
			// or we can check a groupId field — for now caller passes the full map and we trust it)
			const rawUnits = Math.floor(oreUnits / mat.batchSize) * mat.quantity * reprocessingYield
			const units = Math.floor(rawUnits)
			const price = materialPrices[mat.materialTypeId] ?? 0
			const valueIsk = units * price
			materials.push({ materialTypeId: mat.materialTypeId, units, valueIsk })
		}

		const totalValueIsk = materials.reduce((sum, m) => sum + m.valueIsk, 0)

		oreResults.push({
			oreTypeId: ore.oreTypeId,
			quantity: ore.quantity,
			volumeM3: oreVolumeM3,
			units: Math.floor(oreUnits),
			materials,
			totalValueIsk,
		})
	}

	const totalValueIsk = oreResults.reduce((sum, o) => sum + o.totalValueIsk, 0)
	const fuelCostIsk = fuelUnits * fuelBlockPrice
	const magmaticGasCostIsk = magmaticGasUnits * magmaticGasPrice
	const profitIsk = totalValueIsk - fuelCostIsk - magmaticGasCostIsk

	return {
		ores: oreResults,
		totalValueIsk,
		fuelCostIsk,
		magmaticGasCostIsk,
		profitIsk,
		cycleHours,
		isPassive: profile.isPassive,
	}
}
