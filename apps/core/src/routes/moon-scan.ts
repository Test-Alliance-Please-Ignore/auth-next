import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'
import {
	FUEL_BLOCK_TYPE_ID,
	MAGMATIC_GAS_TYPE_ID,
	getAllMaterialTypeIds,
	getMoonOreData,
	parseMoonScanTsv,
} from '@repo/moon-scan'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember } from '../middleware/session'

import { createEveRegionId, createEveTypeId } from '@repo/eve-types'
import type { Markets } from '@repo/markets'
import type { MoonScanDO, MoonProfitability, OreWithProfitability, StructureProfitability } from '@repo/moon-scan'
import type { VerifiedComposition } from '@repo/moon-scan'
import type { Universe } from '@repo/universe'
import type { App } from '../context'

// ─── Permission URNs ─────────────────────────────────────────────────────────

const MOON_URNS = {
	view: 'urn:moons:view',
	submit: 'urn:moons:submit',
	validate: 'urn:moons:validate',
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

// ─── Caches ──────────────────────────────────────────────────────────────────

const permissionCache = new TimeCache<boolean>(15_000)

// Minerals that Metenox does NOT output (only moon goo materials)
const MINERAL_TYPE_IDS = new Set(['35', '36'])

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
		.filter((s) => s.securityStatus !== null && parseFloat(s.securityStatus) < SEC_STATUS_THRESHOLD)
		.map((s) => s.solarSystemId)

	const [stargates, moonsBySystem] = await Promise.all([
		universe.getStargatesBySystemIds(systems.map((s) => s.solarSystemId)),
		Promise.all(eligibleSystemIds.map((id) => universe.getMoonsBySystemId(id).then((moons) => ({ id, moons })))),
	])

	// Build moon ID list and get coverage
	const allMoonIds = moonsBySystem.flatMap(({ moons }) => moons.map((m) => m.moonId))
	const coverage = await moonScan.getMoonCoverage(allMoonIds)
	const coverageMap = new Map(coverage.map((c) => [c.moonId, c]))

	// Deduplicate jump links (each jump has two stargates)
	const jumps = new Set<string>()
	const jumpLinks: Array<{ from: string; to: string }> = []
	for (const sg of stargates) {
		if (!sg.destinationSolarSystemId) continue
		const key = [sg.solarSystemId, sg.destinationSolarSystemId].sort().join('|')
		if (!jumps.has(key)) {
			jumps.add(key)
			jumpLinks.push({ from: sg.solarSystemId, to: sg.destinationSolarSystemId })
		}
	}

	// Aggregate per-system moon coverage
	const systemMoonCoverage = new Map<string, { total: number; verified: number }>()
	for (const { id, moons } of moonsBySystem) {
		let total = 0; let verified = 0
		for (const m of moons) {
			const c = coverageMap.get(m.moonId)
			if (c?.hasScans) total++
			if (c?.isVerified) verified++
		}
		systemMoonCoverage.set(id, { total, verified })
	}

	return c.json({
		regionId,
		systems: systems.map((s) => ({
			solarSystemId: s.solarSystemId,
			solarSystemName: s.solarSystemName,
			securityStatus: s.securityStatus,
			moonCount: moonsBySystem.find((m) => m.id === s.solarSystemId)?.moons.length ?? 0,
			scannedCount: systemMoonCoverage.get(s.solarSystemId)?.total ?? 0,
			verifiedCount: systemMoonCoverage.get(s.solarSystemId)?.verified ?? 0,
		})),
		jumpLinks,
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
	const verifiedComps = await Promise.all(
		verifiedMoonIds.map((id) => moonScan.getVerifiedComposition(id))
	)
	const verifiedCompMap = new Map(
		verifiedComps
			.filter((v): v is NonNullable<typeof v> => v !== null)
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

	const moonScan = getMoonScanStub(c.env)
	const universe = getUniverseStub(c.env)

	// Get all verified moon IDs
	const summary = await moonScan.getScanSummary()
	const verifiedMoonIds = summary.verifiedMoonIds
	if (verifiedMoonIds.length === 0) {
		return c.json({ moons: [], updatedAt: new Date().toISOString() })
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

	// Collect all unique ore type IDs across all compositions for typeMaterials lookup
	const allOreTypeIds = [...new Set(compositions.flatMap((c) => c.ores.map((o) => o.oreTypeId)))]

	// Fetch prices and live typeMaterials in parallel
	const markets = getMarketsStub(c.env)
	const materialTypeIds = getAllMaterialTypeIds()
	const [priceResponse, typeMaterialsMap] = await Promise.all([
		markets.getBatchMarketDataAtTime({
			regionId: createEveRegionId('universe'),
			typeIds: [...materialTypeIds, FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID].map(createEveTypeId),
			atTime: new Date(),
		}),
		universe.getTypeMaterials(allOreTypeIds),
	])
	const priceMap: Record<string, number> = {}
	for (const p of priceResponse.prices) {
		if (p.bestSellPrice) priceMap[p.typeId] = parseFloat(p.bestSellPrice)
	}

	const fuelBlockPrice = priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
	const magmaticGasPrice = priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
	const reprocessingYield = parseFloat(settings.defaultReprocessingYield)
	const cycleDays = settings.defaultCycleDays

	const ORE_RARITY: Record<string, string> = {
		'45490': 'R4', '45491': 'R4', '45492': 'R4', '45493': 'R4',
		'45494': 'R8', '45495': 'R8', '45496': 'R8', '45497': 'R8',
		'45498': 'R16', '45499': 'R16', '45500': 'R16', '45501': 'R16',
		'45502': 'R32', '45503': 'R32', '45504': 'R32', '45506': 'R32',
		'45510': 'R64', '45511': 'R64', '45512': 'R64', '45513': 'R64',
	}
	const RARITY_ORDER: Record<string, number> = { R4: 1, R8: 2, R16: 3, R32: 4, R64: 5 }

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
				const oreData = getMoonOreData(ore.oreTypeId)
				const liveMaterials = typeMaterialsMap[ore.oreTypeId] ?? []
				const fraction = parseFloat(ore.quantity)
				const oreVolumeM3 = totalVolume * fraction
				const unitVolume = oreData?.volumeM3 ?? 10
				const oreUnits = oreVolumeM3 / unitVolume
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

		const highestRarity = comp.ores.reduce<string | null>((best, ore) => {
			const r = ORE_RARITY[ore.oreTypeId]
			if (!r) return best
			if (!best) return r
			return (RARITY_ORDER[r] ?? 0) > (RARITY_ORDER[best] ?? 0) ? r : best
		}, null)

		const { metenoxProfit, tataraProfit } = computeMoonProfit(comp)

		return {
			moonId: comp.moonId,
			moonName: moon.moonName,
			solarSystemId: moon.solarSystemId,
			solarSystemName: system?.solarSystemName ?? moon.solarSystemId,
			regionId: regionId ?? '',
			regionName: region?.regionName ?? regionId ?? '',
			securityStatus: system?.securityStatus ?? null,
			highestRarity,
			metenoxProfit: metenoxProfit !== null ? String(metenoxProfit) : null,
			tataraProfit: tataraProfit !== null ? String(tataraProfit) : null,
		}
	}).filter((m): m is NonNullable<typeof m> => m !== null)

	return c.json({ moons, updatedAt: new Date().toISOString() })
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

		const [settings, profiles, typeMaterialsMap] = await Promise.all([
			moonScan.getExtractionSettings(),
			moonScan.getStructureProfiles(),
			getUniverseStub(env).getTypeMaterials(oreTypeIds),
		])

		// Collect all material type IDs needed for pricing
		const materialTypeIds = getAllMaterialTypeIds()
		const markets = getMarketsStub(env)
		const priceResponse = await markets.getBatchMarketDataAtTime({
			regionId: createEveRegionId('universe'),
			typeIds: [...materialTypeIds, FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID].map(createEveTypeId),
			atTime: new Date(),
		})
		const priceMap: Record<string, number> = {}
		for (const p of priceResponse.prices) {
			if (p.bestSellPrice) priceMap[p.typeId] = parseFloat(p.bestSellPrice)
		}

		const fuelBlockPrice = priceMap[FUEL_BLOCK_TYPE_ID] ?? 0
		const magmaticGasPrice = priceMap[MAGMATIC_GAS_TYPE_ID] ?? 0
		const reprocessingYield = parseFloat(settings.defaultReprocessingYield)
		const cycleDays = settings.defaultCycleDays

		// Build ore profitability rows (used for composition table display)
		// Use tatara profile for per-ore volume calculation (30-day cycle)
		const tataraProfile = profiles.find((p) => p.id === 'tatara')
		if (!tataraProfile) return null

		const tataraBaseRate = parseFloat(tataraProfile.baseVolumePerHr) * (1 + parseFloat(tataraProfile.rigBonus))
		const tataraHours = cycleDays * 24
		const tataraVolume = tataraBaseRate * tataraHours

		const oresWithProfit: OreWithProfitability[] = composition.ores.map((ore) => {
			const oreData = getMoonOreData(ore.oreTypeId)
			const liveMaterials = typeMaterialsMap[ore.oreTypeId] ?? []
			const fraction = parseFloat(ore.quantity)
			const oreVolumeM3 = tataraVolume * fraction
			const unitVolume = oreData?.volumeM3 ?? 10
			const oreUnits = oreVolumeM3 / unitVolume

			const refinesTo = liveMaterials.map((mat) => {
				const batchQty = mat.quantity
				const rawUnits = Math.floor(oreUnits / 100) * batchQty * reprocessingYield
				const units = Math.floor(rawUnits)
				const unitSellPrice = priceMap[mat.materialTypeId] ?? 0
				const totalValue = units * unitSellPrice
				// Look up material name from static data (names are correct, only quantities were wrong)
				const staticOutput = oreData?.outputs.find((o) => o.materialTypeId === mat.materialTypeId)
				return {
					materialTypeId: mat.materialTypeId,
					materialName: staticOutput?.materialName ?? mat.materialTypeId,
					quantity: units,
					batchSize: 100,
					batchQty,
					unitSellPrice: String(unitSellPrice),
					totalValue: String(totalValue),
					materialRarity: null,
				}
			})

			const totalOreValue = refinesTo.reduce((sum, r) => sum + parseFloat(r.totalValue), 0)

			return {
				oreTypeId: ore.oreTypeId,
				oreName: oreData?.oreName ?? ore.oreTypeId,
				quantity: ore.quantity,
				rarity: null,
				refinesTo,
				totalOreValue: String(totalOreValue),
			}
		})

		// Compute per-structure profitability
		const structures: StructureProfitability[] = []
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
				const oreData = getMoonOreData(ore.oreTypeId)
				const liveMaterials = typeMaterialsMap[ore.oreTypeId] ?? []
				const fraction = parseFloat(ore.quantity)
				const oreVolumeM3 = totalVolume * fraction
				const unitVolume = oreData?.volumeM3 ?? 10
				const oreUnits = oreVolumeM3 / unitVolume
				for (const mat of liveMaterials) {
					if (profile.isPassive && MINERAL_TYPE_IDS.has(mat.materialTypeId)) continue
					const rawUnits = Math.floor(oreUnits / 100) * mat.quantity * reprocessingYield
					grossIsk += Math.floor(rawUnits) * (priceMap[mat.materialTypeId] ?? 0)
				}
			}

			const fuelCost = fuelUnits * fuelBlockPrice
			const magmaticGasCost = magmaticGasUnits * magmaticGasPrice
			const profit = grossIsk - fuelCost - magmaticGasCost

			structures.push({
				structureType: profile.id,
				cycleDays,
				grossIsk: String(Math.round(grossIsk)),
				fuelCost: String(Math.round(fuelCost)),
				magmaticGasCost: profile.isPassive ? String(Math.round(magmaticGasCost)) : null,
				profit: String(Math.round(profit)),
			})
		}

		return {
			ores: oresWithProfit,
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

	const parseResult = parseMoonScanTsv(body.raw)

	// Annotate each scan with sec status eligibility
	const systemIds = [...new Set(parseResult.scans.map((s) => s.solarSystemId))]
	const systemsById = systemIds.length > 0
		? await getUniverseStub(c.env).resolveSolarSystemsByIds(systemIds)
		: {}

	const annotated = parseResult.scans.map((scan) => {
		const system = systemsById[scan.solarSystemId]
		const secStatus = system?.securityStatus ? parseFloat(system.securityStatus) : null
		const eligible = secStatus !== null ? secStatus < SEC_STATUS_THRESHOLD : false
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

	const parseResult = parseMoonScanTsv(body.raw)
	if (parseResult.scans.length === 0) {
		return c.json({ error: 'No valid scans in input', parseErrors: parseResult.errors }, 400)
	}

	// Batch-resolve system security statuses and filter ineligible systems
	const systemIds = [...new Set(parseResult.scans.map((s) => s.solarSystemId))]
	const systemsById = await getUniverseStub(c.env).resolveSolarSystemsByIds(systemIds)

	const eligibleScans = parseResult.scans.filter((scan) => {
		const system = systemsById[scan.solarSystemId]
		if (!system?.securityStatus) return false
		return parseFloat(system.securityStatus) < SEC_STATUS_THRESHOLD
	})

	if (eligibleScans.length === 0) {
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
		eligibleScans.map((s) => ({
			moonId: s.moonId,
			ores: s.ores.map((o) => ({ oreTypeId: o.oreTypeId, quantity: o.quantity })),
		})),
		primaryChar?.characterId ?? null,
		canValidate
	)

	const rejected = parseResult.scans.length - eligibleScans.length

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
	if (!await hasMoonPerm(c.env, user.id, MOON_URNS.view, user.is_admin)) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const moonScan = getMoonScanStub(c.env)
	const scan = await moonScan.getScan(c.req.param('id'))
	if (!scan) return c.json({ error: 'Not found' }, 404)
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
