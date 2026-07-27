import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { logger, TimeCache } from '@repo/hono-helpers'
import {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
	ORE_TYPE_RARITY,
	RARITY_ORDER,
	getOreVolume,
	parseMoonScanTsv,
	type PaginatedScanQueue,
	type MoonScan,
	type MoonScanDO,
	type ScanQueueEntry,
	type MoonProfitability,
	type MoonProfitabilityQueryInputs,
	type OreRarity,
	type OreWithProfitability,
	type VerifiedMoonSummaryRecord,
	type VerifiedMoonsSortBy,
	type StructureProfitability,
	type VerifiedComposition,
	type ScanLocation,
} from '@repo/moon-scan'
import { buildCsvLine, createR2MultipartTextWriter } from '@repo/worker-utils'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { isExportArtifactExpired } from '../lib/export-retention'
import { normalizeWorkflowStatus } from '../lib/workflow-status'
import { requireAllianceMember } from '../middleware/session'

import { createEveRegionId, createEveTypeId } from '@repo/eve-types'
import type { Markets } from '@repo/markets'
import type { Universe, UniverseSolarSystem } from '@repo/universe'
import type { App } from '../context'
import { createWorkflow } from '@repo/workflow-utils'

// ─── Permission URNs ─────────────────────────────────────────────────────────

const MOON_URNS = {
	view: 'urn:moons:view',
	submit: 'urn:moons:scan:submit',
	validate: 'urn:moons:scan:validate',
	admin: 'urn:moons:admin',
} as const

const MOON_ACCESS_LEVELS = {
	submit: 0,
	view: 1,
	validate: 2,
	admin: 3,
} as const

// Region IDs to exclude from the moon map (non-k-space)
// Wormhole regions: all IDs starting with '110' (11000xxx)
// Pochven (Triglavian): 10000070
const EXCLUDED_REGION_IDS = new Set(['10000070'])
function isKSpaceRegion(regionId: string): boolean {
	if (EXCLUDED_REGION_IDS.has(regionId)) return false
	if (regionId.startsWith('11')) return false // wormhole regions
	return true
}

// Security status threshold: raw stored value < 0.6 is eligible for moon mining
const SEC_STATUS_THRESHOLD = 0.6
const MAX_SCAN_RAW_BYTES = 1_000_000

// ─── Caches ──────────────────────────────────────────────────────────────────

const permissionCache = new TimeCache<boolean>(15_000)
const MOON_PRICING_REVISION_CACHE_TTL_MS = 60_000
const MOON_PRICING_INPUTS_CACHE_TTL_MS = 60 * 60_000
const VERIFIED_MOONS_RESPONSE_CACHE_TTL_MS = 10 * 60_000
const MOON_REGIONS_RESPONSE_CACHE_TTL_MS = 5 * 60_000
const MOON_REGION_RESPONSE_CACHE_TTL_MS = 60_000
const MOON_SYSTEM_RESPONSE_CACHE_TTL_MS = 60_000
const MOON_LEADERBOARD_CACHE_TTL_MS = 60_000
const MOON_SYSTEM_LOCATION_CACHE_TTL_MS = 24 * 60 * 60_000
const MOON_SYSTEM_LOCATION_CACHE_MAX_SIZE = 10_000
const VERIFIED_MOON_SUMMARY_BACKFILL_BATCH_SIZE = 250
const VERIFIED_MOONS_EXPORT_PAGE_SIZE = 100
const VERIFIED_MOONS_EXPORT_BUCKET_PREFIX = 'moon-scan/verified-moons-exports'

export type VerifiedMoonsExportQuery = Pick<
	z.infer<typeof VerifiedMoonsQuerySchema>,
	'regionId' | 'constellationId' | 'rarity' | 'search'
>

// Minerals that Metenox does NOT output (only moon goo materials)
const MINERAL_TYPE_IDS = new Set(['35', '36'])
const ALLOWED_MOON_SCAN_ORE_TYPE_IDS = new Set<string>([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])
const ALL_MOON_SCAN_PRICING_TYPE_IDS = [...new Set([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])]

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function hasMoonPerm(
	env: App['Bindings'],
	userId: string,
	urn: string,
	isAdmin: boolean
): Promise<boolean> {
	if (isAdmin) return true
	const cacheKey = `moon-perm:${userId}:${urn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const perms = await getCachedUserPermissions(env, userId)
		let accessLevel = -1
		for (const permission of perms) {
			switch (permission.urn) {
				case MOON_URNS.submit:
					accessLevel = Math.max(accessLevel, MOON_ACCESS_LEVELS.submit)
					break
				case MOON_URNS.view:
					accessLevel = Math.max(accessLevel, MOON_ACCESS_LEVELS.view)
					break
				case MOON_URNS.validate:
					accessLevel = Math.max(accessLevel, MOON_ACCESS_LEVELS.validate)
					break
				case MOON_URNS.admin:
					accessLevel = Math.max(accessLevel, MOON_ACCESS_LEVELS.admin)
					break
			}
		}

		switch (urn) {
			case MOON_URNS.submit:
				return accessLevel >= MOON_ACCESS_LEVELS.submit
			case MOON_URNS.view:
				return accessLevel >= MOON_ACCESS_LEVELS.view
			case MOON_URNS.validate:
				return accessLevel >= MOON_ACCESS_LEVELS.validate
			case MOON_URNS.admin:
				return accessLevel >= MOON_ACCESS_LEVELS.admin
			default:
				return perms.some((p) => p.urn === urn)
		}
	})
}

function getMoonScanStub(env: App['Bindings']): MoonScanDO {
	return getStub<MoonScanDO>(env.MOON_SCAN, 'default')
}

function getUniverseStub(env: App['Bindings']): Universe {
	return getStub<Universe>(env.UNIVERSE, 'default')
}

function resolveEffectivePrice(override: string | null | undefined, livePrice: number): number {
	if (override === null || override === undefined) return livePrice
	const parsed = Number.parseFloat(override)
	if (Number.isNaN(parsed) || parsed <= 0) return livePrice
	return parsed
}

function isRawPayloadTooLarge(raw: string): boolean {
	return new TextEncoder().encode(raw).length > MAX_SCAN_RAW_BYTES
}

function parseSecurityStatus(secStatus: string | null | undefined): number | null {
	if (secStatus == null) return null
	// Normalize potential unicode minus signs and trim whitespace.
	const normalized = secStatus.replace(/[−–—]/g, '-').trim()
	if (normalized.length === 0) return null
	const value = Number.parseFloat(normalized)
	return Number.isFinite(value) ? value : null
}

function isMoonMiningEligibleSecurity(secStatus: string | null | undefined): boolean {
	const parsed = parseSecurityStatus(secStatus)
	return parsed !== null && parsed < SEC_STATUS_THRESHOLD
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size) as T[])
	}
	return chunks
}

function getExecutionContextOrNull(c: { executionCtx?: ExecutionContext }): ExecutionContext | null {
	try {
		return c.executionCtx ?? null
	} catch {
		return null
	}
}

function scanToVerifiedComposition(scan: MoonScan): VerifiedComposition | null {
	if (scan.status !== 'verified' || !scan.verifiedAt) return null
	return {
		moonId: scan.moonId,
		sourceScanId: scan.id,
		verifiedAt: scan.verifiedAt,
		verifiedBy: scan.verifiedBy,
		ores: scan.ores,
	}
}

async function upsertVerifiedMoonSummariesForScans(
	moonScan: MoonScanDO,
	universe: Universe,
	scans: MoonScan[]
): Promise<void> {
	const compositions = scans
		.map(scanToVerifiedComposition)
		.filter((composition): composition is VerifiedComposition => composition !== null)
	if (compositions.length === 0) return

	const summaryRecords = await buildVerifiedMoonSummaryRecords(compositions, universe)
	await moonScan.upsertVerifiedMoonSummaries(summaryRecords)
}

function queueVerifiedMoonSummaryUpsert(
	c: { executionCtx?: ExecutionContext },
	moonScan: MoonScanDO,
	universe: Universe,
	scans: MoonScan[]
): void {
	const task = upsertVerifiedMoonSummariesForScans(moonScan, universe, scans).catch((error) => {
		logger.warn('[moon-scan] failed to upsert verified moon summaries from write path', { error })
	})
	const executionCtx = getExecutionContextOrNull(c)
	if (executionCtx) {
		executionCtx.waitUntil(task)
	} else {
		void task
	}
}

async function backfillMissingVerifiedMoonSummaries(
	moonScan: MoonScanDO,
	universe: Universe
): Promise<void> {
	const [scanSummary, summaryMoonIds] = await Promise.all([
		moonScan.getScanSummary(),
		moonScan.getVerifiedMoonSummaryIds(),
	])
	const summaryMoonIdSet = new Set(summaryMoonIds)
	const missingMoonIds = scanSummary.verifiedMoonIds.filter((moonId) => !summaryMoonIdSet.has(moonId))
	if (missingMoonIds.length === 0) return

	for (const missingMoonIdChunk of chunkArray(missingMoonIds, VERIFIED_MOON_SUMMARY_BACKFILL_BATCH_SIZE)) {
		const missingCompositions = await moonScan.getVerifiedCompositions(missingMoonIdChunk)
		const summaryRecords = await buildVerifiedMoonSummaryRecords(missingCompositions, universe)
		await moonScan.upsertVerifiedMoonSummaries(summaryRecords)
	}
}

export function getVerifiedMoonsExportBucket(env: App['Bindings']): R2Bucket {
	return env.MOON_SCAN_EXPORTS
}

export function buildVerifiedMoonsExportKey(exportId: string): string {
	return `${VERIFIED_MOONS_EXPORT_BUCKET_PREFIX}/${exportId}.csv`
}

export function buildVerifiedMoonsExportFileName(exportId: string): string {
	return `scanned-moons-export-${exportId.slice(0, 8)}.csv`
}

export async function writeVerifiedMoonsExportToBucket(args: {
	bucket: R2Bucket
	exportKey: string
	fileName: string
	expiresAt: string
	moonScan: MoonScanDO
	universe: Universe
	env: App['Bindings']
	query: VerifiedMoonsExportQuery
}): Promise<number> {
	const writer = await createR2MultipartTextWriter(args.bucket, args.exportKey, {
		httpMetadata: {
			contentType: 'text/csv; charset=utf-8',
		},
		customMetadata: {
			fileName: args.fileName,
			expiresAt: args.expiresAt,
		},
	})

	let rowCount = 0
	try {
		await writer.writeLine(
			buildCsvLine([
				'regionId',
				'regionName',
				'solarSystemId',
				'solarSystemName',
				'moonId',
				'moonName',
				'securityStatus',
				'highestRarity',
				'metenoxProfit',
				'tataraProfit',
				'oreTypeId',
				'oreTypeName',
				'oreRarity',
				'oreCompositionPercent',
				'oreTotalOreValue',
			])
		)

		const firstPage = await args.moonScan.getVerifiedMoonPage({
			page: 1,
			pageSize: VERIFIED_MOONS_EXPORT_PAGE_SIZE,
			regionId: args.query.regionId,
			constellationId: args.query.constellationId,
			rarity: args.query.rarity,
			search: args.query.search,
			sortBy: 'moonName',
			sortDir: 'asc',
		})
		const exportPricingInputs = firstPage.total > 0
			? await getMoonPricingInputsForOreTypeIds(
				args.env,
				args.universe,
				args.moonScan,
				ALL_MOON_SCAN_PRICING_TYPE_IDS
			)
			: undefined
		const totalPages = Math.max(1, Math.ceil(firstPage.total / VERIFIED_MOONS_EXPORT_PAGE_SIZE))
		for (let page = 1; page <= totalPages; page += 1) {
			const pageData =
				page === 1
					? firstPage
					: await args.moonScan.getVerifiedMoonPage({
						page,
						pageSize: VERIFIED_MOONS_EXPORT_PAGE_SIZE,
						regionId: args.query.regionId,
						constellationId: args.query.constellationId,
						rarity: args.query.rarity,
						search: args.query.search,
						sortBy: 'moonName',
						sortDir: 'asc',
					})
			const pageEntries = await buildMoonExportEntriesForPage({
				moonScan: args.moonScan,
				universe: args.universe,
				env: args.env,
				summaries: pageData.items,
				pricingInputs: exportPricingInputs,
			})
			for (const entry of pageEntries) {
				for (const row of buildMoonExportRows(entry)) {
					await writer.writeLine(buildCsvLine(row))
					rowCount += 1
				}
			}
		}

		await writer.close()
		return rowCount
	} catch (error) {
		await writer.abort().catch(() => {})
		throw error
	}
}

type MoonPricingInputs = {
	settings: Awaited<ReturnType<MoonScanDO['getExtractionSettings']>>
	profiles: Awaited<ReturnType<MoonScanDO['getStructureProfiles']>>
	typeMaterialsMap: Record<string, Array<{ materialTypeId: string; quantity: number }>>
	priceMap: Record<string, number>
	typeNamesMap: Record<string, { typeName: string } | null>
	oreVolumes: Record<string, number>
	pricingSnapshotDate: string | null
}

type VerifiedMoonsListItem = {
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

type VerifiedMoonsListResponse = {
	items: VerifiedMoonsListItem[]
	total: number
	page: number
	pageSize: number
	constellations: Array<{ constellationId: string; constellationName: string }>
	updatedAt: string
	pricingSnapshotDate: string | null
}

type MoonRegionsResponse = {
	regions: Array<{
		regionId: string
		regionName: string
		systemCount: number
		moonCount: number
		scannedCount: number
		verifiedCount: number
	}>
	connections: Awaited<ReturnType<Universe['getRegionConnections']>>
}

type VerifiedMoonRegionCount = Awaited<ReturnType<MoonScanDO['getVerifiedMoonCountsByRegionIds']>>[number]

type MoonRegionResponse = {
	regionId: string
	systems: Array<{
		solarSystemId: string
		solarSystemName: string
		securityStatus: string | null
		moonCount: number
		scannedCount: number
		verifiedCount: number
	}>
	jumpLinks: Array<{ from: string; to: string }>
	borderRegions: Awaited<ReturnType<Universe['getRegionsBySystemIds']>>
}

type MoonSystemResponse = {
	system: {
		solarSystemId: string
		solarSystemName: string
		securityStatus: string | null
	}
	moons: Array<{
		moonId: string
		moonName: string
		hasScans: boolean
		isVerified: boolean
		composition: VerifiedComposition | null
	}>
}

type MoonLeaderboardResponse = Awaited<ReturnType<MoonScanDO['getLeaderboard']>>

const moonPricingInputsCache = new TimeCache<MoonPricingInputs>(MOON_PRICING_INPUTS_CACHE_TTL_MS, 100)
const moonPricingRevisionCache = new TimeCache<string | null>(MOON_PRICING_REVISION_CACHE_TTL_MS, 2)
const verifiedMoonsResponseCache = new TimeCache<VerifiedMoonsListResponse>(
	VERIFIED_MOONS_RESPONSE_CACHE_TTL_MS,
	200
)
const moonRegionsResponseCache = new TimeCache<MoonRegionsResponse>(MOON_REGIONS_RESPONSE_CACHE_TTL_MS, 10)
const moonRegionResponseCache = new TimeCache<MoonRegionResponse>(MOON_REGION_RESPONSE_CACHE_TTL_MS, 100)
const moonSystemResponseCache = new TimeCache<MoonSystemResponse>(MOON_SYSTEM_RESPONSE_CACHE_TTL_MS, 500)
const moonLeaderboardCache = new TimeCache<MoonLeaderboardResponse>(MOON_LEADERBOARD_CACHE_TTL_MS, 10)
const moonSystemLocationCache = new TimeCache<UniverseSolarSystem | null>(
	MOON_SYSTEM_LOCATION_CACHE_TTL_MS,
	MOON_SYSTEM_LOCATION_CACHE_MAX_SIZE
)

async function resolveSolarSystemsWithCache(
	universe: Universe,
	systemIds: string[],
): Promise<Record<string, UniverseSolarSystem | null>> {
	const uniqueSystemIds = [...new Set(systemIds)]
	if (uniqueSystemIds.length === 0) return {}

	const resolved: Record<string, UniverseSolarSystem | null> = {}
	const missingSystemIds: string[] = []
	for (const systemId of uniqueSystemIds) {
		const cached = moonSystemLocationCache.get(`moon-system:${systemId}`)
		if (cached === undefined) missingSystemIds.push(systemId)
		else resolved[systemId] = cached
	}

	if (missingSystemIds.length > 0) {
		const fetched = await universe.resolveSolarSystemsByIds(missingSystemIds)
		for (const systemId of missingSystemIds) {
			const system = fetched[systemId] ?? null
			moonSystemLocationCache.set(`moon-system:${systemId}`, system)
			resolved[systemId] = system
		}
	}

	return resolved
}

const SCAN_LOCATION_BACKFILL_BATCH_SIZE = 250

async function backfillScanLocations(moonScan: MoonScanDO, universe: Universe): Promise<void> {
	let afterMoonId: string | undefined

	for (;;) {
		const moonIds = await moonScan.getUnlocatedScannedMoonIds(SCAN_LOCATION_BACKFILL_BATCH_SIZE, afterMoonId)
		if (moonIds.length === 0) return

		const moonsById = await universe.resolveStaticMoonsByIds(moonIds)
		const systemIds = moonIds
			.map((moonId) => moonsById[moonId]?.solarSystemId)
			.filter((systemId): systemId is string => Boolean(systemId))
		const systemsById = await resolveSolarSystemsWithCache(universe, systemIds)
		const locations: ScanLocation[] = []

		for (const moonId of moonIds) {
			const moon = moonsById[moonId]
			const system = moon ? systemsById[moon.solarSystemId] : null
			if (!moon || !system) continue
			locations.push({ moonId, regionId: system.regionId, solarSystemId: moon.solarSystemId })
		}

		if (locations.length > 0) await moonScan.backfillScanLocations(locations)
		afterMoonId = moonIds[moonIds.length - 1]
	}
}

type MoonExportEntry = {
	moon: {
		moonId: string
		moonName: string
		solarSystemId: string
		solarSystemName: string
		regionId: string
		regionName: string
		constellationId: string
		constellationName: string
		securityStatus: string | null
		highestRarity: string | null
	}
	profitability: MoonProfitability | null
}

function getMoonProfitabilityInputsFromComposition(
	composition: VerifiedComposition,
	inputs: MoonPricingInputs,
): MoonProfitability | null {
	try {
		const reprocessingYield = parseFloat(inputs.settings.defaultReprocessingYield)
		const cycleDays = inputs.settings.defaultCycleDays
		const cycleHours = cycleDays * 24

		function buildStructureOres(totalVolume: number, isPassive: boolean): OreWithProfitability[] {
			return composition.ores
				.map((ore) => {
					const liveMaterials = inputs.typeMaterialsMap[ore.oreTypeId] ?? []
					const fraction = parseFloat(ore.quantity)
					const oreUnits = (totalVolume * fraction) / getOreVolume(ore.oreTypeId)

					const refinesTo = liveMaterials
						.filter((mat) => !(isPassive && MINERAL_TYPE_IDS.has(mat.materialTypeId)))
						.map((mat) => {
							const batchQty = mat.quantity
							const units = Math.floor(Math.floor(oreUnits / 100) * batchQty * reprocessingYield)
							const unitSellPrice = inputs.priceMap[mat.materialTypeId] ?? 0
							return {
								materialTypeId: mat.materialTypeId,
								materialName: inputs.typeNamesMap[mat.materialTypeId]?.typeName ?? mat.materialTypeId,
								quantity: units,
								batchSize: 100,
								batchQty,
								unitSellPrice: String(unitSellPrice),
								totalValue: String(units * unitSellPrice),
								materialRarity: null,
							}
						})
						.sort((a, b) =>
							(RARITY_ORDER[ORE_TYPE_RARITY[b.materialTypeId] as OreRarity] ?? 0) -
							(RARITY_ORDER[ORE_TYPE_RARITY[a.materialTypeId] as OreRarity] ?? 0)
						)

					const totalOreValue = refinesTo.reduce((sum, r) => sum + parseFloat(r.totalValue), 0)
					return {
						oreTypeId: ore.oreTypeId,
						oreName: inputs.typeNamesMap[ore.oreTypeId]?.typeName ?? ore.oreTypeId,
						quantity: ore.quantity,
						rarity: ORE_TYPE_RARITY[ore.oreTypeId] ?? null,
						refinesTo,
						totalOreValue: String(totalOreValue),
					}
				})
				.sort((a, b) =>
					(RARITY_ORDER[ORE_TYPE_RARITY[b.oreTypeId] as OreRarity] ?? 0) -
					(RARITY_ORDER[ORE_TYPE_RARITY[a.oreTypeId] as OreRarity] ?? 0)
				)
		}

		const structures: StructureProfitability[] = []
		for (const profile of inputs.profiles) {
			const baseRate = parseFloat(profile.baseVolumePerHr) * (1 + parseFloat(profile.rigBonus))
			const fuelPerHr = parseFloat(profile.fuelPerHr)
			const magmaticGasPerHr = profile.magmaticGasPerHr ? parseFloat(profile.magmaticGasPerHr) : 0
			const totalVolume = profile.isPassive
				? baseRate * parseFloat(profile.nullsecModifier) * cycleHours
				: baseRate * cycleHours
			const fuelUnits = fuelPerHr * cycleHours
			const magmaticGasUnits = profile.isPassive ? magmaticGasPerHr * cycleHours : 0

			const ores = buildStructureOres(totalVolume, profile.isPassive)
			const grossIsk = ores.reduce((sum, ore) => sum + parseFloat(ore.totalOreValue), 0)
			const fuelCost = fuelUnits * resolveEffectivePrice(
				inputs.settings.fuelBlockPriceOverride,
				inputs.priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
			)
			const magmaticGasCost = magmaticGasUnits * resolveEffectivePrice(
				inputs.settings.magmaticGasPriceOverride,
				inputs.priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
			)

			structures.push({
				structureType: profile.id,
				cycleDays,
				grossIsk: String(Math.round(grossIsk)),
				fuelCost: String(Math.round(fuelCost)),
				magmaticGasCost: profile.isPassive ? String(Math.round(magmaticGasCost)) : null,
				profit: String(Math.round(grossIsk - fuelCost - magmaticGasCost)),
				ores,
			})
		}

		const tataraProfile = inputs.profiles.find((profile) => profile.id === 'tatara')
		const compositionOres = tataraProfile
			? structures.find((structure) => structure.structureType === 'tatara')?.ores ?? []
			: []

		return {
			ores: compositionOres,
			structures,
			updatedAt: new Date().toISOString(),
			pricingSnapshotDate: inputs.pricingSnapshotDate,
		}
	} catch (error) {
		logger.error('[moon-scan] failed to build profitability from cached inputs', { error })
		return null
	}
}

function clearMoonScanReadCaches(): void {
	verifiedMoonsResponseCache.clear()
	moonRegionsResponseCache.clear()
	moonRegionResponseCache.clear()
	moonSystemResponseCache.clear()
	moonLeaderboardCache.clear()
}

function clearMoonScanPricingCaches(): void {
	moonPricingInputsCache.clear()
	moonPricingRevisionCache.clear()
	clearMoonScanReadCaches()
}

function buildMoonPricingInputsCacheKey(oreTypeIds: string[], pricingRevision: string | null): string {
	const sortedOreTypeIds = [...new Set(oreTypeIds)].sort((a, b) => Number(a) - Number(b))
	return `moon-pricing-inputs:${pricingRevision ?? 'none'}:${sortedOreTypeIds.join(',')}`
}

async function getMoonPricingRevision(env: App['Bindings']): Promise<string | null> {
	return moonPricingRevisionCache.getOrSet('moon-pricing-revision:universe', () =>
		getMarketsStub(env).getMarketDataRevisionAtTime({
			regionId: createEveRegionId('universe'),
			atTime: new Date(),
		})
	)
}

function getPricingSnapshotDate(pricingRevision: string | null): string | null {
	return pricingRevision?.split(':', 1)[0] ?? null
}

function getMoonProfitValuesFromComposition(
	composition: VerifiedComposition,
	inputs: MoonPricingInputs,
): Pick<VerifiedMoonsListItem, 'metenoxProfit' | 'tataraProfit'> {
	const reprocessingYield = parseFloat(inputs.settings.defaultReprocessingYield)
	const cycleDays = inputs.settings.defaultCycleDays
	let metenoxProfit: number | null = null
	let tataraProfit: number | null = null

	for (const profile of inputs.profiles) {
		const baseRate = parseFloat(profile.baseVolumePerHr) * (1 + parseFloat(profile.rigBonus))
		const fuelPerHr = parseFloat(profile.fuelPerHr)
		const magmaticGasPerHr = profile.magmaticGasPerHr ? parseFloat(profile.magmaticGasPerHr) : 0
		const cycleHours = cycleDays * 24
		const totalVolume = profile.isPassive
			? baseRate * parseFloat(profile.nullsecModifier) * cycleHours
			: baseRate * cycleHours
		const fuelUnits = fuelPerHr * cycleHours
		const magmaticGasUnits = profile.isPassive ? magmaticGasPerHr * cycleHours : 0

		let grossIsk = 0
		for (const ore of composition.ores) {
			const liveMaterials = inputs.typeMaterialsMap[ore.oreTypeId] ?? []
			const fraction = parseFloat(ore.quantity)
			const oreUnits = (totalVolume * fraction) / getOreVolume(ore.oreTypeId)
			for (const material of liveMaterials) {
				if (profile.isPassive && MINERAL_TYPE_IDS.has(material.materialTypeId)) continue
				const rawUnits = Math.floor(oreUnits / 100) * material.quantity * reprocessingYield
				grossIsk += Math.floor(rawUnits) * (inputs.priceMap[material.materialTypeId] ?? 0)
			}
		}

		const fuelCost = fuelUnits * resolveEffectivePrice(
			inputs.settings.fuelBlockPriceOverride,
			inputs.priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
		)
		const magmaticGasCost = magmaticGasUnits * resolveEffectivePrice(
			inputs.settings.magmaticGasPriceOverride,
			inputs.priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
		)
		const profit = Math.round(grossIsk - fuelCost - magmaticGasCost)

		if (profile.id === 'metenox') metenoxProfit = profit
		else if (profile.id === 'tatara') tataraProfit = profit
	}

	return {
		metenoxProfit: metenoxProfit !== null ? String(metenoxProfit) : null,
		tataraProfit: tataraProfit !== null ? String(tataraProfit) : null,
	}
}

function toMoonProfitabilityQueryInputs(inputs: MoonPricingInputs): MoonProfitabilityQueryInputs {
	return {
		...inputs.settings,
		profiles: inputs.profiles.map((profile) => ({
			id: profile.id,
			baseVolumePerHr: profile.baseVolumePerHr,
			rigBonus: profile.rigBonus,
			fuelPerHr: profile.fuelPerHr,
			magmaticGasPerHr: profile.magmaticGasPerHr,
			nullsecModifier: profile.nullsecModifier,
			isPassive: profile.isPassive,
		})),
		typeMaterials: Object.entries(inputs.typeMaterialsMap).flatMap(([oreTypeId, materials]) =>
			materials.map((material) => ({ ...material, oreTypeId }))
		),
		oreVolumes: inputs.oreVolumes,
		prices: Object.entries(inputs.priceMap).map(([typeId, price]) => ({ typeId, price })),
	}
}

async function getMoonPricingInputs(
	env: App['Bindings'],
	universe: Universe,
	moonScan: MoonScanDO,
	compositions: VerifiedComposition[],
): Promise<MoonPricingInputs> {
	const oreTypeIds = [...new Set(compositions.flatMap((composition) => composition.ores.map((ore) => ore.oreTypeId)))]
	return getMoonPricingInputsForOreTypeIds(env, universe, moonScan, oreTypeIds)
}

async function getMoonPricingInputsForOreTypeIds(
	env: App['Bindings'],
	universe: Universe,
	moonScan: MoonScanDO,
	oreTypeIds: string[],
	pricingRevision?: string | null,
): Promise<MoonPricingInputs> {
	const uniqueOreTypeIds = [...new Set(oreTypeIds)]
	const effectivePricingRevision = pricingRevision ?? await getMoonPricingRevision(env)
	return moonPricingInputsCache.getOrSet(
		buildMoonPricingInputsCacheKey(uniqueOreTypeIds, effectivePricingRevision),
		async () => {
		const [settings, profiles, typeMaterialsMap] = await Promise.all([
			moonScan.getExtractionSettings(),
			moonScan.getStructureProfiles(),
			uniqueOreTypeIds.length > 0
				? universe.getTypeMaterials(uniqueOreTypeIds)
				: Promise.resolve({} as Record<string, Array<{ materialTypeId: string; quantity: number }>>),
		])

		const materialTypeIds = [
			...new Set(
				Object.values(typeMaterialsMap).flatMap((materials) => materials.map((material) => material.materialTypeId))
			),
		]
		const typeIdsForNames = [...new Set([...uniqueOreTypeIds, ...materialTypeIds])]
		const priceTypeIds = [...new Set([...materialTypeIds, FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID])]
		const markets = getMarketsStub(env)
		const [priceResponse, typeNamesMap] = await Promise.all([
			markets.getBatchMarketDataAtTime({
				regionId: createEveRegionId('universe'),
				typeIds: priceTypeIds.map(createEveTypeId),
				atTime: new Date(),
			}),
			typeIdsForNames.length > 0
				? universe.resolveTypeNamesByIds(typeIdsForNames)
				: Promise.resolve({} as Record<string, { typeName: string } | null>),
		])

		const priceMap: Record<string, number> = {}
		for (const price of priceResponse.prices) {
			if (price.bestSellPrice) priceMap[price.typeId] = parseFloat(price.bestSellPrice)
		}

		return {
			settings,
			profiles,
			typeMaterialsMap,
			priceMap,
			typeNamesMap,
			oreVolumes: Object.fromEntries(uniqueOreTypeIds.map((typeId) => [typeId, getOreVolume(typeId)])),
			pricingSnapshotDate: getPricingSnapshotDate(effectivePricingRevision),
		}
		}
	)
}

function buildMoonExportRows(entry: MoonExportEntry): Array<Array<string | number | boolean | null | undefined>> {
	const rows: Array<Array<string | number | boolean | null | undefined>> = []
	const ores = entry.profitability?.ores ?? []
	const metenoxProfit = entry.profitability?.structures.find((structure) => structure.structureType === 'metenox')?.profit ?? null
	const tataraProfit = entry.profitability?.structures.find((structure) => structure.structureType === 'tatara')?.profit ?? null

	if (ores.length === 0) {
		rows.push([
			entry.moon.regionId,
			entry.moon.regionName,
			entry.moon.solarSystemId,
			entry.moon.solarSystemName,
			entry.moon.moonId,
			entry.moon.moonName,
			entry.moon.securityStatus ?? '',
			entry.moon.highestRarity ?? '',
			metenoxProfit ?? '',
			tataraProfit ?? '',
			'',
			'',
			'',
			'',
			'',
		])
		return rows
	}

	for (const ore of ores) {
		rows.push([
			entry.moon.regionId,
			entry.moon.regionName,
			entry.moon.solarSystemId,
			entry.moon.solarSystemName,
			entry.moon.moonId,
			entry.moon.moonName,
			entry.moon.securityStatus ?? '',
			entry.moon.highestRarity ?? '',
			metenoxProfit ?? '',
			tataraProfit ?? '',
			ore.oreTypeId,
			ore.oreName,
			ore.rarity ?? '',
			`${(Number.parseFloat(ore.quantity) * 100).toFixed(2)}%`,
			ore.totalOreValue,
		])
	}

	return rows
}

async function buildMoonExportEntriesForPage(args: {
	moonScan: MoonScanDO
	universe: Universe
	env: App['Bindings']
	summaries: Array<{
		moonId: string
		moonName: string
		solarSystemId: string
		solarSystemName: string
		regionId: string
		regionName: string
		constellationId: string
		constellationName: string
		securityStatus: string | null
		highestRarity: string | null
	}>
	pricingInputs?: MoonPricingInputs
}): Promise<MoonExportEntry[]> {
	if (args.summaries.length === 0) return []

	const compositions = await args.moonScan.getVerifiedCompositions(args.summaries.map((summary) => summary.moonId))
	const compositionMap = new Map(compositions.map((composition) => [composition.moonId, composition]))
	const inputs = args.pricingInputs ?? await getMoonPricingInputs(args.env, args.universe, args.moonScan, compositions)

	return args.summaries.map((summary) => {
		const composition = compositionMap.get(summary.moonId)
		return {
			moon: summary,
			profitability: composition ? getMoonProfitabilityInputsFromComposition(composition, inputs) : null,
		}
	})
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const VerifyRejectSchema = z.object({
	notes: z.string().max(2000).optional(),
})

const VerifyQueueSchema = z.object({
	scanIds: z.array(z.string().min(1)).min(1),
})

const RejectQueueSchema = VerifyQueueSchema

const ScanFiltersSchema = z.object({
	status: z.enum(['pending', 'verified', 'rejected']).optional(),
	moonId: z.string().optional(),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(20),
})

const RARITY_VALUES = ['R4', 'R8', 'R16', 'R32', 'R64'] as const
const RaritySchema = z.enum(RARITY_VALUES)
const VerifiedMoonsQuerySchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().positive().max(100).default(50),
	regionId: z.string().optional(),
	constellationId: z.string().optional(),
	rarity: z
		.string()
		.optional()
		.transform((val) => {
			if (!val) return undefined
			const parts = val.split(',').map((p) => p.trim()).filter(Boolean)
			if (parts.length === 0) return undefined
			return parts
		})
		.pipe(z.array(RaritySchema).optional()),
	search: z.string().trim().optional(),
	sortBy: z
		.enum([
			'moonName',
			'solarSystemName',
			'regionName',
			'securityStatus',
			'highestRarity',
			'metenoxProfit',
			'tataraProfit',
		])
		.default('moonName'),
	sortDir: z.enum(['asc', 'desc']).default('asc'),
})

function buildVerifiedMoonsResponseCacheKey(
	query: z.infer<typeof VerifiedMoonsQuerySchema>,
	pricingRevision: string | null,
): string {
	const rarities = query.rarity ? [...query.rarity].sort().join(',') : ''
	return [
		'verified-moons',
		query.page,
		query.pageSize,
		query.regionId ?? '',
		query.constellationId ?? '',
		rarities,
		query.search ?? '',
		query.sortBy,
		query.sortDir,
		pricingRevision ?? 'none',
	].join('|')
}

const ExtractionSettingsSchema = z.object({
	defaultReprocessingYield: z.string().optional(),
	defaultCycleDays: z.number().int().positive().optional(),
	fuelBlockPriceOverride: z.string().nullable().optional(),
	magmaticGasPriceOverride: z.string().nullable().optional(),
})

const StructureProfileSchema = z.object({
	baseVolumePerHr: z.string().optional(),
	rigBonus: z.string().optional(),
	fuelPerHr: z.string().optional(),
	magmaticGasPerHr: z.string().nullable().optional(),
	minCycleDays: z.number().int().nullable().optional(),
	maxCycleDays: z.number().int().nullable().optional(),
	isPassive: z.boolean().optional(),
	lowsecModifier: z.string().optional(),
	nullsecModifier: z.string().optional(),
})

// ─── Router ──────────────────────────────────────────────────────────────────

const moonScanRoutes = new Hono<App>()
	.use('*', requireAllianceMember())

// ─── Regions overview ────────────────────────────────────────────────────────

moonScanRoutes.get('/moons/regions', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const cachedResponse = moonRegionsResponseCache.get('k-space')
	if (cachedResponse) return c.json(cachedResponse)

	const universe = getUniverseStub(c.env)
	const moonScan = getMoonScanStub(c.env)
	const K_SPACE_REGIONS = getKSpaceRegionIds()

	const [regionData, regionStats, scannedRegionCounts, verifiedRegionCounts, connections] = await Promise.all([
		universe.resolveRegionsByIds(K_SPACE_REGIONS),
		universe.getRegionStats(K_SPACE_REGIONS),
		moonScan.getScannedMoonCountsByRegionIds(K_SPACE_REGIONS),
		moonScan.getVerifiedMoonCountsByRegionIds(K_SPACE_REGIONS),
		universe.getRegionConnections(K_SPACE_REGIONS),
	])

	const scannedByRegion = new Map(
		scannedRegionCounts.map((entry) => [entry.regionId, entry.scannedCount])
	)
	const verifiedByRegion = new Map<string, VerifiedMoonRegionCount['verifiedCount']>(
		verifiedRegionCounts.map((entry) => [entry.regionId, entry.verifiedCount])
	)

	const regions = K_SPACE_REGIONS
		.map((regionId) => regionData[regionId])
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.map((r) => ({
			regionId: r.regionId,
			regionName: r.regionName,
			systemCount: regionStats[r.regionId]?.systemCount ?? 0,
			moonCount: regionStats[r.regionId]?.moonCount ?? 0,
			scannedCount: scannedByRegion.get(r.regionId) ?? 0,
			verifiedCount: verifiedByRegion.get(r.regionId) ?? 0,
		}))

	const response: MoonRegionsResponse = { regions, connections }
	moonRegionsResponseCache.set('k-space', response)
	return c.json(response)
})

// ─── Region detail (for SVG map) ─────────────────────────────────────────────

moonScanRoutes.get('/moons/region/:regionId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const regionId = c.req.param('regionId')
	if (!isKSpaceRegion(regionId)) return c.json({ error: 'Region not in k-space' }, 400)

	const cachedResponse = moonRegionResponseCache.get(regionId)
	if (cachedResponse) return c.json(cachedResponse)

	const universe = getUniverseStub(c.env)
	const moonScan = getMoonScanStub(c.env)

	// Get all systems and stargates for the region
	const systems = await universe.getSystemsByRegionId(regionId)

	const [stargates, moonsBySystem] = await Promise.all([
		universe.getStargatesBySystemIds(systems.map((s) => s.solarSystemId)),
		universe.getMoonsBySystemIds(systems.map((s) => s.solarSystemId)),
	])

	// Build moon ID list and get coverage
	const allMoonIds = Object.values(moonsBySystem).flatMap((moons) => moons.map((m) => m.moonId))
	const coverage = await moonScan.getMoonCoverage(allMoonIds)
	const coverageMap = new Map(coverage.map((c) => [c.moonId, c]))

	// Deduplicate jump links (each jump has two stargates)
	const regionSystemIds = new Set(systems.map((s) => s.solarSystemId))
	const borderSystemIds = new Set<string>()
	const jumps = new Set<string>()
	const jumpLinks: Array<{ from: string; to: string }> = []
	for (const sg of stargates) {
		if (!sg.destinationSolarSystemId) continue
		const key = [sg.solarSystemId, sg.destinationSolarSystemId].sort().join('|')
		if (!jumps.has(key)) {
			jumps.add(key)
			jumpLinks.push({ from: sg.solarSystemId, to: sg.destinationSolarSystemId })
		}
		if (!regionSystemIds.has(sg.destinationSolarSystemId)) {
			borderSystemIds.add(sg.destinationSolarSystemId)
		}
	}

	// Resolve region names for border (neighboring-region) systems
	const borderRegions = await universe.getRegionsBySystemIds([...borderSystemIds])

	// Aggregate per-system moon coverage
	const systemMoonCoverage = new Map<string, { total: number; verified: number }>()
	for (const systemId of systems.map((s) => s.solarSystemId)) {
		const moons = moonsBySystem[systemId] ?? []
		let total = 0; let verified = 0
		for (const m of moons) {
			const c = coverageMap.get(m.moonId)
			if (c?.hasScans) total++
			if (c?.isVerified) verified++
		}
		systemMoonCoverage.set(systemId, { total, verified })
	}

	const response: MoonRegionResponse = {
		regionId,
		systems: systems.map((s) => ({
				solarSystemId: s.solarSystemId,
				solarSystemName: s.solarSystemName,
				securityStatus: s.securityStatus,
				moonCount: moonsBySystem[s.solarSystemId]?.length ?? 0,
				scannedCount: systemMoonCoverage.get(s.solarSystemId)?.total ?? 0,
				verifiedCount: systemMoonCoverage.get(s.solarSystemId)?.verified ?? 0,
			})),
		jumpLinks,
		borderRegions,
	}
	moonRegionResponseCache.set(regionId, response)
	return c.json(response)
})

// ─── System detail ───────────────────────────────────────────────────────────

moonScanRoutes.get('/moons/system/:systemId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const systemId = c.req.param('systemId')
	const cachedResponse = moonSystemResponseCache.get(systemId)
	if (cachedResponse) return c.json(cachedResponse)

	const universe = getUniverseStub(c.env)
	const moonScan = getMoonScanStub(c.env)

	const [systemsById, moonsInSystem] = await Promise.all([
		universe.resolveSolarSystemsByIds([systemId]),
		universe.getMoonsBySystemId(systemId),
	])

	const system = systemsById[systemId]
	if (!system) return c.json({ error: 'System not found' }, 404)

	const moonIds = moonsInSystem.map((m) => m.moonId)
	const compositions = moonIds.length > 0
		? await moonScan.getMoonCoverage(moonIds)
		: []
	const compositionMap = new Map(compositions.map((c) => [c.moonId, c]))

	const verifiedMoonIds = compositions.filter((c) => c.isVerified).map((c) => c.moonId)
	const verifiedComps = await moonScan.getVerifiedCompositions(verifiedMoonIds)
	const verifiedCompMap = new Map(
		verifiedComps
			.map((v) => [v.moonId, v])
	)

	const response: MoonSystemResponse = {
		system: {
			solarSystemId: system.solarSystemId,
			solarSystemName: system.solarSystemName,
			securityStatus: system.securityStatus,
		},
		moons: moonsInSystem.map((m) => ({
			moonId: m.moonId,
			moonName: m.moonName,
			hasScans: compositionMap.get(m.moonId)?.hasScans ?? false,
			isVerified: compositionMap.get(m.moonId)?.isVerified ?? false,
			composition: verifiedCompMap.get(m.moonId) ?? null,
		})),
	}
	moonSystemResponseCache.set(systemId, response)
	return c.json(response)
})

// ─── Verified moons list ─────────────────────────────────────────────────────

moonScanRoutes.get('/moons/verified', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const query = VerifiedMoonsQuerySchema.safeParse({
		page: c.req.query('page'),
		pageSize: c.req.query('pageSize'),
		regionId: c.req.query('regionId'),
		constellationId: c.req.query('constellationId'),
		rarity: c.req.query('rarity'),
		search: c.req.query('search'),
		sortBy: c.req.query('sortBy'),
		sortDir: c.req.query('sortDir'),
	})
	if (!query.success) {
		return c.json({ error: 'Invalid query', issues: query.error.issues }, 400)
	}

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const pricingRevision = await getMoonPricingRevision(c.env)
	const verifiedMoonsResponseCacheKey = buildVerifiedMoonsResponseCacheKey(query.data, pricingRevision)
	const cachedResponse = verifiedMoonsResponseCache.get(verifiedMoonsResponseCacheKey)
	if (cachedResponse) return c.json(cachedResponse)

	const pricingInputs = await getMoonPricingInputsForOreTypeIds(
		c.env,
		universe,
		moonScan,
		ALL_MOON_SCAN_PRICING_TYPE_IDS,
		pricingRevision,
	)
	const summary = await moonScan.getVerifiedMoonPage({
		...query.data,
		sortBy: query.data.sortBy as VerifiedMoonsSortBy,
		profitability: toMoonProfitabilityQueryInputs(pricingInputs),
	})

	const response: VerifiedMoonsListResponse = {
		items: summary.items.map((item) => ({
			...item,
			metenoxProfit: item.metenoxProfit ?? null,
			tataraProfit: item.tataraProfit ?? null,
		})),
		total: summary.total,
		page: summary.page,
		pageSize: summary.pageSize,
		constellations: summary.constellations,
		updatedAt: new Date().toISOString(),
		pricingSnapshotDate: pricingInputs.pricingSnapshotDate,
	}
	verifiedMoonsResponseCache.set(verifiedMoonsResponseCacheKey, response)
	return c.json(response)
})

moonScanRoutes.post('/moons/verified/export', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const query = VerifiedMoonsQuerySchema.safeParse({
		page: c.req.query('page'),
		pageSize: c.req.query('pageSize'),
		regionId: c.req.query('regionId'),
		constellationId: c.req.query('constellationId'),
		rarity: c.req.query('rarity'),
		search: c.req.query('search'),
		sortBy: c.req.query('sortBy'),
		sortDir: c.req.query('sortDir'),
	})
	if (!query.success) {
		return c.json({ error: 'Invalid query', issues: query.error.issues }, 400)
	}
	if (!query.data.regionId && !query.data.constellationId) {
		return c.json({ error: 'regionId or constellationId is required for moon export' }, 400)
	}
	const { sortBy: _sortBy, sortDir: _sortDir, page: _page, pageSize: _pageSize, ...exportQuery } = query.data

	const workflow = await createWorkflow(c.env.EXPORT_WORKFLOW, {
		params: {
			kind: 'moon-scan-verified',
			userId: user.id,
			query: exportQuery,
		},
	})

	return c.json(
		{
			workflowInstanceId: workflow.id,
			exportId: workflow.id,
			fileName: buildVerifiedMoonsExportFileName(workflow.id),
			status: 'queued',
		},
		202
	)
})

moonScanRoutes.get('/moons/verified/export/:workflowInstanceId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const workflow = await c.env.EXPORT_WORKFLOW.get(workflowInstanceId)
	const status = await workflow.status()
	const outputStatus =
		status.output && typeof status.output === 'object' && 'status' in status.output
			? String((status.output as { status?: string }).status ?? '')
			: undefined
	return c.json({
		workflowInstanceId,
		status: normalizeWorkflowStatus(status.status, outputStatus),
		rawStatus: status.status,
		output: status.output ?? null,
	})
})

moonScanRoutes.get('/moons/verified/export/:workflowInstanceId/download', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const bucket = getVerifiedMoonsExportBucket(c.env)
	const exportKey = buildVerifiedMoonsExportKey(workflowInstanceId)
	const object = await bucket.get(exportKey)
	if (!object) {
		return c.json({ error: 'Export not found' }, 404)
	}
	if (isExportArtifactExpired(object.customMetadata?.expiresAt)) {
		await bucket.delete(exportKey).catch(() => {})
		return c.json({ error: 'Export expired' }, 404)
	}

	const fileName = object.customMetadata?.fileName ?? buildVerifiedMoonsExportFileName(workflowInstanceId)
	const contentType = object.httpMetadata?.contentType ?? 'text/csv; charset=utf-8'
	const response = new Response(object.body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${fileName}"`,
			'Cache-Control': 'no-store',
		},
	})
	const executionCtx = getExecutionContextOrNull(c)
	const cleanup = bucket.delete(exportKey).catch(() => {})
	if (executionCtx) {
		executionCtx.waitUntil(cleanup)
	} else {
		void cleanup
	}
	return response
})

function getMarketsStub(env: App['Bindings']): Markets {
	return getStub<Markets>(env.MARKETS, 'region-10000002')
}

export async function buildVerifiedMoonSummaryRecords(
	compositions: VerifiedComposition[],
	universe: Universe,
): Promise<VerifiedMoonSummaryRecord[]> {
	if (compositions.length === 0) return []

	const moonIds = [...new Set(compositions.map((composition) => composition.moonId))]
	const moonMap = await universe.resolveStaticMoonsByIds(moonIds)
	const systemIds = [...new Set(
		Object.values(moonMap)
			.filter((moon): moon is NonNullable<typeof moon> => moon !== null)
			.map((moon) => moon.solarSystemId)
	)]
	const systemsById = systemIds.length > 0 ? await universe.resolveSolarSystemsByIds(systemIds) : {}
	const regionIds = [...new Set(
		Object.values(systemsById)
			.filter((system): system is NonNullable<typeof system> => system !== null)
			.map((system) => system.regionId)
			.filter((regionId): regionId is string => Boolean(regionId))
	)]
	const constellationIds = [...new Set(
		Object.values(systemsById)
			.filter((system): system is NonNullable<typeof system> => system !== null)
			.map((system) => system.constellationId)
			.filter((constellationId): constellationId is string => Boolean(constellationId))
	)]
	const [regionsById, constellationsById] = await Promise.all([
		regionIds.length > 0
			? universe.resolveRegionsByIds(regionIds)
			: Promise.resolve({} as Record<string, { regionId: string; regionName: string } | null>),
		constellationIds.length > 0
			? universe.resolveConstellationsByIds(constellationIds)
			: Promise.resolve({} as Record<string, { constellationId: string; constellationName: string } | null>),
	]) as [
		Record<string, { regionId: string; regionName: string } | null>,
		Record<string, { constellationId: string; constellationName: string } | null>,
	]

	return compositions.map((composition) => {
		const moon = moonMap[composition.moonId]
		const system = moon ? systemsById[moon.solarSystemId] : null
		const regionId = system?.regionId ?? ''
		const constellationId = system?.constellationId ?? ''
		const highestRarity = composition.ores.reduce<OreRarity | null>((best, ore) => {
			const rarity = ORE_TYPE_RARITY[ore.oreTypeId]
			if (!rarity) return best
			if (!best) return rarity
			return (RARITY_ORDER[rarity] ?? 0) > (RARITY_ORDER[best] ?? 0) ? rarity : best
		}, null)

		return {
			moonId: composition.moonId,
			sourceScanId: composition.sourceScanId,
			verifiedAt: composition.verifiedAt,
			verifiedBy: composition.verifiedBy,
			moonName: moon?.moonName ?? composition.moonId,
			solarSystemId: moon?.solarSystemId ?? system?.solarSystemId ?? '',
			solarSystemName: system?.solarSystemName ?? moon?.solarSystemId ?? composition.moonId,
			regionId,
			regionName: regionId ? regionsById[regionId]?.regionName ?? regionId : '',
			constellationId,
			constellationName: constellationId ? constellationsById[constellationId]?.constellationName ?? constellationId : '',
			securityStatus: system?.securityStatus ?? null,
			highestRarity,
		}
	})
}

async function computeProfitability(
	composition: VerifiedComposition,
	env: App['Bindings'],
	moonScan: MoonScanDO,
): Promise<MoonProfitability | null> {
	try {
		const universe = getUniverseStub(env)
		const inputs = await getMoonPricingInputs(env, universe, moonScan, [composition])
		return getMoonProfitabilityInputsFromComposition(composition, inputs)
	} catch (err) {
		logger.error('[computeProfitability] failed:', err)
		return null
	}
}

// ─── Single moon detail ───────────────────────────────────────────────────────

moonScanRoutes.get('/moons/:moonId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const moonId = c.req.param('moonId')
	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)

	const [moonsById, scans, composition] = await Promise.all([
		universe.resolveStaticMoonsByIds([moonId]),
		moonScan.getScans({ moonId, pageSize: 50 }),
		moonScan.getVerifiedComposition(moonId),
	])

	const moon = moonsById[moonId]
	if (!moon) return c.json({ error: 'Moon not found' }, 404)

	// Enrich moon with system name
	const systemsById = await universe.resolveSolarSystemsByIds([moon.solarSystemId])
	const system = systemsById[moon.solarSystemId]

	const profitability = composition
		? await computeProfitability(composition, c.env, moonScan)
		: null

	// Resolve character IDs to names via the cache
	const characterIds = [
		...new Set([
			...scans.items.map((s) => s.submittedBy).filter((id): id is string => id !== null),
			...(composition?.verifiedBy ? [composition.verifiedBy] : []),
		]),
	]
	const nameMap = await moonScan.resolveCharacterNames(characterIds)

	const enrichedScans = scans.items.map((s) => ({
		...s,
		submittedByName: s.submittedBy ? (nameMap[s.submittedBy] ?? s.submittedBy) : null,
	}))

	const enrichedComposition = composition
		? { ...composition, verifiedByName: composition.verifiedBy ? (nameMap[composition.verifiedBy] ?? composition.verifiedBy) : null }
		: null

	return c.json({
		moon: { ...moon, solarSystemName: system?.solarSystemName ?? '' },
		scans: enrichedScans,
		composition: enrichedComposition,
		profitability,
	})
})

// ─── Parse TSV (preview, no DB write) ────────────────────────────────────────

moonScanRoutes.post('/scans/parse', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.submit, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = await c.req.json<{ raw: string }>()
	if (!body.raw || typeof body.raw !== 'string') {
		return c.json({ error: 'raw field is required' }, 400)
	}
	if (isRawPayloadTooLarge(body.raw)) {
		return c.json({ error: `raw payload exceeds ${MAX_SCAN_RAW_BYTES} bytes` }, 413)
	}

	const parseResult = parseMoonScanTsv(body.raw)

	// Annotate each scan with sec status eligibility
	const systemIds = [...new Set(parseResult.scans.map((s) => s.solarSystemId))]
	const systemsById = await resolveSolarSystemsWithCache(getUniverseStub(c.env), systemIds)

	const annotated = parseResult.scans.map((scan) => {
		const system = systemsById[scan.solarSystemId]
		const secStatus = parseSecurityStatus(system?.securityStatus ?? null)
		const eligible = isMoonMiningEligibleSecurity(system?.securityStatus ?? null)
		return { ...scan, secStatus, eligible }
	})

	return c.json({ ...parseResult, scans: annotated })
})

// ─── Submit scans ────────────────────────────────────────────────────────────

moonScanRoutes.post('/scans/submit', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.submit, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = await c.req.json<{ raw: string }>()
	if (!body.raw || typeof body.raw !== 'string') {
		return c.json({ error: 'raw field is required' }, 400)
	}
	if (isRawPayloadTooLarge(body.raw)) {
		return c.json({ error: `raw payload exceeds ${MAX_SCAN_RAW_BYTES} bytes` }, 413)
	}

	const parseResult = parseMoonScanTsv(body.raw)
	if (parseResult.scans.length === 0) {
		return c.json({ error: 'No valid scans in input', parseErrors: parseResult.errors }, 400)
	}

	// Batch-resolve system security statuses and filter ineligible systems
	const systemIds = [...new Set(parseResult.scans.map((s) => s.solarSystemId))]
	const universe = getUniverseStub(c.env)
	const systemsById = await resolveSolarSystemsWithCache(universe, systemIds)

	const eligibleScans = parseResult.scans.filter((scan) => {
		const system = systemsById[scan.solarSystemId]
		return isMoonMiningEligibleSecurity(system?.securityStatus ?? null)
	})

	const scansWithOnlyAllowedOreTypes = eligibleScans.filter((scan) =>
		scan.ores.every((ore) => ALLOWED_MOON_SCAN_ORE_TYPE_IDS.has(ore.oreTypeId))
	)

	if (scansWithOnlyAllowedOreTypes.length === 0) {
		if (eligibleScans.length > 0) {
			return c.json({ error: 'No scans contain only allowed moon ore type IDs' }, 400)
		}
		return c.json({ error: 'All scanned systems are high-sec (sec ≥ 0.6)' }, 400)
	}

	// Submitter has validate permission → auto-verify
	const canValidate = await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)
	const moonScan = getMoonScanStub(c.env)

	// Cache character name so it shows on leaderboard
	const primaryChar = user.characters.find((ch) => ch.is_primary)
	if (primaryChar) {
		await moonScan.cacheCharacterName(primaryChar.characterId, primaryChar.characterName)
	}

	const submittedScans = await moonScan.submitScans(
		scansWithOnlyAllowedOreTypes.map((s) => ({
			moonId: s.moonId,
			regionId: systemsById[s.solarSystemId]!.regionId,
			solarSystemId: s.solarSystemId,
			ores: s.ores.map((o) => ({ oreTypeId: o.oreTypeId, quantity: o.quantity })),
		})),
		primaryChar?.characterId ?? null,
		canValidate
	)
	clearMoonScanReadCaches()
	if (canValidate) {
		queueVerifiedMoonSummaryUpsert(c, moonScan, universe, submittedScans)
	}

	const rejected = parseResult.scans.length - scansWithOnlyAllowedOreTypes.length

	return c.json({
		submitted: submittedScans.length,
		autoVerified: canValidate ? submittedScans.length : 0,
		rejected,
		parseErrors: parseResult.errors,
		scans: submittedScans,
	})
})

// ─── Scan list ───────────────────────────────────────────────────────────────

moonScanRoutes.get('/scans', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const query = ScanFiltersSchema.safeParse(c.req.query())
	if (!query.success) return c.json({ error: 'Invalid query' }, 400)

	const moonScan = getMoonScanStub(c.env)
	const result = await moonScan.getScans(query.data)
	return c.json(result)
})

// ─── Validation queue (pending scans) ────────────────────────────────────────

moonScanRoutes.get('/scans/queue', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const page = Number(c.req.query('page') ?? 1)
	const pageSize = Number(c.req.query('pageSize') ?? 20)

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const result = await moonScan.getScans({ status: 'pending', page, pageSize })
	if (result.items.length === 0) {
		return c.json(result as PaginatedScanQueue)
	}

	const moonIds = [...new Set(result.items.map((scan) => scan.moonId))]
	const submitterIds = [...new Set(
		result.items
			.map((scan) => scan.submittedBy)
			.filter((characterId): characterId is string => characterId !== null)
	)]
	const oreTypeIds = [...new Set(result.items.flatMap((scan) => scan.ores.map((ore) => ore.oreTypeId)))]

	const [moonsById, characterNames, typeNamesById] = await Promise.all([
		universe.resolveStaticMoonsByIds(moonIds),
		submitterIds.length > 0
			? moonScan.resolveCharacterNames(submitterIds)
			: Promise.resolve({} as Record<string, string>),
		oreTypeIds.length > 0
			? universe.resolveTypeNamesByIds(oreTypeIds)
			: Promise.resolve({} as Record<string, { typeName: string } | null>),
	])

	const items: ScanQueueEntry[] = result.items.map((scan) => ({
		...scan,
		moonName: moonsById[scan.moonId]?.moonName ?? 'Unknown Moon',
		submittedByName: scan.submittedBy ? (characterNames[scan.submittedBy] ?? 'Unknown Pilot') : null,
		ores: scan.ores.map((ore) => ({
			...ore,
			oreTypeName: typeNamesById[ore.oreTypeId]?.typeName ?? 'Unknown Ore',
		})),
	}))

	return c.json<PaginatedScanQueue>({
		...result,
		items,
	})
})

moonScanRoutes.post('/scans/queue/verify-all', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = VerifyQueueSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body', issues: body.error.issues }, 400)

	const primaryChar = user.characters.find((ch) => ch.is_primary)
	const verifiedBy = primaryChar?.characterId ?? user.id

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const scans = await moonScan.verifyScans(body.data.scanIds, verifiedBy, null)
	clearMoonScanReadCaches()
	queueVerifiedMoonSummaryUpsert(c, moonScan, universe, scans)
	return c.json(scans)
})

moonScanRoutes.post('/scans/queue/reject-all', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = RejectQueueSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body', issues: body.error.issues }, 400)

	const primaryChar = user.characters.find((ch) => ch.is_primary)
	const verifiedBy = primaryChar?.characterId ?? user.id

	const moonScan = getMoonScanStub(c.env)
	const scans = await moonScan.rejectScans(body.data.scanIds, verifiedBy, null)
	clearMoonScanReadCaches()
	return c.json(scans)
})

// ─── My scans ────────────────────────────────────────────────────────────────

moonScanRoutes.get('/scans/mine', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.submit, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const primaryChar = user.characters.find((ch) => ch.is_primary)
	if (!primaryChar) return c.json({ items: [], total: 0, page: 1, pageSize: 20 })

	const page = Number(c.req.query('page') ?? 1)
	const pageSize = Number(c.req.query('pageSize') ?? 20)

	const moonScan = getMoonScanStub(c.env)
	const result = await moonScan.getScans({ submittedBy: primaryChar.characterId, page, pageSize })
	return c.json(result)
})

// ─── Single scan ─────────────────────────────────────────────────────────────

moonScanRoutes.get('/scans/:id', async (c) => {
	const user = c.get('user')!
	const canValidate = await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)
	const moonScan = getMoonScanStub(c.env)
	const scan = await moonScan.getScan(c.req.param('id'))
	if (!scan) return c.json({ error: 'Not found' }, 404)

	if (!canValidate && !user.is_admin) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	return c.json(scan)
})

// ─── Verify scan ─────────────────────────────────────────────────────────────

moonScanRoutes.post('/scans/:id/verify', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = VerifyRejectSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body' }, 400)

	const primaryChar = user.characters.find((ch) => ch.is_primary)
	const verifiedBy = primaryChar?.characterId ?? user.id

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const scan = await moonScan.verifyScan(c.req.param('id'), verifiedBy, body.data.notes ?? null)
	clearMoonScanReadCaches()
	queueVerifiedMoonSummaryUpsert(c, moonScan, universe, [scan])
	return c.json(scan)
})

// ─── Reject scan ─────────────────────────────────────────────────────────────

moonScanRoutes.post('/scans/:id/reject', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = VerifyRejectSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body' }, 400)

	const primaryChar = user.characters.find((ch) => ch.is_primary)
	const verifiedBy = primaryChar?.characterId ?? user.id

	const moonScan = getMoonScanStub(c.env)
	const scan = await moonScan.rejectScan(c.req.param('id'), verifiedBy, body.data.notes ?? null)
	clearMoonScanReadCaches()
	return c.json(scan)
})

// ─── Leaderboard ─────────────────────────────────────────────────────────────

moonScanRoutes.get('/leaderboard', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.submit, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const window = (c.req.query('window') ?? 'all') as 'all' | '7d' | '30d'
	if (!['all', '7d', '30d'].includes(window)) {
		return c.json({ error: 'Invalid window (all|7d|30d)' }, 400)
	}

	const cacheKey = `leaderboard:${window}`
	const cachedResponse = moonLeaderboardCache.get(cacheKey)
	if (cachedResponse) return c.json(cachedResponse)

	const moonScan = getMoonScanStub(c.env)
	const entries = await moonScan.getLeaderboard(window)
	moonLeaderboardCache.set(cacheKey, entries)
	return c.json(entries)
})

// ─── Admin: settings ─────────────────────────────────────────────────────────

moonScanRoutes.get('/admin/settings', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.admin, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const moonScan = getMoonScanStub(c.env)
	const [settings, profiles] = await Promise.all([
		moonScan.getExtractionSettings(),
		moonScan.getStructureProfiles(),
	])

	return c.json({ settings, profiles })
})

moonScanRoutes.post('/admin/settings', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.admin, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = ExtractionSettingsSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body', issues: body.error.issues }, 400)

	const moonScan = getMoonScanStub(c.env)
	const updated = await moonScan.updateExtractionSettings(body.data)
	clearMoonScanPricingCaches()
	return c.json(updated)
})

moonScanRoutes.post('/admin/settings/profiles/:id', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.admin, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const id = c.req.param('id')
	if (!['tatara', 'metenox'].includes(id)) {
		return c.json({ error: 'Invalid structure type' }, 400)
	}

	const body = StructureProfileSchema.safeParse(await c.req.json())
	if (!body.success) return c.json({ error: 'Invalid body', issues: body.error.issues }, 400)

	const moonScan = getMoonScanStub(c.env)
	const updated = await moonScan.updateStructureProfile(id as 'tatara' | 'metenox', body.data)
	clearMoonScanPricingCaches()
	return c.json(updated)
})

moonScanRoutes.post('/admin/scan-locations/backfill', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.admin, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const task = backfillScanLocations(moonScan, universe).catch((error) => {
		logger.error('[moon-scan] failed to backfill scan locations', { error })
		throw error
	})

	const executionCtx = getExecutionContextOrNull(c)
	if (executionCtx) {
		executionCtx.waitUntil(task)
		return c.json({ status: 'queued' }, 202)
	}

	await task
	return c.json({ status: 'completed' })
})

moonScanRoutes.post('/admin/verified-moon-summaries/backfill', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.admin, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	clearMoonScanReadCaches()
	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)
	const task = backfillMissingVerifiedMoonSummaries(moonScan, universe)
		.then(() => {
			clearMoonScanReadCaches()
		})
		.catch((error) => {
			logger.error('[moon-scan] failed to backfill verified moon summaries', { error })
		})

	const executionCtx = getExecutionContextOrNull(c)
	if (executionCtx) {
		executionCtx.waitUntil(task)
		return c.json({ status: 'queued' }, 202)
	}

	await task
	return c.json({ status: 'completed' })
})

export { moonScanRoutes }

// ─── Static k-space region IDs ───────────────────────────────────────────────
// All standard EVE k-space regions (empire + null-sec). Excludes:
//   - Wormhole regions (11000xxx)
//   - Pochven / Triglavian (10000070)
//   - Inaccessible Jove regions: UUA-F4 (10000004), J7HZ-F (10000017), A821-A (10000019)
//   - IDs that don't exist in SDE: 10000024, 10000026
function getKSpaceRegionIds(): string[] {
	// All IDs from 10000001-10000069 that exist and are accessible
	const EXCLUDED = new Set(['10000004', '10000017', '10000019', '10000024', '10000026'])
	return Array.from({ length: 69 }, (_, i) => String(10000001 + i))
		.filter((id) => !EXCLUDED.has(id))
}
