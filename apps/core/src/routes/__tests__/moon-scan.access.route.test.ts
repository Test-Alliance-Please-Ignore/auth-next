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

describe('moon-scan scan detail access', () => {
	const env = {
		MOON_SCAN: { name: 'MOON_SCAN' },
	} as any

	let moonScanStub: {
		getScan: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()
		moonScanStub = {
			getScan: vi.fn(),
		}
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.MOON_SCAN) return moonScanStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('allows viewers to read verified scans', async () => {
		const user = makeUser({ id: 'viewer-verified' })
		moonScanStub.getScan.mockResolvedValue(makeScan('verified'))
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:moons:view' },
		] as any)

		const app = createApp(user)
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', status: 'verified' })
	})

	it('denies plain viewers from reading pending scans', async () => {
		const user = makeUser({ id: 'viewer-pending' })
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:moons:view' },
		] as any)

		const app = createApp(user)
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(403)
		expect(await res.json()).toEqual({ error: 'Forbidden' })
	})

	it('allows validator to read pending scans', async () => {
		const user = makeUser({ id: 'validator-pending' })
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:moons:validate' },
		] as any)

		const app = createApp(user)
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', status: 'pending' })
	})

	it('allows scan owner to read their own pending scan', async () => {
		const user = makeUser({
			id: 'owner-pending',
			characters: [
				{
					id: 'uc-42',
					characterOwnerHash: 'owner-42',
					characterId: '4242',
					characterName: 'Owner Pilot',
					is_primary: true,
					hasValidToken: true,
				},
			],
		})
		moonScanStub.getScan.mockResolvedValue(makeScan('pending', '4242'))
		getCachedUserPermissionsMock.mockResolvedValue([] as any)

		const app = createApp(user)
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', submittedBy: '4242' })
	})

	it('allows admin to read pending scans without moon permissions', async () => {
		const user = makeUser({
			id: 'admin-pending',
			is_admin: true,
		})
		moonScanStub.getScan.mockResolvedValue(makeScan('pending'))
		getCachedUserPermissionsMock.mockResolvedValue([] as any)

		const app = createApp(user)
		const res = await app.request('/api/moon-scan/scans/scan-1', {}, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ id: 'scan-1', status: 'pending' })
	})
})
