import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

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
		id: 'submit-user-1',
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

function buildRawWithOres(
	ores: Array<{ oreName: string; quantity: string; oreTypeId: string }>,
	moonId: string
): string {
	return [
		'Moon\tOre\tQuantity\tOre Type ID\tSystem ID\tPlanet ID\tMoon ID',
		'Jita IV - Moon 4',
		...ores.map(
			(ore) => `\t${ore.oreName}\t${ore.quantity}\t${ore.oreTypeId}\t30000142\t40000001\t${moonId}`
		),
	].join('\n')
}

describe('moon-scan ingest sanitization', () => {
	const env = {
		MOON_SCAN: { name: 'MOON_SCAN' },
		UNIVERSE: { name: 'UNIVERSE' },
	} as any

	let moonScanStub: Record<string, ReturnType<typeof vi.fn>>
	let universeStub: Record<string, ReturnType<typeof vi.fn>>

	beforeEach(() => {
		vi.clearAllMocks()
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:submit' }] as any)

		moonScanStub = {
			cacheCharacterName: vi.fn().mockResolvedValue(undefined),
			submitScans: vi.fn().mockResolvedValue([]),
		}
		universeStub = {
			resolveSolarSystemsByIds: vi.fn().mockResolvedValue({
				'30000142': { solarSystemId: '30000142', solarSystemName: 'Jita', securityStatus: '0.5' },
			}),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.MOON_SCAN) return moonScanStub as any
			if (binding === env.UNIVERSE) return universeStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('rejects oversized parse payloads', async () => {
		const app = createApp(makeUser({ id: 'submit-user-oversized-parse' }))
		const raw = 'x'.repeat(1_000_001)
		const res = await app.request(
			'/api/moon-scan/scans/parse',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw }),
			},
			env
		)

		expect(res.status).toBe(413)
		expect(await res.json()).toEqual({ error: 'raw payload exceeds 1000000 bytes' })
	})

	it('rejects oversized submit payloads', async () => {
		const app = createApp(makeUser({ id: 'submit-user-oversized-submit' }))
		const raw = 'x'.repeat(1_000_001)
		const res = await app.request(
			'/api/moon-scan/scans/submit',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw }),
			},
			env
		)

		expect(res.status).toBe(413)
		expect(await res.json()).toEqual({ error: 'raw payload exceeds 1000000 bytes' })
	})

	it('hard-rejects invalid numeric moon IDs', async () => {
		const app = createApp(makeUser({ id: 'submit-user-invalid-id' }))
		const raw = buildRawWithOres(
			[
				{ oreName: 'Bitumens', quantity: '0.5', oreTypeId: '45490' },
				{ oreName: 'Coesite', quantity: '0.5', oreTypeId: '45491' },
			],
			'moon-abc'
		)

		const res = await app.request(
			'/api/moon-scan/scans/submit',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw }),
			},
			env
		)

		expect(res.status).toBe(400)
		const body = (await res.json()) as { parseErrors?: string[] }
		expect(body.parseErrors?.some((error) => error.includes('invalid moonId'))).toBe(true)
		expect(moonScanStub.submitScans).not.toHaveBeenCalled()
	})

	it('accepts observed quantity sums without requiring them to total exactly one', async () => {
		const app = createApp(makeUser({ id: 'submit-user-sum' }))
		const raw = buildRawWithOres(
			[
				{ oreName: 'Bitumens', quantity: '0.8', oreTypeId: '45490' },
				{ oreName: 'Coesite', quantity: '0.1', oreTypeId: '45491' },
			],
			'40161739'
		)

		const res = await app.request(
			'/api/moon-scan/scans/submit',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw }),
			},
			env
		)

		expect(res.status).toBe(200)
		const body = (await res.json()) as { submitted?: number }
		expect(body.submitted).toBe(0)
		expect(moonScanStub.submitScans).toHaveBeenCalled()
	})

	it('hard-rejects non-whitelisted ore type IDs', async () => {
		const app = createApp(makeUser({ id: 'submit-user-whitelist' }))
		const raw = buildRawWithOres(
			[
				{ oreName: 'Unknown Moon Ore', quantity: '0.5', oreTypeId: '99999' },
				{ oreName: 'Bitumens', quantity: '0.5', oreTypeId: '45490' },
			],
			'40161739'
		)

		const res = await app.request(
			'/api/moon-scan/scans/submit',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ raw }),
			},
			env
		)

		expect(res.status).toBe(400)
		const body = (await res.json()) as { parseErrors?: string[] }
		expect(body.parseErrors?.some((error) => error.includes('not allowed for moon scans'))).toBe(
			true
		)
		expect(moonScanStub.submitScans).not.toHaveBeenCalled()
	})

	it('allows validators to preview and submit scans with auto-verification', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:moons:scan:validate' }] as any)

		const app = createApp(makeUser({ id: 'validate-only-user' }))
		const body = JSON.stringify({
			raw: buildRawWithOres(
				[
					{ oreName: 'Bitumens', quantity: '0.5', oreTypeId: '45490' },
					{ oreName: 'Coesite', quantity: '0.5', oreTypeId: '45491' },
				],
				'40161739'
			),
		})

		const parseRes = await app.request(
			'/api/moon-scan/scans/parse',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			},
			env
		)
		const submitRes = await app.request(
			'/api/moon-scan/scans/submit',
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			},
			env
		)

		expect(parseRes.status).toBe(200)
		expect(submitRes.status).toBe(200)
		expect(moonScanStub.submitScans).toHaveBeenCalledWith(
			[
				{
					moonId: '40161739',
					solarSystemId: '30000142',
					regionId: undefined,
					ores: [
						{ oreTypeId: '45490', quantity: '0.500000' },
						{ oreTypeId: '45491', quantity: '0.500000' },
					],
				},
			],
			'1001',
			true
		)
	})
})
