import { MOON_GOO_TYPE_IDS, MOON_ORE_TYPE_IDS } from './reprocessing'

export type { ParsedOre, ParsedScan, ParseResult } from './parser'
export { parseMoonScanTsv } from './parser'

export { FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID, MOON_GOO_TYPE_IDS, MOON_ORE_TYPE_IDS, MOON_ORE_VOLUME_M3, getOreVolume } from './reprocessing'

export type MoonScanStatus = 'pending' | 'verified' | 'rejected'
export type MoonScanSource = 'user' | 'system'
export type LeaderboardWindow = 'all' | '7d' | '30d'
export type StructureType = 'tatara' | 'metenox'
export type OreRarity = 'R4' | 'R8' | 'R16' | 'R32' | 'R64'

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
	ores: MoonScanOre[]
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
	/** Rarity of this material's source ore, for coloring the badge */
	materialRarity: string | null
}

export interface OreWithProfitability {
	oreTypeId: string
	oreName: string
	quantity: string
	rarity: string | null
	refinesTo: OreRefineProduct[]
	totalOreValue: string
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
}

export interface MoonScanDO {
	// Scans
	submitScans(scans: SubmitScanInput[], submittedBy: string | null, autoVerify: boolean): Promise<MoonScan[]>
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
	// Leaderboard
	getLeaderboard(window: LeaderboardWindow): Promise<LeaderboardEntry[]>
	// Stats for map
	getScanSummary(): Promise<{ scannedMoonIds: string[]; verifiedMoonIds: string[] }>
	getMoonCoverage(moonIds: string[]): Promise<MoonCoverageStat[]>
	// Character name resolution
	resolveCharacterNames(characterIds: string[]): Promise<Record<string, string>>
	// Admin
	getExtractionSettings(): Promise<ExtractionSettings>
	updateExtractionSettings(settings: Partial<ExtractionSettings>): Promise<ExtractionSettings>
	getStructureProfiles(): Promise<StructureProfile[]>
	updateStructureProfile(id: StructureType, profile: Partial<StructureProfile>): Promise<StructureProfile>
	cacheCharacterName(characterId: string, name: string): Promise<void>
}
