import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'
import {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	MOON_GOO_TYPE_IDS,
	MOON_ORE_TYPE_IDS,
	ORE_TYPE_RARITY,
	RARITY_ORDER,
	getOreVolume,
	parseMoonScanTsv,
	type MoonScanDO,
	type MoonProfitability,
	type OreRarity,
	type OreWithProfitability,
	type StructureProfitability,
	type VerifiedComposition,
} from '@repo/moon-scan'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember } from '../middleware/session'

import { createEveRegionId, createEveTypeId } from '@repo/eve-types'
import type { Markets } from '@repo/markets'
import type { Universe } from '@repo/universe'
import type { App, SessionUser } from '../context'

// ─── Permission URNs ─────────────────────────────────────────────────────────

const MOON_URNS = {
	view: 'urn:moons:view',
	submit: 'urn:moons:scan:submit',
	validate: 'urn:moons:scan:validate',
	admin: 'urn:moons:admin',
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

// Minerals that Metenox does NOT output (only moon goo materials)
const MINERAL_TYPE_IDS = new Set(['35', '36'])
const ALLOWED_MOON_SCAN_ORE_TYPE_IDS = new Set<string>([...MOON_ORE_TYPE_IDS, ...MOON_GOO_TYPE_IDS])

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
		return perms.some((p) => p.urn === urn)
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

function isScanOwner(scan: { submittedBy: string | null }, user: SessionUser): boolean {
	if (!scan.submittedBy) return false
	return user.characters.some((character) => character.characterId === scan.submittedBy)
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

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const VerifyRejectSchema = z.object({
	notes: z.string().max(2000).optional(),
})

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

	const universe = getUniverseStub(c.env)
	const moonScan = getMoonScanStub(c.env)
	const K_SPACE_REGIONS = getKSpaceRegionIds()

	const [regionData, regionStats, scanSummary, connections] = await Promise.all([
		universe.resolveRegionsByIds(K_SPACE_REGIONS),
		universe.getRegionStats(K_SPACE_REGIONS),
		moonScan.getScanSummary(),
		universe.getRegionConnections(K_SPACE_REGIONS),
	])

	// Map scanned/verified moon IDs back to their regions
	const allScanMoonIds = [...new Set([...scanSummary.scannedMoonIds, ...scanSummary.verifiedMoonIds])]
	const moonRegionMap = allScanMoonIds.length > 0
		? await universe.getMoonRegionIds(allScanMoonIds)
		: {}

	const scannedByRegion = new Map<string, number>()
	const verifiedByRegion = new Map<string, number>()
	for (const moonId of scanSummary.scannedMoonIds) {
		const regionId = moonRegionMap[moonId]
		if (regionId) scannedByRegion.set(regionId, (scannedByRegion.get(regionId) ?? 0) + 1)
	}
	for (const moonId of scanSummary.verifiedMoonIds) {
		const regionId = moonRegionMap[moonId]
		if (regionId) verifiedByRegion.set(regionId, (verifiedByRegion.get(regionId) ?? 0) + 1)
	}

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

	return c.json({ regions, connections })
})

// ─── Region detail (for SVG map) ─────────────────────────────────────────────

moonScanRoutes.get('/moons/region/:regionId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const regionId = c.req.param('regionId')
	if (!isKSpaceRegion(regionId)) return c.json({ error: 'Region not in k-space' }, 400)

	const universe = getUniverseStub(c.env)
	const moonScan = getMoonScanStub(c.env)

	// Get all systems and stargates for the region
	const systems = await universe.getSystemsByRegionId(regionId)

	const eligibleSystemIds = systems
		.filter((s) => isMoonMiningEligibleSecurity(s.securityStatus))
		.map((s) => s.solarSystemId)

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

	return c.json({
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
	})
})

// ─── System detail ───────────────────────────────────────────────────────────

moonScanRoutes.get('/moons/system/:systemId', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const systemId = c.req.param('systemId')
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

	return c.json({
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
	})
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

	// Get all verified moon IDs
	const summary = await moonScan.getScanSummary()
	const verifiedMoonIds = summary.verifiedMoonIds
	if (verifiedMoonIds.length === 0) {
		return c.json({
			items: [],
			total: 0,
			page: query.data.page,
			pageSize: query.data.pageSize,
			updatedAt: new Date().toISOString(),
		})
	}

	// Bulk-load compositions, moon static data, and settings+prices in parallel
	const [compositions, moonsById, settings, profiles] = await Promise.all([
		moonScan.getVerifiedCompositions(verifiedMoonIds),
		universe.resolveStaticMoonsByIds(verifiedMoonIds),
		moonScan.getExtractionSettings(),
		moonScan.getStructureProfiles(),
	])

	// Resolve system IDs and fetch system info + moon→region mapping
	const systemIds = [...new Set(
		Object.values(moonsById)
			.filter((m): m is NonNullable<typeof m> => m !== null)
			.map((m) => m.solarSystemId)
	)]
	const [systemsById, moonRegionMap] = await Promise.all([
		universe.resolveSolarSystemsByIds(systemIds),
		universe.getMoonRegionIds(verifiedMoonIds),
	])

	// Resolve region names
	const regionIds = [...new Set(Object.values(moonRegionMap).filter((id): id is string => !!id))]
	const regionsById = regionIds.length > 0 ? await universe.resolveRegionsByIds(regionIds) : {}

	// Resolve constellation names (each system already carries constellationId)
	const constellationIds = [
		...new Set(
			Object.values(systemsById)
				.filter((s): s is NonNullable<typeof s> => s !== null)
				.map((s) => s.constellationId)
				.filter((id): id is string => !!id)
		),
	]
	const constellationsById = constellationIds.length > 0
		? await universe.resolveConstellationsByIds(constellationIds)
		: {}

	// Collect all unique ore type IDs across all compositions for typeMaterials lookup
	const allOreTypeIds = [...new Set(compositions.flatMap((c) => c.ores.map((o) => o.oreTypeId)))]

	// Fetch live typeMaterials first, then price all discovered materials + consumables.
	const markets = getMarketsStub(c.env)
	const typeMaterialsMap = await universe.getTypeMaterials(allOreTypeIds)
	const allMaterialTypeIds = [...new Set(
		Object.values(typeMaterialsMap).flatMap((materials) => materials.map((material) => material.materialTypeId))
	)]
	const priceResponse = await markets.getBatchMarketDataAtTime({
		regionId: createEveRegionId('universe'),
		typeIds: [...allMaterialTypeIds, FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID].map(createEveTypeId),
		atTime: new Date(),
	})
	const priceMap: Record<string, number> = {}
	for (const p of priceResponse.prices) {
		if (p.bestSellPrice) priceMap[p.typeId] = parseFloat(p.bestSellPrice)
	}

	const fuelBlockPrice = resolveEffectivePrice(
		settings.fuelBlockPriceOverride,
		priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
	)
	const magmaticGasPrice = resolveEffectivePrice(
		settings.magmaticGasPriceOverride,
		priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
	)
	const reprocessingYield = parseFloat(settings.defaultReprocessingYield)
	const cycleDays = settings.defaultCycleDays



	function computeMoonProfit(composition: typeof compositions[number]) {
		let metenoxProfit: number | null = null
		let tataraProfit: number | null = null

		for (const profile of profiles) {
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
				const liveMaterials = typeMaterialsMap[ore.oreTypeId] ?? []
				const fraction = parseFloat(ore.quantity)
				const oreVolumeM3 = totalVolume * fraction
				const oreUnits = oreVolumeM3 / getOreVolume(ore.oreTypeId)
				for (const mat of liveMaterials) {
					if (profile.isPassive && MINERAL_TYPE_IDS.has(mat.materialTypeId)) continue
					const rawUnits = Math.floor(oreUnits / 100) * mat.quantity * reprocessingYield
					grossIsk += Math.floor(rawUnits) * (priceMap[mat.materialTypeId] ?? 0)
				}
			}

			const fuelCost = fuelUnits * fuelBlockPrice
			const magmaticGasCost = magmaticGasUnits * magmaticGasPrice
			const profit = Math.round(grossIsk - fuelCost - magmaticGasCost)

			if (profile.id === 'metenox') metenoxProfit = profit
			else if (profile.id === 'tatara') tataraProfit = profit
		}

		return { metenoxProfit, tataraProfit }
	}

	const moons = compositions.map((comp) => {
		const moon = moonsById[comp.moonId]
		if (!moon) return null

		const system = systemsById[moon.solarSystemId]
		const regionId = moonRegionMap[comp.moonId] ?? null
		const region = regionId ? regionsById[regionId] : null
		const constellationId = system?.constellationId ?? null
		const constellation = constellationId ? constellationsById[constellationId] : null

		const highestRarity = comp.ores.reduce<string | null>((best, ore) => {
			const r = ORE_TYPE_RARITY[ore.oreTypeId]
			if (!r) return best
			if (!best) return r
			return (RARITY_ORDER[r] ?? 0) > (RARITY_ORDER[best as OreRarity] ?? 0) ? r : best
		}, null)

		const { metenoxProfit, tataraProfit } = computeMoonProfit(comp)

		return {
			moonId: comp.moonId,
			moonName: moon.moonName,
			solarSystemId: moon.solarSystemId,
			solarSystemName: system?.solarSystemName ?? moon.solarSystemId,
			regionId: regionId ?? '',
			regionName: region?.regionName ?? regionId ?? '',
			constellationId: constellationId ?? '',
			constellationName: constellation?.constellationName ?? constellationId ?? '',
			securityStatus: system?.securityStatus ?? null,
			highestRarity,
			metenoxProfit: metenoxProfit !== null ? String(metenoxProfit) : null,
			tataraProfit: tataraProfit !== null ? String(tataraProfit) : null,
		}
	}).filter((m): m is NonNullable<typeof m> => m !== null)

	let filtered = moons
	if (query.data.regionId) {
		filtered = filtered.filter((m) => m.regionId === query.data.regionId)
	}
	// Unique constellations within the region-filter (drives the cascading dropdown).
	const constellationsForFilter = new Map<string, { constellationId: string; constellationName: string }>()
	for (const m of filtered) {
		if (m.constellationId && !constellationsForFilter.has(m.constellationId)) {
			constellationsForFilter.set(m.constellationId, {
				constellationId: m.constellationId,
				constellationName: m.constellationName,
			})
		}
	}
	const constellationsSummary = [...constellationsForFilter.values()].sort((a, b) =>
		a.constellationName.localeCompare(b.constellationName)
	)
	if (query.data.constellationId) {
		filtered = filtered.filter((m) => m.constellationId === query.data.constellationId)
	}
	if (query.data.rarity && query.data.rarity.length > 0) {
		const rarities = new Set<string>(query.data.rarity)
		filtered = filtered.filter((m) => m.highestRarity !== null && rarities.has(m.highestRarity))
	}
	if (query.data.search) {
		const q = query.data.search.toLowerCase()
		filtered = filtered.filter(
			(m) => m.moonName.toLowerCase().includes(q) || m.solarSystemName.toLowerCase().includes(q)
		)
	}

	const { sortBy, sortDir } = query.data
	const direction = sortDir === 'asc' ? 1 : -1
	const rarityRank = (rarity: string | null): number => {
		if (!rarity) return -1
		return RARITY_ORDER[rarity as OreRarity] ?? -1
	}
	const parseNum = (value: string | null): number | null => {
		if (value == null) return null
		const n = Number.parseFloat(value)
		return Number.isFinite(n) ? n : null
	}
	filtered = [...filtered].sort((a, b) => {
		let cmp = 0
		switch (sortBy) {
			case 'moonName':
				cmp = a.moonName.localeCompare(b.moonName)
				break
			case 'solarSystemName':
				cmp = a.solarSystemName.localeCompare(b.solarSystemName)
				break
			case 'regionName':
				cmp = a.regionName.localeCompare(b.regionName)
				break
			case 'securityStatus': {
				const av = parseSecurityStatus(a.securityStatus)
				const bv = parseSecurityStatus(b.securityStatus)
				cmp = av === bv ? 0 : av === null ? 1 : bv === null ? -1 : av - bv
				break
			}
			case 'highestRarity': {
				const av = rarityRank(a.highestRarity)
				const bv = rarityRank(b.highestRarity)
				cmp = av - bv
				break
			}
			case 'metenoxProfit': {
				const av = parseNum(a.metenoxProfit)
				const bv = parseNum(b.metenoxProfit)
				cmp = av === bv ? 0 : av === null ? 1 : bv === null ? -1 : av - bv
				break
			}
			case 'tataraProfit': {
				const av = parseNum(a.tataraProfit)
				const bv = parseNum(b.tataraProfit)
				cmp = av === bv ? 0 : av === null ? 1 : bv === null ? -1 : av - bv
				break
			}
		}
		if (cmp !== 0) return cmp * direction
		return a.moonName.localeCompare(b.moonName)
	})

	const total = filtered.length
	const page = query.data.page
	const pageSize = query.data.pageSize
	const start = (page - 1) * pageSize
	const items = filtered.slice(start, start + pageSize)

	return c.json({
		items,
		total,
		page,
		pageSize,
		constellations: constellationsSummary,
		updatedAt: new Date().toISOString(),
	})
})

function getMarketsStub(env: App['Bindings']): Markets {
	return getStub<Markets>(env.MARKETS, 'region-10000002')
}

async function computeProfitability(
	composition: VerifiedComposition,
	env: App['Bindings'],
	moonScan: MoonScanDO,
): Promise<MoonProfitability | null> {
	try {
		const oreTypeIds = composition.ores.map((o) => o.oreTypeId)

		const universe = getUniverseStub(env)
		const [settings, profiles, typeMaterialsMap] = await Promise.all([
			moonScan.getExtractionSettings(),
			moonScan.getStructureProfiles(),
			universe.getTypeMaterials(oreTypeIds),
		])

		// Collect all unique material type IDs from the live data for pricing + name lookup
		const liveMaterialTypeIds = [...new Set(
			Object.values(typeMaterialsMap).flatMap((mats) => mats.map((m) => m.materialTypeId))
		)]
		const oreTypeIdsForNames = composition.ores.map((o) => o.oreTypeId)

		const markets = getMarketsStub(env)
		const [priceResponse, typeNamesMap] = await Promise.all([
			markets.getBatchMarketDataAtTime({
				regionId: createEveRegionId('universe'),
				typeIds: [...liveMaterialTypeIds, FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID].map(createEveTypeId),
				atTime: new Date(),
			}),
			universe.resolveTypeNamesByIds([...liveMaterialTypeIds, ...oreTypeIdsForNames]),
		])
		const priceMap: Record<string, number> = {}
		for (const p of priceResponse.prices) {
			if (p.bestSellPrice) priceMap[p.typeId] = parseFloat(p.bestSellPrice)
		}

		const fuelBlockPrice = resolveEffectivePrice(
			settings.fuelBlockPriceOverride,
			priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
		)
		const magmaticGasPrice = resolveEffectivePrice(
			settings.magmaticGasPriceOverride,
			priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
		)
		const reprocessingYield = parseFloat(settings.defaultReprocessingYield)
		const cycleDays = settings.defaultCycleDays

		const cycleHours = cycleDays * 24

		function buildStructureOres(totalVolume: number, isPassive: boolean): OreWithProfitability[] {
			return composition.ores
				.map((ore) => {
					const liveMaterials = typeMaterialsMap[ore.oreTypeId] ?? []
					const fraction = parseFloat(ore.quantity)
					const oreUnits = (totalVolume * fraction) / getOreVolume(ore.oreTypeId)

					const refinesTo = liveMaterials
						.filter((mat) => !(isPassive && MINERAL_TYPE_IDS.has(mat.materialTypeId)))
						.map((mat) => {
							const batchQty = mat.quantity
							const units = Math.floor(Math.floor(oreUnits / 100) * batchQty * reprocessingYield)
							const unitSellPrice = priceMap[mat.materialTypeId] ?? 0
							return {
								materialTypeId: mat.materialTypeId,
								materialName: typeNamesMap[mat.materialTypeId]?.typeName ?? mat.materialTypeId,
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
						oreName: typeNamesMap[ore.oreTypeId]?.typeName ?? ore.oreTypeId,
						quantity: ore.quantity,
						rarity: null,
						refinesTo,
						totalOreValue: String(totalOreValue),
					}
				})
				.sort((a, b) =>
					(RARITY_ORDER[ORE_TYPE_RARITY[b.oreTypeId] as OreRarity] ?? 0) -
					(RARITY_ORDER[ORE_TYPE_RARITY[a.oreTypeId] as OreRarity] ?? 0)
				)
		}

		// Compute per-structure profitability, each with its own volume and ore rows
		const tataraProfile = profiles.find((p) => p.id === 'tatara')
		const structures: StructureProfitability[] = []
		for (const profile of profiles) {
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
			const fuelCost = fuelUnits * fuelBlockPrice
			const magmaticGasCost = magmaticGasUnits * magmaticGasPrice

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

		// Tatara ores drive the composition table (shows all materials incl. minerals)
		const compositionOres = tataraProfile
			? structures.find((s) => s.structureType === 'tatara')?.ores ?? []
			: []

		return {
			ores: compositionOres,
			structures,
			updatedAt: new Date().toISOString(),
		}
	} catch (err) {
		console.error('[computeProfitability] failed:', err)
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
	const systemsById = systemIds.length > 0
		? await getUniverseStub(c.env).resolveSolarSystemsByIds(systemIds)
		: {}

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
	const systemsById = await getUniverseStub(c.env).resolveSolarSystemsByIds(systemIds)

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
			ores: s.ores.map((o) => ({ oreTypeId: o.oreTypeId, quantity: o.quantity })),
		})),
		primaryChar?.characterId ?? null,
		canValidate
	)

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
	const result = await moonScan.getScans({ status: 'pending', page, pageSize })
	return c.json(result)
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
	const canView = await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)
	const canSubmit = await hasMoonPerm(c.env, user.id, MOON_URNS.submit, user.is_admin)
	const canValidate = await hasMoonPerm(c.env, user.id, MOON_URNS.validate, user.is_admin)
	const moonScan = getMoonScanStub(c.env)
	const scan = await moonScan.getScan(c.req.param('id'))
	if (!scan) return c.json({ error: 'Not found' }, 404)

	const owner = isScanOwner(scan, user)
	const canReadVerified = scan.status === 'verified' && canView
	const canReadOwned = owner && canSubmit
	if (!canReadVerified && !canValidate && !canReadOwned && !user.is_admin) {
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
	const scan = await moonScan.verifyScan(c.req.param('id'), verifiedBy, body.data.notes ?? null)
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
	return c.json(scan)
})

// ─── Leaderboard ─────────────────────────────────────────────────────────────

moonScanRoutes.get('/leaderboard', async (c) => {
	const user = c.get('user')!
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const window = (c.req.query('window') ?? 'all') as 'all' | '7d' | '30d'
	if (!['all', '7d', '30d'].includes(window)) {
		return c.json({ error: 'Invalid window (all|7d|30d)' }, 400)
	}

	const moonScan = getMoonScanStub(c.env)
	const entries = await moonScan.getLeaderboard(window)
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
	return c.json(updated)
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
