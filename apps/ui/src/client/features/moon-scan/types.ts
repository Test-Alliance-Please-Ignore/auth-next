export type MoonScanStatus = 'pending' | 'verified' | 'rejected'
export type MoonScanSource = 'user' | 'system'
export type LeaderboardWindow = 'all' | '7d' | '30d'
export type StructureType = 'tatara' | 'metenox'
export type OreRarity = 'R4' | 'R8' | 'R16' | 'R32' | 'R64'

export interface MoonScanOre {
	oreTypeId: string
	quantity: string
}

export interface ScanQueueOre extends MoonScanOre {
	oreTypeName: string
}

export interface MoonScan {
	id: string
	moonId: string
	submittedBy: string | null
	submittedByName: string | null
	submittedAt: string
	status: MoonScanStatus
	source: MoonScanSource
	verifiedBy: string | null
	verifiedAt: string | null
	notes: string | null
	ores: MoonScanOre[]
}

export interface ScanQueueEntry extends MoonScan {
	moonName: string
	submittedByName: string | null
	ores: ScanQueueOre[]
}

export interface VerifiedComposition {
	moonId: string
	sourceScanId: string
	verifiedAt: string
	verifiedBy: string | null
	verifiedByName: string | null
	ores: MoonScanOre[]
}

export interface LeaderboardEntry {
	characterId: string
	characterName: string
	scanCount: number
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

export interface PaginatedScans {
	items: MoonScan[]
	total: number
	page: number
	pageSize: number
}

export interface PaginatedScanQueue {
	items: ScanQueueEntry[]
	total: number
	page: number
	pageSize: number
}

// Region overview
export interface RegionSummary {
	regionId: string
	regionName: string
	systemCount: number
	moonCount: number
	scannedCount: number
	verifiedCount: number
}

export interface RegionConnection {
	fromRegionId: string
	toRegionId: string
}

export interface RegionsResponse {
	regions: RegionSummary[]
	connections: RegionConnection[]
}

// Region detail (for map rendering)
export interface RegionSystemEntry {
	solarSystemId: string
	solarSystemName: string
	securityStatus: string | null
	moonCount: number
	scannedCount: number
	verifiedCount: number
}

export interface JumpLink {
	from: string
	to: string
}

export interface RegionDetail {
	regionId: string
	systems: RegionSystemEntry[]
	jumpLinks: JumpLink[]
	borderRegions: Record<string, { regionId: string; regionName: string }>
}

export interface DotlanCoords {
	region: string
	viewbox: [number, number, number, number]
	systems: Record<string, [number, number]>
}

// System detail
export interface SystemInfo {
	solarSystemId: string
	solarSystemName: string
	securityStatus: string | null
}

export interface MoonEntry {
	moonId: string
	moonName: string
	hasScans: boolean
	isVerified: boolean
	composition: VerifiedComposition | null
}

export interface SystemDetail {
	system: SystemInfo
	moons: MoonEntry[]
}

// Moon detail
export interface StaticMoon {
	moonId: string
	moonName: string
	solarSystemId: string
	solarSystemName: string
}

export interface OreRefineProduct {
	materialTypeId: string
	materialName: string
	quantity: number
	batchSize: number
	batchQty: number
	unitSellPrice: string
	totalValue: string
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

export interface MoonDetail {
	moon: StaticMoon
	scans: MoonScan[]
	composition: VerifiedComposition | null
	profitability: MoonProfitability | null
}

// Scanned moons list
export interface ScannedMoonEntry {
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
	metenoxProfit: string | null
	tataraProfit: string | null
}

export interface ConstellationSummary {
	constellationId: string
	constellationName: string
}

export interface ScannedMoonsResponse {
	items: ScannedMoonEntry[]
	total: number
	page: number
	pageSize: number
	constellations: ConstellationSummary[]
	updatedAt: string
}

// Scan submission
export interface ParsedOre {
	oreTypeId: string
	quantity: number
}

export interface AnnotatedScan {
	moonId: string
	solarSystemId: string
	ores: ParsedOre[]
	secStatus: number | null
	eligible: boolean
}

export interface ParseResult {
	scans: AnnotatedScan[]
	errors: string[]
}

export interface SubmitResult {
	submitted: number
	autoVerified: number
	rejected: number
	parseErrors: string[]
	scans: MoonScan[]
}

// Admin
export interface AdminSettings {
	settings: ExtractionSettings
	profiles: StructureProfile[]
}
