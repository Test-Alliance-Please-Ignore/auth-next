import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import fleetsRoutes from '../fleets'
import { createDb } from '../../db'
import { getCachedUserPermissions } from '../../lib/groups-cache'

import type { SessionUser } from '../../context'
import type * as DbModule from '../../db'

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

// Preserve the real Drizzle `schema` (table definitions, no DB connection) but
// stub `createDb` so the corp-stats handler doesn't hit a real database.
vi.mock('../../db', async (importOriginal) => {
	const actual = await importOriginal<typeof DbModule>()
	return { ...actual, createDb: vi.fn() }
})

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const createDbMock = vi.mocked(createDb)

/**
 * Chainable Drizzle `select().from().where().limit()` stub that resolves to the
 * provided rows. Used for the corp-name lookup in the corp-stats handler.
 */
function makeDbStub(rows: unknown[]): any {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows),
	}
	return { select: () => chain }
}

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
		DATABASE_URL: 'postgres://test',
		FLEETS: { name: 'FLEETS' },
		BROADCASTS: { name: 'BROADCASTS' },
		ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
		EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
	} as any

	let fleetsStub: {
		startTrackingSession: ReturnType<typeof vi.fn>
		listTrackingSessions: ReturnType<typeof vi.fn>
		getTrackingSession: ReturnType<typeof vi.fn>
		getSessionLiveSnapshot: ReturnType<typeof vi.fn>
		getSessionTimeline: ReturnType<typeof vi.fn>
		getSessionRoster: ReturnType<typeof vi.fn>
		getSessionSummary: ReturnType<typeof vi.fn>
		getStatsOverview: ReturnType<typeof vi.fn>
		getCharactersByCorpInWindow: ReturnType<typeof vi.fn>
		getStatsForCharacters: ReturnType<typeof vi.fn>
	}
	let broadcastsStub: {
		getBroadcastByFleetSessionId: ReturnType<typeof vi.fn>
	}
	let resolverStub: { resolveIds: ReturnType<typeof vi.fn> }
	let corpDataStub: {
		getCorporationInfo: ReturnType<typeof vi.fn>
		getDirectors: ReturnType<typeof vi.fn>
	}
	let charDataStub: { getCharacterInfo: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		vi.clearAllMocks()

		fleetsStub = {
			startTrackingSession: vi.fn(),
			listTrackingSessions: vi.fn(),
			getTrackingSession: vi.fn(),
			getSessionLiveSnapshot: vi.fn(),
			getSessionTimeline: vi.fn(),
			getSessionRoster: vi.fn(),
			getSessionSummary: vi.fn(),
			getStatsOverview: vi.fn(),
			getCharactersByCorpInWindow: vi.fn().mockResolvedValue([]),
			getStatsForCharacters: vi.fn().mockResolvedValue({}),
		}
		broadcastsStub = {
			getBroadcastByFleetSessionId: vi.fn().mockResolvedValue(null),
		}
		resolverStub = {
			resolveIds: vi.fn().mockResolvedValue({ '1001': 'Pilot One' }),
		}
		corpDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue(null),
			getDirectors: vi.fn().mockResolvedValue([]),
		}
		charDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue(null),
		}

		// Default: corp-name lookup returns one row.
		createDbMock.mockReturnValue(makeDbStub([{ name: 'Test Corp' }]))

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.FLEETS) return fleetsStub as any
			if (binding === env.BROADCASTS) return broadcastsStub as any
			if (binding === env.ESI_TYPE_RESOLVER) return resolverStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpDataStub as any
			if (binding === env.EVE_CHARACTER_DATA) return charDataStub as any
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

	it('scopes tracking list to self when user lacks view-fleets permission', async () => {
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

	it('allows :view-fleets users to filter the tracking list by any userId', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:fleet-tracking:view-fleets' },
		] as any)
		fleetsStub.listTrackingSessions.mockResolvedValue({ items: [], total: 0 })
		const app = createApp(makeUser({ id: 'self-user' }))

		const res = await app.request('/api/fleets/tracking?userId=other-user&limit=25&offset=0', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.listTrackingSessions).toHaveBeenCalledWith(
			expect.objectContaining({
				startedByUserId: 'other-user',
				limit: 25,
				offset: 0,
			})
		)
	})

	it('allows ended-session owner to access historical detail without view-fleets', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's1',
			status: 'ended',
			startedByUserId: 'user-1',
			characterId: '1001',
		})
		fleetsStub.getSessionTimeline.mockResolvedValue({
			items: [],
			total: 0,
			limit: 25,
			offset: 0,
		})

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s1/timeline?limit=25&offset=0', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionTimeline).toHaveBeenCalledWith({
			sessionId: 's1',
			eventType: undefined,
			characterId: undefined,
			limit: 25,
			offset: 0,
		})
	})

	it('allows commander-owned sessions to access historical detail without view-fleets', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's1',
			status: 'ended',
			startedByUserId: 'other-user',
			characterId: '2002',
		})
		fleetsStub.getSessionTimeline.mockResolvedValue({
			items: [],
			total: 0,
			limit: 25,
			offset: 0,
		})

		const app = createApp(
			makeUser({
				id: 'user-1',
				mainCharacterId: '1001',
				characters: [
					{
						id: 'uc-1',
						characterOwnerHash: 'owner-hash-1',
						characterId: '1001',
						characterName: 'Pilot One',
						is_primary: true,
						hasValidToken: true,
					},
					{
						id: 'uc-2',
						characterOwnerHash: 'owner-hash-2',
						characterId: '2002',
						characterName: 'Pilot Two',
						is_primary: false,
						hasValidToken: true,
					},
				],
			})
		)
		const res = await app.request('/api/fleets/tracking/s1/timeline?limit=25&offset=0', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionTimeline).toHaveBeenCalledWith({
			sessionId: 's1',
			eventType: undefined,
			characterId: undefined,
			limit: 25,
			offset: 0,
		})
	})

	it('allows :view-fleets users to view ended sessions belonging to other users', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:fleet-tracking:view-fleets' },
		] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's1',
			status: 'ended',
			startedByUserId: 'other-user',
			characterId: '1001',
		})
		fleetsStub.getSessionLiveSnapshot.mockResolvedValue({ memberCount: 5 })

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s1/live', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionLiveSnapshot).toHaveBeenCalledWith('s1')
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

	// ------------------------------------------------------------------
	// Corp stats access: view-all/admin OR corp self-service (CEO/Director).
	// Each case uses distinct user + corp ids to avoid the module-level
	// 60s self-service cache (keyed by `${user.id}:${corporationId}`) and the
	// 5min response cache (keyed by corpId) bleeding across tests.
	// ------------------------------------------------------------------

	function makeLeaderUser(id: string, characterId: string): SessionUser {
		return makeUser({
			id,
			characters: [
				{
					id: 'uc-lead',
					characterOwnerHash: `hash-${characterId}`,
					characterId,
					characterName: 'Leader',
					is_primary: true,
					hasValidToken: true,
				},
			],
		})
	}

	it('allows a corp CEO to view their own corp stats without view-all', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '2001' })
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '500' })

		const app = createApp(makeLeaderUser('ceo-user', '2001'))
		const res = await app.request('/api/fleets/tracking/stats/corporations/500', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getCharactersByCorpInWindow).toHaveBeenCalledWith('500', expect.anything())
	})

	it('allows a corp Director to view their own corp stats without view-all', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' })
		corpDataStub.getDirectors.mockResolvedValue([{ characterId: '2002' }])
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '501' })

		const app = createApp(makeLeaderUser('director-user', '2002'))
		const res = await app.request('/api/fleets/tracking/stats/corporations/501', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getCharactersByCorpInWindow).toHaveBeenCalledWith('501', expect.anything())
	})

	it('denies a plain corp member (not CEO/Director) from corp stats', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' })
		corpDataStub.getDirectors.mockResolvedValue([])
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '502' })

		const app = createApp(makeLeaderUser('member-user', '2003'))
		const res = await app.request('/api/fleets/tracking/stats/corporations/502', {}, env)

		expect(res.status).toBe(403)
		expect(fleetsStub.getCharactersByCorpInWindow).not.toHaveBeenCalled()
	})

	it('denies a CEO of a different corp from viewing another corp stats', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		// CEO of their own corp (600), but they request corp 503.
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '2004' })
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '600' })

		const app = createApp(makeLeaderUser('other-corp-ceo', '2004'))
		const res = await app.request('/api/fleets/tracking/stats/corporations/503', {}, env)

		expect(res.status).toBe(403)
		expect(fleetsStub.getCharactersByCorpInWindow).not.toHaveBeenCalled()
	})

	it('still allows view-all viewers to see any corp stats (no corp-leadership lookup)', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)

		const app = createApp(makeUser({ id: 'viewall-user' }))
		const res = await app.request('/api/fleets/tracking/stats/corporations/504', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getCharactersByCorpInWindow).toHaveBeenCalledWith('504', expect.anything())
		// Org-wide viewers short-circuit before any corp Durable Object lookup.
		expect(corpDataStub.getCorporationInfo).not.toHaveBeenCalled()
	})

	it('still allows site admins to see any corp stats (no corp-leadership lookup)', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])

		const app = createApp(makeUser({ id: 'admin-user', is_admin: true }))
		const res = await app.request('/api/fleets/tracking/stats/corporations/505', {}, env)

		expect(res.status).toBe(200)
		expect(corpDataStub.getCorporationInfo).not.toHaveBeenCalled()
	})
})
