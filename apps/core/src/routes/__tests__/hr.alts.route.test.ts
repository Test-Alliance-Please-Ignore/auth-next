import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import hrRoutes from '../hr'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn().mockResolvedValue([]),
}))

const getStubMock = vi.mocked(getStub)

// ============================================================================
// Helpers
// ============================================================================

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '1001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'uc-main',
				characterOwnerHash: 'hash-main',
				characterId: '1001',
				characterName: 'Main Pilot',
				is_primary: true,
				hasValidToken: true,
			},
			{
				id: 'uc-alt1',
				characterOwnerHash: 'hash-alt1',
				characterId: '2001',
				characterName: 'Alt One',
				is_primary: false,
				hasValidToken: true,
			},
			{
				id: 'uc-alt2',
				characterOwnerHash: 'hash-alt2',
				characterId: '2002',
				characterName: 'Alt Two',
				is_primary: false,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function makeHrStub() {
	return {
		addApplicationAlts: vi.fn().mockResolvedValue(undefined),
		removeApplicationAlt: vi.fn().mockResolvedValue(undefined),
		// Minimal stubs for other methods the route file might call
		getUserRoles: vi.fn().mockResolvedValue([]),
		getUserHrCorporations: vi.fn().mockResolvedValue([]),
		checkPermission: vi.fn().mockResolvedValue(false),
		listApplications: vi.fn().mockResolvedValue([]),
		getApplication: vi.fn().mockResolvedValue(null),
		listMessages: vi.fn().mockResolvedValue([]),
		getMessageCount: vi.fn().mockResolvedValue(0),
	}
}

function createApp(opts: { user?: SessionUser }) {
	const app = new Hono<{ Bindings: any; Variables: any }>()
	app.use('*', async (c, next) => {
		if (opts.user) c.set('user', opts.user)
		await next()
	})
	app.route('/api/hr', hrRoutes)
	return app
}

const env = {
	HR: { name: 'HR' },
	ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
	ESI: { name: 'ESI' },
	CORE: { getCharacterOwner: vi.fn() },
	ADMIN: { searchUsers: vi.fn(), getUserDetails: vi.fn() },
} as any

// ============================================================================
// POST /api/hr/applications/:id/alts
// ============================================================================

describe('POST /api/hr/applications/:id/alts', () => {
	let hrStub: ReturnType<typeof makeHrStub>

	beforeEach(() => {
		vi.clearAllMocks()
		hrStub = makeHrStub()
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			throw new Error(`Unexpected binding: ${JSON.stringify(binding)}`)
		})
	})

	it('returns 401 when not authenticated', async () => {
		const app = createApp({})
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ altCharacterIds: ['2001'] }),
			},
			env
		)
		expect(res.status).toBe(401)
	})

	it('returns 400 when body is missing', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
			},
			env
		)
		expect(res.status).toBe(400)
	})

	it('returns 400 when altCharacterIds is not an array', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ altCharacterIds: '2001' }),
			},
			env
		)
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('altCharacterIds') })
	})

	it('returns 400 when altCharacterIds is an empty array', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ altCharacterIds: [] }),
			},
			env
		)
		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ error: expect.stringContaining('altCharacterIds') })
	})

	it('calls addApplicationAlts with resolved character names and returns 200', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ altCharacterIds: ['2001', '2002'] }),
			},
			env
		)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
		expect(hrStub.addApplicationAlts).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			[
				{ characterId: '2001', characterName: 'Alt One' },
				{ characterId: '2002', characterName: 'Alt Two' },
			]
		)
	})

	it('returns 400 when service throws (e.g. terminal application state)', async () => {
		hrStub.addApplicationAlts.mockRejectedValue(
			new Error('You can only modify alts on active applications')
		)
		const app = createApp({ user: makeUser() })
		const res = await app.request(
			'/api/hr/applications/app-1/alts',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ altCharacterIds: ['2001'] }),
			},
			env
		)

		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({
			error: 'You can only modify alts on active applications',
		})
	})
})

// ============================================================================
// DELETE /api/hr/applications/:id/alts/:altCharacterId
// ============================================================================

describe('DELETE /api/hr/applications/:id/alts/:altCharacterId', () => {
	let hrStub: ReturnType<typeof makeHrStub>

	beforeEach(() => {
		vi.clearAllMocks()
		hrStub = makeHrStub()
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			throw new Error(`Unexpected binding: ${JSON.stringify(binding)}`)
		})
	})

	it('returns 401 when not authenticated', async () => {
		const app = createApp({})
		const res = await app.request('/api/hr/applications/app-1/alts/2001', { method: 'DELETE' }, env)
		expect(res.status).toBe(401)
	})

	it('calls removeApplicationAlt with resolved character names and returns 200', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request('/api/hr/applications/app-1/alts/2001', { method: 'DELETE' }, env)

		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ success: true })
		expect(hrStub.removeApplicationAlt).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			'2001',
			'Alt One'
		)
	})

	it('uses "Unknown" as altCharacterName when alt is not in user characters', async () => {
		const app = createApp({ user: makeUser() })
		const res = await app.request('/api/hr/applications/app-1/alts/9999', { method: 'DELETE' }, env)

		expect(res.status).toBe(200)
		expect(hrStub.removeApplicationAlt).toHaveBeenCalledWith(
			'app-1',
			'user-1',
			'1001',
			'Main Pilot',
			'9999',
			'Unknown'
		)
	})

	it('returns 400 when service throws (e.g. terminal application state)', async () => {
		hrStub.removeApplicationAlt.mockRejectedValue(
			new Error('You can only modify alts on active applications')
		)
		const app = createApp({ user: makeUser() })
		const res = await app.request('/api/hr/applications/app-1/alts/2001', { method: 'DELETE' }, env)

		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({
			error: 'You can only modify alts on active applications',
		})
	})
})
