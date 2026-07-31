import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import { clearMoonScanPricingCaches, moonScanRoutes } from '../moon-scan'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAllianceMember:
		() =>
		async (_c: unknown, next: () => Promise<void>): Promise<void> => {
			await next()
		},
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'uc-1',
				characterOwnerHash: 'owner-1',
				characterId: '1001',
				characterName: 'Main Pilot',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
		}
	}>()

	app.use('*', async (c, next) => {
		c.set('user', user)
		await next()
	})

	app.route('/api/moon-scan', moonScanRoutes)
	return app
}

describe('moon-scan profitability and batching behavior', () => {
	const env = {
		MOON_SCAN: { name: 'MOON_SCAN' },
		MOON_SCAN_EXPORTS: { name: 'MOON_SCAN_EXPORTS' },
		UNIVERSE: { name: 'UNIVERSE' },
		MARKETS: { name: 'MARKETS' },
		EXPORT_WORKFLOW: { create: vi.fn(), get: vi.fn() },
	} as any

	let moonScanStub: Record<string, ReturnType<typeof vi.fn>>
	let universeStub: Record<string, ReturnType<typeof vi.fn>>
	let marketsStub: Record<string, ReturnType<typeof vi.fn>>
	let exportWorkflowStub: {
		create: ReturnType<typeof vi.fn>
		get: ReturnType<typeof vi.fn>
	}
	let exportBucketStub: {
		get: ReturnType<typeof vi.fn>
		delete: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		clearMoonScanPricingCaches()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:view' }] as any)

		moonScanStub = {
			getMoonCoverage: vi.fn().mockResolvedValue([]),
			getVerifiedCompositions: vi.fn().mockResolvedValue([]),
			getVerifiedComposition: vi.fn().mockResolvedValue(null),
			getVerifiedMoonPage: vi.fn().mockResolvedValue({
				items: [],
				total: 0,
				page: 1,
				pageSize: 50,
				constellations: [],
			}),
			getVerifiedMoonSummaryIds: vi.fn().mockResolvedValue([]),
			getScannedMoonCountsByRegionIds: vi.fn().mockResolvedValue([]),
			getVerifiedMoonCountsByRegionIds: vi.fn().mockResolvedValue([]),
			upsertVerifiedMoonSummaries: vi.fn().mockResolvedValue(undefined),
			getScans: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
			resolveCharacterNames: vi.fn().mockResolvedValue({}),
			getScanSummary: vi.fn().mockResolvedValue({ scannedMoonIds: [], verifiedMoonIds: [] }),
			getExtractionSettings: vi.fn().mockResolvedValue({
				defaultReprocessingYield: '1',
				defaultCycleDays: 1,
				fuelBlockPriceOverride: null,
				magmaticGasPriceOverride: null,
			}),
			getStructureProfiles: vi.fn().mockResolvedValue([
				{
					id: 'tatara',
					baseVolumePerHr: '1000',
					rigBonus: '0',
					fuelPerHr: '10',
					magmaticGasPerHr: null,
					minCycleDays: null,
					maxCycleDays: null,
					isPassive: false,
					lowsecModifier: '1',
					nullsecModifier: '1',
				},
				{
					id: 'metenox',
					baseVolumePerHr: '1000',
					rigBonus: '0',
					fuelPerHr: '5',
					magmaticGasPerHr: '2',
					minCycleDays: null,
					maxCycleDays: null,
					isPassive: true,
					lowsecModifier: '1',
					nullsecModifier: '1',
				},
			]),
		}

		universeStub = {
			getSystemsByRegionId: vi.fn().mockResolvedValue([]),
			getStargatesBySystemIds: vi.fn().mockResolvedValue([]),
			getMoonsBySystemIds: vi.fn().mockResolvedValue({}),
			getMoonsBySystemId: vi.fn().mockResolvedValue([]),
			getRegionsBySystemIds: vi.fn().mockResolvedValue({}),
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({}),
			resolveStaticMoonsByIds: vi.fn().mockResolvedValue({}),
			getMoonRegionIds: vi.fn().mockResolvedValue({}),
			resolveRegionsByIds: vi.fn().mockResolvedValue({}),
			resolveConstellationsByIds: vi.fn().mockResolvedValue({}),
			getTypeMaterials: vi.fn().mockResolvedValue({}),
			resolveTypeNamesByIds: vi.fn().mockResolvedValue({}),
		}

		marketsStub = {
			getMarketDataRevisionAtTime: vi.fn().mockResolvedValue('revision-1'),
			getBatchMarketDataAtTime: vi.fn().mockResolvedValue({ prices: [] }),
		}
		const storedExports = new Map<string, { text: string; fileName: string }>()
		exportWorkflowStub = {
			create: vi.fn().mockResolvedValue({ id: 'workflow-1' }),
			get: vi.fn().mockResolvedValue({
				status: vi.fn().mockResolvedValue({
					status: 'queued',
					output: null,
				}),
			}),
		}
		exportBucketStub = {
			get: vi.fn(async (key: string) => {
				const stored = storedExports.get(key)
				if (!stored) return null
				const response = new Response(stored.text, {
					headers: { 'content-type': 'text/csv; charset=utf-8' },
				}) as Response & {
					customMetadata?: { fileName?: string }
					httpMetadata?: { contentType?: string }
				}
				response.customMetadata = { fileName: stored.fileName }
				response.httpMetadata = { contentType: 'text/csv; charset=utf-8' }
				return response
			}),
			delete: vi.fn().mockResolvedValue(undefined),
		}
		env.MOON_SCAN_EXPORTS = exportBucketStub as any
		env.EXPORT_WORKFLOW = exportWorkflowStub as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.MOON_SCAN) return moonScanStub as any
			if (binding === env.UNIVERSE) return universeStub as any
			if (binding === env.MARKETS) return marketsStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('uses batched moon lookup for region detail (no per-system moon RPC)', async () => {
		universeStub.getSystemsByRegionId.mockResolvedValue([
			{ solarSystemId: 'sys-low', solarSystemName: 'Low', securityStatus: '0.5' },
			{ solarSystemId: 'sys-high', solarSystemName: 'High', securityStatus: '0.8' },
			{ solarSystemId: 'sys-null', solarSystemName: 'Null', securityStatus: null },
		])
		universeStub.getMoonsBySystemIds.mockResolvedValue({
			'sys-low': [{ moonId: 'moon-1', moonName: 'Moon 1', solarSystemId: 'sys-low' }],
		})
		moonScanStub.getMoonCoverage.mockResolvedValue([
			{ moonId: 'moon-1', hasScans: true, isVerified: true },
		])

		const app = createApp(makeUser())
		const res = await app.request('/api/moon-scan/moons/region/10000002', {}, env)

		expect(res.status).toBe(200)
		expect(universeStub.getMoonsBySystemIds).toHaveBeenCalledWith([
			'sys-low',
			'sys-high',
			'sys-null',
		])
		expect(universeStub.getMoonsBySystemId).not.toHaveBeenCalled()
	})

	it('uses batched verified composition fetch for system detail', async () => {
		universeStub.resolveSolarSystemsByIds.mockResolvedValue({
			'sys-1': { solarSystemId: 'sys-1', solarSystemName: 'Jita', securityStatus: '0.5' },
		})
		universeStub.getMoonsBySystemId.mockResolvedValue([
			{ moonId: 'moon-1', moonName: 'Moon 1', solarSystemId: 'sys-1' },
			{ moonId: 'moon-2', moonName: 'Moon 2', solarSystemId: 'sys-1' },
		])
		moonScanStub.getMoonCoverage.mockResolvedValue([
			{ moonId: 'moon-1', hasScans: true, isVerified: true },
			{ moonId: 'moon-2', hasScans: true, isVerified: false },
		])
		moonScanStub.getVerifiedCompositions.mockResolvedValue([
			{
				moonId: 'moon-1',
				sourceScanId: 'scan-1',
				verifiedAt: '2026-05-01T00:00:00.000Z',
				verifiedBy: '1001',
				ores: [],
			},
		])

		const app = createApp(makeUser())
		const res = await app.request('/api/moon-scan/moons/system/sys-1', {}, env)
		const body = (await res.json()) as {
			moons: Array<{ moonId: string; composition: unknown | null }>
		}

		expect(res.status).toBe(200)
		expect(moonScanStub.getVerifiedCompositions).toHaveBeenCalledWith(['moon-1'])
		expect(moonScanStub.getVerifiedComposition).not.toHaveBeenCalled()
		expect(body.moons.find((m) => m.moonId === 'moon-1')?.composition).not.toBeNull()
		expect(body.moons.find((m) => m.moonId === 'moon-2')?.composition).toBeNull()
	})

	it('uses the database-backed page query for both pagination and profitability sorting', async () => {
		moonScanStub.getVerifiedMoonPage.mockResolvedValue({
			items: [
				{
					moonId: 'moon-1',
					moonName: 'Moon 1',
					solarSystemId: 'sys-1',
					solarSystemName: 'Jita',
					regionId: 'region-1',
					regionName: 'The Forge',
					constellationId: 'const-1',
					constellationName: 'Kimotoro',
					securityStatus: '0.5',
					highestRarity: 'R64',
					metenoxProfit: '12345',
					tataraProfit: '67890',
				},
			],
			total: 1,
			page: 1,
			pageSize: 50,
			constellations: [{ constellationId: 'const-1', constellationName: 'Kimotoro' }],
		})
		moonScanStub.getVerifiedCompositions.mockResolvedValue([
			{
				moonId: 'moon-1',
				sourceScanId: 'scan-1',
				verifiedAt: '2026-05-01T00:00:00.000Z',
				verifiedBy: '1001',
				ores: [{ oreTypeId: '45490', quantity: '1' }],
			},
		])
		universeStub.getTypeMaterials.mockResolvedValue({
			'45490': [{ materialTypeId: '16633', quantity: 100 }],
		})
		marketsStub.getBatchMarketDataAtTime.mockResolvedValue({
			prices: [
				{ typeId: '16633', bestSellPrice: '10' },
				{ typeId: '4247', bestSellPrice: '1' },
				{ typeId: '81143', bestSellPrice: '2' },
			],
		})

		const app = createApp(makeUser())
		const res = await app.request('/api/moon-scan/moons/verified', {}, env)
		const body = (await res.json()) as {
			items: Array<{ moonId: string; moonName: string; metenoxProfit: string | null }>
			total: number
			constellations: Array<{ constellationId: string }>
		}

		expect(res.status).toBe(200)
		expect(moonScanStub.getVerifiedMoonPage).toHaveBeenCalledWith(
			expect.objectContaining({
				profitability: expect.objectContaining({
					defaultCycleDays: 1,
					prices: expect.any(Array),
				}),
			})
		)
		expect(moonScanStub.getVerifiedCompositions).not.toHaveBeenCalled()
		expect(universeStub.resolveStaticMoonsByIds).not.toHaveBeenCalled()
		expect(body.total).toBe(1)
		expect(body.items).toHaveLength(1)
		expect(body.items[0]?.moonId).toBe('moon-1')
		expect(body.items[0]?.metenoxProfit).toBe('12345')
	})

	it('applies fuel and magmatic override prices in single-moon profitability', async () => {
		moonScanStub.getExtractionSettings.mockResolvedValue({
			defaultReprocessingYield: '1',
			defaultCycleDays: 1,
			fuelBlockPriceOverride: '999',
			magmaticGasPriceOverride: '555',
		})
		moonScanStub.getVerifiedComposition.mockResolvedValue({
			moonId: 'moon-1',
			sourceScanId: 'scan-1',
			verifiedAt: '2026-05-01T00:00:00.000Z',
			verifiedBy: null,
			ores: [{ oreTypeId: '45490', quantity: '1' }],
		})
		universeStub.resolveStaticMoonsByIds.mockResolvedValue({
			'moon-1': { moonId: 'moon-1', moonName: 'Moon 1', solarSystemId: 'sys-1' },
		})
		universeStub.resolveSolarSystemsByIds.mockResolvedValue({
			'sys-1': { solarSystemId: 'sys-1', solarSystemName: 'Jita', securityStatus: '0.5' },
		})
		universeStub.getTypeMaterials.mockResolvedValue({
			'45490': [{ materialTypeId: '16633', quantity: 100 }],
		})
		universeStub.resolveTypeNamesByIds.mockResolvedValue({
			'45490': { typeId: '45490', typeName: 'Bitumens', groupId: '1', groupName: 'Moon Ore' },
			'16633': {
				typeId: '16633',
				typeName: 'Hydrocarbons',
				groupId: '2',
				groupName: 'Moon Materials',
			},
		})
		marketsStub.getBatchMarketDataAtTime.mockResolvedValue({
			prices: [
				{ typeId: '16633', bestSellPrice: '10' },
				{ typeId: '4247', bestSellPrice: '1' },
				{ typeId: '81143', bestSellPrice: '2' },
			],
		})

		const app = createApp(makeUser())
		const res = await app.request('/api/moon-scan/moons/moon-1', {}, env)
		const body = (await res.json()) as {
			profitability: {
				structures: Array<{
					structureType: 'tatara' | 'metenox'
					fuelCost: string
					magmaticGasCost: string | null
				}>
			} | null
		}

		expect(res.status).toBe(200)
		expect(body.profitability).not.toBeNull()

		const tatara = body.profitability!.structures.find((s) => s.structureType === 'tatara')
		const metenox = body.profitability!.structures.find((s) => s.structureType === 'metenox')
		expect(tatara?.fuelCost).toBe('239760')
		expect(metenox?.fuelCost).toBe('119880')
		expect(metenox?.magmaticGasCost).toBe('26640')
	})

	it('prices discovered refine materials in verified moon list flow', async () => {
		moonScanStub.getScanSummary.mockResolvedValue({
			scannedMoonIds: ['moon-1'],
			verifiedMoonIds: ['moon-1'],
		})
		moonScanStub.getVerifiedMoonSummaryIds.mockResolvedValue(['moon-1'])
		moonScanStub.getVerifiedMoonPage.mockResolvedValue({
			items: [
				{
					moonId: 'moon-1',
					moonName: 'Moon 1',
					solarSystemId: 'sys-1',
					solarSystemName: 'Jita',
					regionId: '10000002',
					regionName: 'The Forge',
					constellationId: 'const-1',
					constellationName: 'Kimotoro',
					securityStatus: '0.5',
					highestRarity: 'R64',
				},
			],
			total: 1,
			page: 1,
			pageSize: 50,
			constellations: [{ constellationId: 'const-1', constellationName: 'Kimotoro' }],
		})
		moonScanStub.getVerifiedCompositions.mockResolvedValue([
			{
				moonId: 'moon-1',
				sourceScanId: 'scan-1',
				verifiedAt: '2026-05-01T00:00:00.000Z',
				verifiedBy: null,
				ores: [{ oreTypeId: '45490', quantity: '1' }],
			},
		])
		universeStub.resolveStaticMoonsByIds.mockResolvedValue({
			'moon-1': { moonId: 'moon-1', moonName: 'Moon 1', solarSystemId: 'sys-1' },
		})
		universeStub.resolveSolarSystemsByIds.mockResolvedValue({
			'sys-1': { solarSystemId: 'sys-1', solarSystemName: 'Jita', securityStatus: '0.5' },
		})
		universeStub.getMoonRegionIds.mockResolvedValue({ 'moon-1': '10000002' })
		universeStub.resolveRegionsByIds.mockResolvedValue({
			'10000002': { regionId: '10000002', regionName: 'The Forge' },
		})
		universeStub.getTypeMaterials.mockResolvedValue({
			'45490': [{ materialTypeId: '99999', quantity: 100 }],
		})
		marketsStub.getBatchMarketDataAtTime.mockResolvedValue({
			prices: [
				{ typeId: '99999', bestSellPrice: '42' },
				{ typeId: '4247', bestSellPrice: '1' },
				{ typeId: '81143', bestSellPrice: '2' },
			],
		})

		const app = createApp(makeUser())
		const res = await app.request('/api/moon-scan/moons/verified?search=refine-materials', {}, env)

		expect(res.status).toBe(200)
		expect(marketsStub.getBatchMarketDataAtTime).toHaveBeenCalledTimes(1)
		const call = marketsStub.getBatchMarketDataAtTime.mock.calls[0]?.[0] as {
			typeIds: string[]
		}
		expect(call.typeIds).toContain('99999')
		expect(call.typeIds).toContain('4247')
		expect(call.typeIds).toContain('81143')
	})

	it('batches verified moon summary backfill writes', async () => {
		const verifiedMoonIds = Array.from({ length: 501 }, (_value, index) => `moon-${index + 1}`)
		moonScanStub.getScanSummary.mockResolvedValue({
			scannedMoonIds: verifiedMoonIds,
			verifiedMoonIds,
		})
		moonScanStub.getVerifiedMoonSummaryIds.mockResolvedValue([])
		moonScanStub.getVerifiedMoonPage.mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			pageSize: 50,
			constellations: [],
		})
		moonScanStub.getVerifiedCompositions.mockImplementation(async (moonIds: string[]) =>
			moonIds.map((moonId) => ({
				moonId,
				sourceScanId: `scan-${moonId}`,
				verifiedAt: '2026-05-01T00:00:00.000Z',
				verifiedBy: null,
				ores: [],
			}))
		)
		universeStub.resolveStaticMoonsByIds.mockImplementation(async (moonIds: string[]) =>
			Object.fromEntries(
				moonIds.map((moonId) => [
					moonId,
					{
						moonId,
						moonName: `Moon ${moonId}`,
						solarSystemId: `sys-${moonId}`,
					},
				])
			)
		)
		universeStub.resolveSolarSystemsByIds.mockImplementation(async (systemIds: string[]) =>
			Object.fromEntries(
				systemIds.map((systemId) => [
					systemId,
					{
						solarSystemId: systemId,
						solarSystemName: `System ${systemId}`,
						regionId: 'region-1',
						constellationId: 'const-1',
						securityStatus: '0.5',
					},
				])
			)
		)
		universeStub.resolveRegionsByIds.mockResolvedValue({
			'region-1': { regionId: 'region-1', regionName: 'Region 1' },
		})
		universeStub.resolveConstellationsByIds.mockResolvedValue({
			'const-1': { constellationId: 'const-1', constellationName: 'Constellation 1' },
		})

		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:admin' }] as any)
		const app = createApp(makeUser())
		const res = await app.request(
			'/api/moon-scan/admin/verified-moon-summaries/backfill',
			{
				method: 'POST',
			},
			env
		)

		expect(res.status).toBe(200)
		expect(moonScanStub.upsertVerifiedMoonSummaries).toHaveBeenCalledTimes(3)
		for (const call of moonScanStub.upsertVerifiedMoonSummaries.mock.calls) {
			const summaries = call[0] as Array<{ moonId: string }>
			expect(summaries.length).toBeLessThanOrEqual(250)
		}
	})

	it('starts a chunked export workflow and ignores sort params', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/moon-scan/moons/verified/export?regionId=region-1&sortBy=moonName&sortDir=asc',
			{ method: 'POST' },
			env
		)
		expect(response.status).toBe(202)
		const payload = (await response.json()) as {
			exportId: string
			fileName: string
			workflowInstanceId: string
		}
		expect(payload.fileName).toMatch(/^scanned-moons-export-/)
		const workflowInput = exportWorkflowStub.create.mock.calls[0]?.[0] as {
			params?: { query?: Record<string, unknown> }
		}
		expect(workflowInput.params?.query).toMatchObject({ regionId: 'region-1' })
		expect(workflowInput.params?.query).not.toHaveProperty('sortBy')
		expect(workflowInput.params?.query).not.toHaveProperty('sortDir')

		const key = `moon-scan/verified-moons-exports/${payload.exportId}.csv`
		const csv = 'regionId,regionName,solarSystemId,solarSystemName,moonId,moonName\nmoon-1'
		const responseBody = new Response(csv, {
			headers: { 'content-type': 'text/csv; charset=utf-8' },
		}) as Response & {
			customMetadata?: { fileName?: string }
			httpMetadata?: { contentType?: string }
		}
		responseBody.customMetadata = { fileName: payload.fileName }
		responseBody.httpMetadata = { contentType: 'text/csv; charset=utf-8' }
		const storedExports = new Map<string, Response>()
		storedExports.set(key, responseBody)
		exportBucketStub.get.mockImplementation(
			async (requestKey: string) => storedExports.get(requestKey) ?? null
		)

		const exportResponse = await app.request(
			`/api/moon-scan/moons/verified/export/${payload.exportId}/download`,
			{},
			env
		)
		expect(exportResponse.status).toBe(200)
		expect(exportResponse.headers.get('content-type')).toContain('text/csv')
		expect(exportResponse.headers.get('content-disposition')).toContain(payload.fileName)
		expect(await exportResponse.text()).toContain('moon-1')
		expect(exportBucketStub.delete).toHaveBeenCalledWith(key)
	})

	it('allows constellation-scoped exports without a region', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/moon-scan/moons/verified/export?constellationId=const-1&sortBy=moonName&sortDir=asc',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(202)
		const workflowInput = exportWorkflowStub.create.mock.calls[0]?.[0] as {
			params?: { query?: Record<string, unknown> }
		}
		expect(workflowInput.params?.query).toMatchObject({ constellationId: 'const-1' })
		expect(workflowInput.params?.query?.regionId).toBeUndefined()
	})

	it('returns workflow status for an export', async () => {
		exportWorkflowStub.get.mockResolvedValue({
			status: vi.fn().mockResolvedValue({
				status: 'complete',
				output: {
					status: 'completed',
					rowCount: 1,
					fileName: 'scanned-moons-export-12345678.csv',
				},
			}),
		})

		const app = createApp(makeUser())
		const response = await app.request('/api/moon-scan/moons/verified/export/workflow-1', {}, env)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			workflowInstanceId: 'workflow-1',
			status: 'completed',
		})
	})

	it('ignores profit sort params when starting the export workflow', async () => {
		moonScanStub.getScanSummary.mockResolvedValue({
			scannedMoonIds: ['moon-1', 'moon-2'],
			verifiedMoonIds: ['moon-1', 'moon-2'],
		})
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/moon-scan/moons/verified/export?regionId=region-1&sortBy=metenoxProfit&sortDir=desc',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(202)
		expect(await response.json()).toMatchObject({
			exportId: 'workflow-1',
			workflowInstanceId: 'workflow-1',
		})
		const workflowInput = exportWorkflowStub.create.mock.calls[0]?.[0] as {
			params?: { query?: Record<string, unknown> }
		}
		expect(workflowInput.params?.query).toMatchObject({ regionId: 'region-1' })
		expect(workflowInput.params?.query).not.toHaveProperty('sortBy')
		expect(workflowInput.params?.query).not.toHaveProperty('sortDir')
	})
})
