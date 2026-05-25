import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import fleetsRoutes from '../fleets'
import { getCachedUserPermissions } from '../../lib/groups-cache'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth:
		() =>
			async (_c: unknown, next: () => Promise<void>): Promise<void> => {
				await next()
			},
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedCharacterPermissions: vi.fn(),
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
				characterOwnerHash: 'owner-hash-1',
				characterId: '1001',
				characterName: 'Pilot One',
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

	app.route('/api/fleets', fleetsRoutes)
	return app
}

describe('fleets tracking routes', () => {
	const env = {
		FLEETS: { name: 'FLEETS' },
		BROADCASTS: { name: 'BROADCASTS' },
		ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
	} as any

	let fleetsStub: {
		startTrackingSession: ReturnType<typeof vi.fn>
		listTrackingSessions: ReturnType<typeof vi.fn>
		getTrackingSession: ReturnType<typeof vi.fn>
		getSessionLiveSnapshot: ReturnType<typeof vi.fn>
		getSessionSummary: ReturnType<typeof vi.fn>
		getStatsOverview: ReturnType<typeof vi.fn>
	}
	let broadcastsStub: {
		getBroadcastByFleetSessionId: ReturnType<typeof vi.fn>
	}
	let resolverStub: { resolveIds: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		vi.clearAllMocks()

		fleetsStub = {
			startTrackingSession: vi.fn(),
			listTrackingSessions: vi.fn(),
			getTrackingSession: vi.fn(),
			getSessionLiveSnapshot: vi.fn(),
			getSessionSummary: vi.fn(),
			getStatsOverview: vi.fn(),
		}
		broadcastsStub = {
			getBroadcastByFleetSessionId: vi.fn().mockResolvedValue(null),
		}
		resolverStub = {
			resolveIds: vi.fn().mockResolvedValue({ '1001': 'Pilot One' }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.FLEETS) return fleetsStub as any
			if (binding === env.BROADCASTS) return broadcastsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			throw new Error('Unexpected binding')
		})
	})

	it('blocks start tracking without create permission', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		const app = createApp(makeUser())

		const res = await app.request(
			'/api/fleets/tracking',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterId: '1001', name: 'Op Fleet' }),
			},
			env
		)

		expect(res.status).toBe(403)
		expect(fleetsStub.startTrackingSession).not.toHaveBeenCalled()
	})

	it('starts tracking when user has create permission and owns character', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.startTrackingSession.mockResolvedValue({ sessionId: 'session-abc' })
		const app = createApp(makeUser())

		const res = await app.request(
			'/api/fleets/tracking',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterId: '1001', name: 'Op Fleet' }),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fleetsStub.startTrackingSession).toHaveBeenCalledWith({
			characterId: '1001',
			startedByUserId: 'user-1',
			name: 'Op Fleet',
		})
	})

	it('scopes tracking list to self when user lacks view-all permission', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.listTrackingSessions.mockResolvedValue({ items: [], total: 0 })
		const app = createApp(makeUser({ id: 'self-user' }))

		const res = await app.request('/api/fleets/tracking?userId=other-user&limit=25&offset=0', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.listTrackingSessions).toHaveBeenCalledWith(
			expect.objectContaining({
				startedByUserId: 'self-user',
				limit: 25,
				offset: 0,
			})
		)
	})

	it('denies historical live detail to owner without view-all', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's1',
			status: 'ended',
			startedByUserId: 'user-1',
			characterId: '1001',
		})

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s1/live', {}, env)

		expect(res.status).toBe(403)
		expect(fleetsStub.getSessionLiveSnapshot).not.toHaveBeenCalled()
	})

	it('allows active owner live detail access', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-active',
			status: 'active',
			startedByUserId: 'user-1',
			characterId: '1001',
		})
		fleetsStub.getSessionLiveSnapshot.mockResolvedValue({ memberCount: 10 })

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s-active/live', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionLiveSnapshot).toHaveBeenCalledWith('s-active')
	})

	it('allows ended-session owner to access summary endpoint', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-ended',
			status: 'ended',
			startedByUserId: 'user-1',
			characterId: '1001',
		})
		fleetsStub.getSessionSummary.mockResolvedValue({ peakMemberCount: 42 })

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s-ended/summary', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionSummary).toHaveBeenCalledWith('s-ended')
	})

	it('returns 400 for invalid stats date range query', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		const app = createApp(makeUser({ id: 'viewer-1' }))

		const res = await app.request('/api/fleets/tracking/stats/overview?from=not-a-date', {}, env)

		expect(res.status).toBe(400)
		expect(fleetsStub.getStatsOverview).not.toHaveBeenCalled()
	})

	it('hydrates linked broadcast SRP/doctrine on session detail', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-broadcast',
			name: 'Fleet Op',
			characterId: '1001',
			startedByUserId: 'user-1',
			fleetId: 'fleet-1',
			status: 'ended',
			startedAt: '2026-05-25T10:00:00.000Z',
			endedAt: '2026-05-25T11:00:00.000Z',
			endedReason: 'user_stopped',
			endedByUserId: 'user-1',
			createdAt: '2026-05-25T10:00:00.000Z',
			updatedAt: '2026-05-25T11:00:00.000Z',
		})
		broadcastsStub.getBroadcastByFleetSessionId.mockResolvedValue({
			id: 'b-1',
			title: 'Ping',
			status: 'sent',
			sentAt: '2026-05-25T10:01:00.000Z',
			doctrineId: 'doc-1',
			srpMode: 'military',
			srpToken: 'token-123',
			content: { doctrine: 'Armor HAC' },
		})

		const app = createApp(makeUser({ id: 'viewer-1' }))
		const res = await app.request('/api/fleets/tracking/s-broadcast', {}, env)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toMatchObject({
			id: 's-broadcast',
			characterName: 'Pilot One',
			broadcast: {
				id: 'b-1',
				title: 'Ping',
				status: 'sent',
				doctrineId: 'doc-1',
				doctrine: 'Armor HAC',
				srpMode: 'military',
				srpToken: 'token-123',
			},
		})
	})
})
