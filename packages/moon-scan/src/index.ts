import {
	FUEL_BLOCK_TYPE_ID,
	getOreVolume,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
} from './reprocessing'

export type { ParsedOre, ParsedScan, ParseResult } from './parser'
export { parseMoonScanTsv } from './parser'

export {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
	MOON_ORE_VOLUME_M3,
	getOreVolume,
	parseVolumeM3,
} from './reprocessing'

export type MoonScanStatus = 'pending' | 'verified' | 'rejected'
export type MoonScanSource = 'user' | 'system'
export type LeaderboardWindow = 'all' | '7d' | '30d'
export type StructureType = 'tatara' | 'metenox'
export type OreRarity = 'R4' | 'R8' | 'R16' | 'R32' | 'R64'
export type VerifiedMoonsSortBy =
	| 'moonName'
	| 'solarSystemName'
	| 'regionName'
	| 'securityStatus'
	| 'highestRarity'
	| 'metenoxProfit'
	| 'tataraProfit'

export interface VerifiedMoonSummary {
	moonId: string
	moonName: string
	solarSystemId: string
	solarSystemName: string
	regionId: string
	regionName: string
	constellationId: string
	constellationName: string
	securityStatus: string | null
	highestRarity: OreRarity | null
}

export interface VerifiedMoonSummaryRecord extends VerifiedMoonSummary {
	sourceScanId: string
	verifiedAt: string
	verifiedBy: string | null
}

export interface VerifiedMoonPage {
	items: Array<
		VerifiedMoonSummary & {
			metenoxProfit?: string | null
			tataraProfit?: string | null
		}
	>
	total: number
	page: number
	pageSize: number
	constellations: Array<{ constellationId: string; constellationName: string }>
}

export interface MoonProfitabilityQueryInputs {
	defaultReprocessingYield: string
	defaultCycleDays: number
	fuelBlockPriceOverride: string | null
	magmaticGasPriceOverride: string | null
	profiles: Array<{
		id: StructureType
		baseVolumePerHr: string
		rigBonus: string
		fuelPerHr: string
		magmaticGasPerHr: string | null
		nullsecModifier: string
		isPassive: boolean
	}>
	typeMaterials: Array<{
		oreTypeId: string
		materialTypeId: string
		quantity: number
	}>
	materialVolumes: Record<string, number | null>
	oreVolumes: Record<string, number>
	prices: Array<{
		typeId: string
		price: number
	}>
}

export interface VerifiedMoonRegionCount {
	regionId: string
	verifiedCount: number
}

const RARITY_BUCKETS: readonly OreRarity[] = ['R4', 'R8', 'R16', 'R32', 'R64']

function getRarityByIndex(index: number): OreRarity {
	const rarity = RARITY_BUCKETS[Math.floor(index / 4)]
	if (!rarity) throw new Error(`Unexpected moon ore rarity index: ${index}`)
	return rarity
}

function buildRarityMap(typeIds: readonly string[]): Record<string, OreRarity> {
	const map: Record<string, OreRarity> = {}
	typeIds.forEach((typeId, index) => {
		map[typeId] = getRarityByIndex(index)
	})
	return map
}

export const ORE_TYPE_RARITY: Record<string, OreRarity> = {
	...buildRarityMap(MOON_ORE_TYPE_IDS),
	...buildRarityMap(MOON_GOO_TYPE_IDS),
}

export const RARITY_ORDER: Record<OreRarity, number> = { R4: 1, R8: 2, R16: 3, R32: 4, R64: 5 }

export interface MoonScanOre {
	oreTypeId: string
	quantity: string
}

export interface MoonScan {
	id: string
	moonId: string
	regionId: string | null
	solarSystemId: string | null
	submittedBy: string | null
	submittedAt: string
	status: MoonScanStatus
	source: MoonScanSource
	verifiedBy: string | null
	verifiedAt: string | null
	notes: string | null
	ores: MoonScanOre[]
}

export interface ScanQueueOre extends MoonScanOre {
	oreTypeName: string
}

export interface ScanQueueEntry extends MoonScan {
	moonName: string
	submittedByName: string | null
	ores: ScanQueueOre[]
}

export interface PaginatedScanQueue {
	items: ScanQueueEntry[]
	total: number
	page: number
	pageSize: number
}

export interface VerifiedComposition {
	moonId: string
	sourceScanId: string
	verifiedAt: string
	verifiedBy: string | null
	ores: MoonScanOre[]
}

export interface LeaderboardEntry {
	characterId: string
	characterName: string
	scanCount: number
}

export interface MoonCoverageStat {
	moonId: string
	hasScans: boolean
	isVerified: boolean
}

export interface ExtractionSettings {
	defaultReprocessingYield: string
	defaultCycleDays: number
	fuelBlockPriceOverride: string | null
	magmaticGasPriceOverride: string | null
}

export interface StructureProfile {
	id: StructureType
	baseVolumePerHr: string
	rigBonus: string
	fuelPerHr: string
	magmaticGasPerHr: string | null
	minCycleDays: number | null
	maxCycleDays: number | null
	isPassive: boolean
	lowsecModifier: string
	nullsecModifier: string
}

export interface SubmitScanInput {
	moonId: string
	regionId: string
	solarSystemId: string
	ores: MoonScanOre[]
}

export interface ScanLocation {
	moonId: string
	regionId: string
	solarSystemId: string
}

export interface ScannedMoonRegionCount {
	regionId: string
	scannedCount: number
}

export interface ScanFilters {
	status?: MoonScanStatus
	moonId?: string
	submittedBy?: string
	page?: number
	pageSize?: number
}

export interface PaginatedScans {
	items: MoonScan[]
	total: number
	page: number
	pageSize: number
}

export interface OreRefineProduct {
	materialTypeId: string
	materialName: string
	quantity: number
	batchSize: number
	/** Per-100-unit batch output quantity from SDE typeMaterials */
	batchQty: number
	unitSellPrice: string
	totalValue: string
	/** Total output volume for this material during the calculated structure cycle. */
	volumeM3: number | null
	/** Output volume for the material's per-100-ore batch. */
	volumePer100M3: number | null
	/** Rarity of this material's source ore, for coloring the badge */
	materialRarity: string | null
}

export interface OreWithProfitability {
	oreTypeId: string
	oreName: string
	quantity: string
	/** Calculated raw ore units processed during the structure cycle. */
	oreUnits: number
	rarity: string | null
	refinesTo: OreRefineProduct[]
	totalOreValue: string
	/** Total raw ore volume for this ore during the calculated structure cycle. */
	oreVolumeM3: number
	/** Total refined-material volume for this ore during the calculated structure cycle. */
	volumeM3: number | null
}

export interface StructureProfitability {
	structureType: StructureType
	cycleDays: number
	grossIsk: string
	fuelCost: string
	magmaticGasCost: string | null
	profit: string
	ores: OreWithProfitability[]
}

export interface MoonProfitability {
	ores: OreWithProfitability[]
	structures: StructureProfitability[]
	updatedAt: string
	pricingSnapshotDate: string | null
}

/**
 * Calculate the profitability estimate for one structure profile from a
 * verified moon composition. Names are intentionally left as type IDs here;
 * callers that have universe data can resolve display names without making
 * the calculation depend on a second data source.
 */
export function calculateStructureProfitability(
	composition: VerifiedComposition,
	inputs: MoonProfitabilityQueryInputs,
	structureType: StructureType
): StructureProfitability | null {
	const profile = inputs.profiles.find((candidate) => candidate.id === structureType)
	if (!profile) return null

	const typeMaterials = new Map<
		string,
		Array<MoonProfitabilityQueryInputs['typeMaterials'][number]>
	>()
	for (const material of inputs.typeMaterials) {
		const materials = typeMaterials.get(material.oreTypeId) ?? []
		materials.push(material)
		typeMaterials.set(material.oreTypeId, materials)
	}

	const prices = new Map(inputs.prices.map((price) => [price.typeId, price.price]))
	const reprocessingYield = Number.parseFloat(inputs.defaultReprocessingYield)
	const cycleHours = (profile.isPassive ? 1 : inputs.defaultCycleDays) * 24
	const baseVolumePerHour = Number.parseFloat(profile.baseVolumePerHr)
	const rigBonus = Number.parseFloat(profile.rigBonus)
	const securityModifier = profile.isPassive ? Number.parseFloat(profile.nullsecModifier) : 1
	const totalVolume = baseVolumePerHour * (1 + rigBonus) * securityModifier * cycleHours

	const ores = composition.ores
		.map((ore) => {
			const configuredOreVolume = inputs.oreVolumes[ore.oreTypeId]
			const oreVolumeM3 =
				Number.isFinite(configuredOreVolume) && configuredOreVolume > 0
					? configuredOreVolume
					: getOreVolume(ore.oreTypeId)
			const oreUnits = (totalVolume * Number.parseFloat(ore.quantity)) / oreVolumeM3
			const refinesTo = (typeMaterials.get(ore.oreTypeId) ?? [])
				.filter(
					(material) => !(profile.isPassive && ['35', '36'].includes(material.materialTypeId))
				)
				.map((material) => {
					const units = Math.floor(
						Math.floor(oreUnits / 100) * material.quantity * reprocessingYield
					)
					const unitSellPrice = prices.get(material.materialTypeId) ?? 0
					const unitVolumeM3 = inputs.materialVolumes[material.materialTypeId] ?? null
					return {
						materialTypeId: material.materialTypeId,
						materialName: material.materialTypeId,
						quantity: units,
						batchSize: 100,
						batchQty: material.quantity,
						unitSellPrice: String(unitSellPrice),
						totalValue: String(units * unitSellPrice),
						volumeM3: unitVolumeM3 === null ? null : units * unitVolumeM3,
						volumePer100M3: unitVolumeM3 === null ? null : material.quantity * unitVolumeM3,
						materialRarity: null,
					}
				})
			const totalOreValue = refinesTo.reduce(
				(sum, material) => sum + Number(material.totalValue),
				0
			)
			return {
				oreTypeId: ore.oreTypeId,
				oreName: ore.oreTypeId,
				quantity: ore.quantity,
				oreUnits: Math.floor(oreUnits),
				rarity: ORE_TYPE_RARITY[ore.oreTypeId] ?? null,
				refinesTo,
				totalOreValue: String(totalOreValue),
				oreVolumeM3: totalVolume * Number.parseFloat(ore.quantity),
				volumeM3: refinesTo.some((material) => material.volumeM3 === null)
					? null
					: refinesTo.reduce((sum, material) => sum + (material.volumeM3 ?? 0), 0),
			}
		})
		.sort(
			(left, right) =>
				(RARITY_ORDER[right.rarity as OreRarity] ?? 0) -
				(RARITY_ORDER[left.rarity as OreRarity] ?? 0)
		)

	const grossIsk = ores.reduce((sum, ore) => sum + Number(ore.totalOreValue), 0)
	const fuelUnits = Number.parseFloat(profile.fuelPerHr) * cycleHours
	const magmaticGasUnits = profile.isPassive
		? Number.parseFloat(profile.magmaticGasPerHr ?? '0') * cycleHours
		: 0
	const fuelPriceOverride = Number.parseFloat(inputs.fuelBlockPriceOverride ?? '')
	const magmaticGasPriceOverride = Number.parseFloat(inputs.magmaticGasPriceOverride ?? '')
	const fuelPrice =
		fuelPriceOverride > 0 ? fuelPriceOverride : (prices.get(FUEL_BLOCK_TYPE_ID) ?? 0)
	const magmaticGasPrice =
		magmaticGasPriceOverride > 0
			? magmaticGasPriceOverride
			: (prices.get(MAGMATIC_GAS_TYPE_ID) ?? 0)
	const fuelCost = fuelUnits * fuelPrice
	const magmaticGasCost = magmaticGasUnits * magmaticGasPrice

	return {
		structureType,
		cycleDays: profile.isPassive ? 1 : inputs.defaultCycleDays,
		grossIsk: String(Math.round(grossIsk)),
		fuelCost: String(Math.round(fuelCost)),
		magmaticGasCost: profile.isPassive ? String(Math.round(magmaticGasCost)) : null,
		profit: String(Math.round(grossIsk - fuelCost - magmaticGasCost)),
		ores,
	}
}

export interface MoonScanDO {
	// Scans
	submitScans(
		scans: SubmitScanInput[],
		submittedBy: string | null,
		autoVerify: boolean
	): Promise<MoonScan[]>
	getScans(filters: ScanFilters): Promise<PaginatedScans>
	getScan(scanId: string): Promise<MoonScan | null>
	verifyScan(scanId: string, verifiedBy: string, notes: string | null): Promise<MoonScan>
	verifyScans(scanIds: string[], verifiedBy: string, notes: string | null): Promise<MoonScan[]>
	rejectScan(scanId: string, verifiedBy: string, notes: string | null): Promise<MoonScan>
	rejectScans(scanIds: string[], verifiedBy: string, notes: string | null): Promise<MoonScan[]>
	// Verified compositions
	getVerifiedComposition(moonId: string): Promise<VerifiedComposition | null>
	getVerifiedCompositions(moonIds: string[]): Promise<VerifiedComposition[]>
	getVerifiedCompositionsBySystem(systemId: string): Promise<VerifiedComposition[]>
	// Verified moon read model
	getVerifiedMoonPage(filters: {
		page: number
		pageSize: number
		regionId?: string
		constellationId?: string
		rarity?: OreRarity[]
		search?: string
		sortBy: VerifiedMoonsSortBy
		sortDir: 'asc' | 'desc'
		profitability?: MoonProfitabilityQueryInputs
	}): Promise<VerifiedMoonPage>
	getVerifiedMoonSummaryIds(): Promise<string[]>
	upsertVerifiedMoonSummaries(summaries: VerifiedMoonSummaryRecord[]): Promise<void>
	getVerifiedMoonCountsByRegionIds(regionIds: string[]): Promise<VerifiedMoonRegionCount[]>
	// Leaderboard
	getLeaderboard(window: LeaderboardWindow): Promise<LeaderboardEntry[]>
	// Stats for map
	getScannedMoonCountsByRegionIds(regionIds: string[]): Promise<ScannedMoonRegionCount[]>
	getUnlocatedScannedMoonIds(limit: number, afterMoonId?: string): Promise<string[]>
	backfillScanLocations(locations: ScanLocation[]): Promise<void>
	getScanSummary(): Promise<{ scannedMoonIds: string[]; verifiedMoonIds: string[] }>
	getMoonCoverage(moonIds: string[]): Promise<MoonCoverageStat[]>
	// Character name resolution
	resolveCharacterNames(characterIds: string[]): Promise<Record<string, string>>
	// Admin
	getExtractionSettings(): Promise<ExtractionSettings>
	updateExtractionSettings(settings: Partial<ExtractionSettings>): Promise<ExtractionSettings>
	getStructureProfiles(): Promise<StructureProfile[]>
	updateStructureProfile(
		id: StructureType,
		profile: Partial<StructureProfile>
	): Promise<StructureProfile>
	cacheCharacterName(characterId: string, name: string): Promise<void>
}
