import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import type { MoonScan } from '@repo/moon-scan'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import { moonScanRoutes } from '../moon-scan'

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

function makeScan(status: MoonScan['status'], submittedBy: string | null = '7777'): MoonScan {
	return {
		id: 'scan-1',
		moonId: '40161739',
		submittedBy,
		submittedAt: '2026-05-01T00:00:00.000Z',
		status,
		source: 'user',
		verifiedBy: null,
		verifiedAt: null,
		notes: null,
		ores: [],
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

describe('moon-scan access matrix', () => {
	const env = {
		MOON_SCAN: { name: 'MOON_SCAN' },
		UNIVERSE: { name: 'UNIVERSE' },
	} as any

	let moonScanStub: Record<string, ReturnType<typeof vi.fn>>
	let universeStub: Record<string, ReturnType<typeof vi.fn>>

	beforeEach(() => {
		vi.clearAllMocks()
		moonScanStub = {
			getLeaderboard: vi.fn(),
			getScan: vi.fn(),
			getScanSummary: vi.fn(),
			getScans: vi.fn(),
			resolveCharacterNames: vi.fn(),
		}
		universeStub = {
			getMoonRegionIds: vi.fn(),
			getRegionConnections: vi.fn(),
			getRegionStats: vi.fn(),
			resolveStaticMoonsByIds: vi.fn(),
			resolveRegionsByIds: vi.fn(),
			resolveTypeNamesByIds: vi.fn(),
		}
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.MOON_SCAN) return moonScanStub as any
			if (binding === env.UNIVERSE) return universeStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('allows moon viewers to read regions', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:view' }] as any)
		moonScanStub.getScanSummary.mockResolvedValue({ scannedMoonIds: [], verifiedMoonIds: [] })
		universeStub.resolveRegionsByIds.mockImplementation(async (ids: string[]) =>
			Object.fromEntries(ids.map((id) => [id, { regionId: id, regionName: `Region ${id}` }]))
		)
		universeStub.getRegionStats.mockImplementation(async (ids: string[]) =>
			Object.fromEntries(ids.map((id) => [id, { systemCount: 1, moonCount: 2 }]))
		)
		universeStub.getRegionConnections.mockResolvedValue([])

		const app = createApp(makeUser({ id: 'view-regions' }))
		const res = await app.request('/api/moon-scan/moons/regions', {}, env)

		expect(res.status).toBe(200)
		const body = await res.json() as { regions: Array<{ regionId: string }> }
		expect(body.regions.length).toBeGreaterThan(0)
	})

	it('denies submitters from reading regions', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)

		const app = createApp(makeUser({ id: 'submit-regions' }))
		const res = await app.request('/api/moon-scan/moons/regions', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows submitters to read the leaderboard', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)
		moonScanStub.getLeaderboard.mockResolvedValue([])

		const app = createApp(makeUser({ id: 'submit-leaderboard' }))
		const res = await app.request('/api/moon-scan/leaderboard', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual([])
	})

	it('denies moon viewers from reading the leaderboard', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:view' }] as any)

		const app = createApp(makeUser({ id: 'view-leaderboard' }))
		const res = await app.request('/api/moon-scan/leaderboard', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows validators to read the review queue', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:validate' }] as any)
		moonScanStub.getScans.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })

		const app = createApp(makeUser({ id: 'validate-queue' }))
		const res = await app.request('/api/moon-scan/scans/queue', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 })
	})

	it('enriches the review queue with moon, submitter, and ore type names', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:validate' }] as any)
		moonScanStub.getScans.mockResolvedValue({
			items: [
				{
					...makeScan('pending', '7777'),
					ores: [{ oreTypeId: '45490', quantity: '0.5' }],
				},
			],
			total: 1,
			page: 1,
			pageSize: 20,
		})
		moonScanStub.resolveCharacterNames.mockResolvedValue({ '7777': 'Submitting Pilot' })
		universeStub.resolveStaticMoonsByIds.mockResolvedValue({
			'40161739': {
				moonId: '40161739',
				moonName: 'Jita IV - Moon 4',
				solarSystemId: '30000142',
				solarSystemName: 'Jita',
			},
		})
		universeStub.resolveTypeNamesByIds.mockResolvedValue({
			'45490': {
				typeId: '45490',
				typeName: 'Bitumens',
			},
		})

		const app = createApp(makeUser({ id: 'validate-queue-enriched' }))
		const res = await app.request('/api/moon-scan/scans/queue', {}, env)

		expect(res.status).toBe(200)
		const body = await res.json() as {
			items: Array<{
				moonName: string
				submittedByName: string | null
				ores: Array<{ oreTypeName: string }>
			}>
		}
		expect(body.items).toHaveLength(1)
		expect(body.items[0]?.moonName).toBe('Jita IV - Moon 4')
		expect(body.items[0]?.submittedByName).toBe('Submitting Pilot')
		expect(body.items[0]?.ores[0]?.oreTypeName).toBe('Bitumens')
		expect(moonScanStub.resolveCharacterNames).toHaveBeenCalledWith(['7777'])
		expect(universeStub.resolveStaticMoonsByIds).toHaveBeenCalledWith(['40161739'])
		expect(universeStub.resolveTypeNamesByIds).toHaveBeenCalledWith(['45490'])
	})

	it('allows validators to read the scan list', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:validate' }] as any)
		moonScanStub.getScans.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })

		const app = createApp(makeUser({ id: 'validate-scan-list' }))
		const res = await app.request('/api/moon-scan/scans', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 })
	})

	it('denies submitters from reading the review queue', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)

		const app = createApp(makeUser({ id: 'submit-queue' }))
		const res = await app.request('/api/moon-scan/scans/queue', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('denies submitters from reading the scan list', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)

		const app = createApp(makeUser({ id: 'submit-scan-list' }))
		const res = await app.request('/api/moon-scan/scans', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows validators to read individual scans for review', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:validate' }] as any)
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))

		const app = createApp(makeUser({ id: 'validate-scan' }))
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', status: 'pending' })
	})

	it('denies submitters from reading individual scans', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))

		const app = createApp(makeUser({ id: 'submit-scan' }))
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('denies moon viewers from reading individual scans', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:view' }] as any)
		moonScanStub.getScan.mockResolvedValue(makeScan('verified'))

		const app = createApp(makeUser({ id: 'view-scan' }))
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows moon admins to read individual scans', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:admin' }] as any)
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))

		const app = createApp(makeUser({ id: 'moon-admin', is_admin: false }))
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', status: 'pending' })
	})

	it('allows moon admins to access configuration', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:admin' }] as any)
		moonScanStub.getExtractionSettings = vi.fn().mockResolvedValue({
			defaultReprocessingYield: '0.5',
			defaultCycleDays: 7,
			fuelBlockPriceOverride: null,
			magmaticGasPriceOverride: null,
		})
		moonScanStub.getStructureProfiles = vi.fn().mockResolvedValue([])

		const app = createApp(makeUser({ id: 'moon-admin-settings' }))
		const res = await app.request('/api/moon-scan/admin/settings', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({
			settings: {
				defaultReprocessingYield: '0.5',
				defaultCycleDays: 7,
			},
		})
	})
})
