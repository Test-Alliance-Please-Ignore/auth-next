import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import { createWorkflow } from '@repo/workflow-utils'

import { createDb } from '../../db'
import { getCachedUserPermissions } from '../../lib/groups-cache'
import fleetsRoutes from '../fleets'

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
	requireAllianceMember:
		() =>
		async (_c: unknown, next: () => Promise<void>): Promise<void> => {
			await next()
		},
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedCharacterPermissions: vi.fn(),
}))

vi.mock('@repo/workflow-utils', () => ({
	createWorkflow: vi.fn(),
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
const createWorkflowMock = vi.mocked(createWorkflow)

/**
 * Chainable Drizzle `select().from().where().limit()` stub that resolves to the
 * provided rows. Used for the corp-name lookup in the corp-stats handler.
 */
function makeDbStub(rows: unknown[]): any {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
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
		stopTrackingSession: ReturnType<typeof vi.fn>
		getCharacterFleetInformation: ReturnType<typeof vi.fn>
		getActiveTrackingSessionByFleetId: ReturnType<typeof vi.fn>
		getLatestTrackingSessionByFleetId: ReturnType<typeof vi.fn>
		listTrackingSessions: ReturnType<typeof vi.fn>
		getTrackingSession: ReturnType<typeof vi.fn>
		getSessionLiveSnapshot: ReturnType<typeof vi.fn>
		getSessionLiveMemberLocations: ReturnType<typeof vi.fn>
		getSessionTimeline: ReturnType<typeof vi.fn>
		getSessionCommanderHistory: ReturnType<typeof vi.fn>
		getSessionRoster: ReturnType<typeof vi.fn>
		getSessionSummary: ReturnType<typeof vi.fn>
		getStatsOverview: ReturnType<typeof vi.fn>
		getCorpRollupForOverview: ReturnType<typeof vi.fn>
		getStatsForCharacter: ReturnType<typeof vi.fn>
		getCharacterFleetSessionsPage: ReturnType<typeof vi.fn>
		getUserFleetSessionsPage: ReturnType<typeof vi.fn>
		getCharactersByCorpInWindow: ReturnType<typeof vi.fn>
		getStatsForCharacters: ReturnType<typeof vi.fn>
		getCorporationFleetParticipationMonths: ReturnType<typeof vi.fn>
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
			stopTrackingSession: vi.fn(),
			getCharacterFleetInformation: vi.fn(),
			getActiveTrackingSessionByFleetId: vi.fn(),
			getLatestTrackingSessionByFleetId: vi.fn(),
			listTrackingSessions: vi.fn(),
			getTrackingSession: vi.fn(),
			getSessionLiveSnapshot: vi.fn(),
			getSessionLiveMemberLocations: vi.fn(),
			getSessionTimeline: vi.fn(),
			getSessionCommanderHistory: vi.fn(),
			getSessionRoster: vi.fn(),
			getSessionSummary: vi.fn(),
			getStatsOverview: vi.fn(),
			getCorpRollupForOverview: vi.fn().mockResolvedValue([]),
			getStatsForCharacter: vi.fn().mockResolvedValue({
				totals: {
					fleetsJoined: 0,
					minutesInFleet: 0,
					timesFC: 0,
					minutesAsFC: 0,
					avgFleetDurationMinutes: null,
				},
				shipsFlown: [],
				recentSessions: [],
			}),
			getCharacterFleetSessionsPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
			getUserFleetSessionsPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
			getCharactersByCorpInWindow: vi.fn().mockResolvedValue([]),
			getStatsForCharacters: vi.fn().mockResolvedValue({}),
			getCorporationFleetParticipationMonths: vi.fn().mockResolvedValue([]),
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
		fleetsStub.getCharacterFleetInformation.mockResolvedValue({
			fleet_id: 'fleet-1',
			fleet_boss_id: '1001',
			role: 'fleet_commander',
			squad_id: 0,
			wing_id: 0,
		})
		fleetsStub.getActiveTrackingSessionByFleetId.mockResolvedValue(null)
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
			action: 'new',
		})
	})

	it('treats already-ended tracking sessions as an idempotent delete', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 'session-ended',
			name: 'Ended Fleet',
			characterId: '1001',
			currentCommanderCharacterId: '1001',
			commanderCharacterIds: ['1001'],
			startedByUserId: 'user-1',
			fleetId: 'fleet-1',
			status: 'ended',
			startedAt: '2026-05-25T10:00:00.000Z',
			endedAt: '2026-05-25T10:30:00.000Z',
			endedReason: 'fleet_disbanded',
			endedByUserId: null,
			createdAt: '2026-05-25T10:00:00.000Z',
			updatedAt: '2026-05-25T10:30:00.000Z',
		} as any)
		const app = createApp(makeUser())

		const res = await app.request('/api/fleets/tracking/session-ended', { method: 'DELETE' }, env)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true, status: 'ended' })
		expect(fleetsStub.stopTrackingSession).not.toHaveBeenCalled()
	})

	it('treats a stop race as success when the session is no longer active after a failure', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession
			.mockResolvedValueOnce({
				id: 'session-race',
				name: 'Race Fleet',
				characterId: '1001',
				currentCommanderCharacterId: '1001',
				currentFleetBossCharacterId: '1001',
				commanderCharacterIds: ['1001'],
				startedByUserId: 'user-1',
				fleetId: 'fleet-1',
				status: 'active',
				startedAt: '2026-05-25T10:00:00.000Z',
				endedAt: null,
				endedReason: null,
				endedByUserId: null,
				createdAt: '2026-05-25T10:00:00.000Z',
				updatedAt: '2026-05-25T10:00:00.000Z',
			} as any)
			.mockResolvedValueOnce({
				id: 'session-race',
				name: 'Race Fleet',
				characterId: '1001',
				currentCommanderCharacterId: '1001',
				commanderCharacterIds: ['1001'],
				startedByUserId: 'user-1',
				fleetId: 'fleet-1',
				status: 'ended',
				startedAt: '2026-05-25T10:00:00.000Z',
				endedAt: '2026-05-25T10:30:00.000Z',
				endedReason: 'fleet_disbanded',
				endedByUserId: null,
				createdAt: '2026-05-25T10:00:00.000Z',
				updatedAt: '2026-05-25T10:30:00.000Z',
			} as any)
		fleetsStub.stopTrackingSession.mockRejectedValueOnce(new Error('Failed query'))
		const app = createApp(makeUser())

		const res = await app.request('/api/fleets/tracking/session-race', { method: 'DELETE' }, env)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ ok: true, status: 'ended' })
		expect(fleetsStub.stopTrackingSession).toHaveBeenCalledTimes(1)
		expect(fleetsStub.getTrackingSession).toHaveBeenCalledTimes(2)
	})

	it('takes over an existing tracked fleet when requested', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getCharacterFleetInformation.mockResolvedValue({
			fleet_id: 'fleet-1',
			fleet_boss_id: '1001',
			role: 'fleet_commander',
			squad_id: 0,
			wing_id: 0,
		})
		fleetsStub.startTrackingSession.mockResolvedValue({ sessionId: 'session-abc' })
		const app = createApp(makeUser())

		const res = await app.request(
			'/api/fleets/tracking',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterId: '1001', name: 'Op Fleet', action: 'take_over' }),
			},
			env
		)

		expect(res.status).toBe(201)
		expect(fleetsStub.startTrackingSession).toHaveBeenCalledWith({
			characterId: '1001',
			startedByUserId: 'user-1',
			name: 'Op Fleet',
			action: 'take_over',
		})
	})

	it('includes an active tracked session in the character fleet info lookup', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		fleetsStub.getCharacterFleetInformation.mockResolvedValue({
			fleet_id: 'fleet-1',
			fleet_boss_id: '1001',
			role: 'fleet_commander',
			squad_id: 0,
			wing_id: 0,
		})
		fleetsStub.getActiveTrackingSessionByFleetId.mockResolvedValue({
			id: 'session-existing',
			name: 'Existing Fleet',
			characterId: '1001',
			currentCommanderCharacterId: '1001',
			commanderCharacterIds: ['1001'],
			startedByUserId: 'user-1',
			fleetId: 'fleet-1',
			status: 'active',
			startedAt: '2026-05-25T10:00:00.000Z',
			endedAt: null,
			endedReason: null,
			endedByUserId: null,
			createdAt: '2026-05-25T10:00:00.000Z',
			updatedAt: '2026-05-25T10:00:00.000Z',
		} as any)
		fleetsStub.getLatestTrackingSessionByFleetId.mockResolvedValue({
			id: 'session-existing',
			name: 'Existing Fleet',
			characterId: '1001',
			currentCommanderCharacterId: '1001',
			commanderCharacterIds: ['1001'],
			startedByUserId: 'user-1',
			fleetId: 'fleet-1',
			status: 'active',
			startedAt: '2026-05-25T10:00:00.000Z',
			endedAt: null,
			endedReason: null,
			endedByUserId: null,
			createdAt: '2026-05-25T10:00:00.000Z',
			updatedAt: '2026-05-25T10:00:00.000Z',
		} as any)

		const app = createApp(makeUser())
		const res = await app.request('/api/fleets/character/1001', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getActiveTrackingSessionByFleetId).toHaveBeenCalledWith('fleet-1')
		expect(fleetsStub.getLatestTrackingSessionByFleetId).toHaveBeenCalledWith('fleet-1')
		await expect(res.json()).resolves.toMatchObject({
			isInFleet: true,
			fleet_id: 'fleet-1',
			activeSession: {
				id: 'session-existing',
				name: 'Existing Fleet',
			},
			existingSession: {
				id: 'session-existing',
				name: 'Existing Fleet',
			},
		})
	})

	it('returns the existing active session when the fleet is already tracked', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getCharacterFleetInformation.mockResolvedValue({
			fleet_id: 'fleet-1',
			fleet_boss_id: '1001',
			role: 'fleet_commander',
			squad_id: 0,
			wing_id: 0,
		})
		fleetsStub.getActiveTrackingSessionByFleetId.mockResolvedValue({
			id: 'session-existing',
			name: 'Existing Fleet',
			characterId: '2002',
			currentCommanderCharacterId: '1001',
			commanderCharacterIds: ['1001', '2002'],
			startedByUserId: 'other-user',
			fleetId: 'fleet-1',
			status: 'active',
			startedAt: '2026-05-25T10:00:00.000Z',
			endedAt: null,
			endedReason: null,
			endedByUserId: null,
			createdAt: '2026-05-25T10:00:00.000Z',
			updatedAt: '2026-05-25T10:00:00.000Z',
		} as any)
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

		expect(res.status).toBe(409)
		expect(fleetsStub.startTrackingSession).not.toHaveBeenCalled()
		await expect(res.json()).resolves.toMatchObject({
			error: 'fleet_session_active',
			session: {
				id: 'session-existing',
				name: 'Existing Fleet',
			},
		})
	})

	it('scopes tracking list to self when user lacks view-fleets permission', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.listTrackingSessions.mockResolvedValue({ items: [], total: 0 })
		const app = createApp(
			makeUser({
				id: 'self-user',
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

		const res = await app.request(
			'/api/fleets/tracking?userId=other-user&limit=25&offset=0',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(fleetsStub.listTrackingSessions).toHaveBeenCalledWith(
			expect.objectContaining({
				startedByUserId: 'self-user',
				fleetBossCharacterIds: ['1001', '2002'],
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

		const res = await app.request(
			'/api/fleets/tracking?userId=other-user&limit=25&offset=0',
			{},
			env
		)

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
			characterId: '1001',
			currentCommanderCharacterId: '2002',
			commanderCharacterIds: ['1001', '2002'],
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

	it('returns commander handoff history for detailed viewers', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		resolverStub.resolveIds.mockResolvedValue({
			'1001': 'Pilot One',
			'2002': 'Pilot Two',
			'3003': 'Pilot Three',
		})
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's1',
			status: 'ended',
			startedByUserId: 'other-user',
			characterId: '1001',
			currentCommanderCharacterId: '2002',
			commanderCharacterIds: ['1001', '2002', '3003'],
		})
		fleetsStub.getSessionCommanderHistory.mockResolvedValue([
			{
				id: 'event-1',
				fleetId: 'fleet-1',
				trackingSessionId: 's1',
				previousCommanderCharacterId: null,
				commanderCharacterId: '1001',
				eventType: 'initial',
				observedAt: '2026-05-25T10:00:00.000Z',
			},
			{
				id: 'event-2',
				fleetId: 'fleet-1',
				trackingSessionId: 's1',
				previousCommanderCharacterId: '1001',
				commanderCharacterId: '2002',
				eventType: 'change',
				observedAt: '2026-05-25T10:12:00.000Z',
			},
		])

		const app = createApp(
			makeUser({
				id: 'user-1',
				mainCharacterId: '2002',
				characters: [
					{
						id: 'uc-1',
						characterOwnerHash: 'owner-hash-1',
						characterId: '2002',
						characterName: 'Pilot Two',
						is_primary: true,
						hasValidToken: true,
					},
				],
			})
		)
		const res = await app.request('/api/fleets/tracking/s1/commander-history', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionCommanderHistory).toHaveBeenCalledWith('s1')
		await expect(res.json()).resolves.toMatchObject({
			items: [
				{
					id: 'event-1',
					eventType: 'initial',
					previousCommanderCharacterName: null,
					commanderCharacterName: 'Pilot One',
				},
				{
					id: 'event-2',
					eventType: 'change',
					previousCommanderCharacterName: 'Pilot One',
					commanderCharacterName: 'Pilot Two',
				},
			],
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
		fleetsStub.getSessionLiveSnapshot.mockResolvedValue({
			state: 'ready',
			message: null,
			snapshot: { memberCount: 5 } as any,
		})

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s1/live', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionLiveSnapshot).toHaveBeenCalledWith('s1')
		await expect(res.json()).resolves.toMatchObject({
			state: 'ready',
			message: null,
			snapshot: { memberCount: 5 },
		})
	})

	it('allows active owner live detail access', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:create' }] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-active',
			status: 'active',
			startedByUserId: 'user-1',
			characterId: '1001',
		})
		fleetsStub.getSessionLiveSnapshot.mockResolvedValue({
			state: 'ready',
			message: null,
			snapshot: { memberCount: 10 } as any,
		})

		const app = createApp(makeUser({ id: 'user-1' }))
		const res = await app.request('/api/fleets/tracking/s-active/live', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionLiveSnapshot).toHaveBeenCalledWith('s-active')
		await expect(res.json()).resolves.toMatchObject({
			state: 'ready',
			message: null,
			snapshot: { memberCount: 10 },
		})
	})

	it('returns live member locations for detailed viewers without mutating ship events', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{ urn: 'urn:fleet-tracking:view-fleets' },
		] as any)
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-live',
			status: 'active',
			startedByUserId: 'other-user',
			characterId: '1001',
		})
		fleetsStub.getSessionLiveMemberLocations.mockResolvedValue([
			{
				characterId: '1001',
				solarSystemId: 30000142,
				systemName: 'Jita',
				stationId: 60003760,
				stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				updatedAt: '2026-05-25T10:00:15.000Z',
			},
		])

		const app = createApp(makeUser({ id: 'viewer-1' }))
		const res = await app.request('/api/fleets/tracking/s-live/current-members/live', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getSessionLiveMemberLocations).toHaveBeenCalledWith('s-live')
		await expect(res.json()).resolves.toMatchObject({
			members: [
				{
					characterId: '1001',
					systemName: 'Jita',
					stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
				},
			],
		})
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

	it('uses an epoch-start range for all-time stats', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		fleetsStub.getStatsOverview.mockResolvedValue({
			totals: {
				sessions: 0,
				totalMinutes: 0,
				uniquePilots: 0,
				totalJoins: 0,
				avgDurationMinutes: null,
				avgPeakMembers: null,
				largestFleetPeak: null,
			},
			topFCs: [],
			topPilots: [],
			topShips: [],
			sessionsPerDay: [],
		})

		const app = createApp(makeUser({ id: 'all-time-viewer' }))
		const res = await app.request('/api/fleets/tracking/stats/overview?allTime=true', {}, env)

		expect(res.status).toBe(200)
		expect(fleetsStub.getStatsOverview).toHaveBeenCalledWith({
			from: '1970-01-01T00:00:00.000Z',
			to: expect.any(String),
		})
	})

	it('hydrates linked broadcast SRP/doctrine on session detail', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		resolverStub.resolveIds.mockResolvedValue({ '1001': 'Pilot One', '2002': 'Pilot Two' })
		fleetsStub.getTrackingSession.mockResolvedValue({
			id: 's-broadcast',
			name: 'Fleet Op',
			characterId: '1001',
			currentCommanderCharacterId: '2002',
			commanderCharacterIds: ['1001', '2002'],
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
			currentCommanderCharacterName: 'Pilot Two',
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

	it('loads the requested character session page without changing aggregate stats', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		fleetsStub.getStatsForCharacter.mockResolvedValue({
			totals: {
				fleetsJoined: 22,
				minutesInFleet: 320,
				timesFC: 2,
				minutesAsFC: 90,
				avgFleetDurationMinutes: 15,
			},
			shipsFlown: [{ shipTypeId: 42, totalMinutes: 120 }],
			recentSessions: [],
		})
		fleetsStub.getCharacterFleetSessionsPage.mockResolvedValue({
			total: 22,
			items: [
				{
					sessionId: 'session-2',
					sessionName: 'Fleet 2',
					fleetId: 'fleet-2',
					wasFC: false,
					startedAt: '2026-08-04T10:00:00.000Z',
					endedAt: '2026-08-04T11:00:00.000Z',
					totalMinutes: 60,
					shipsFlown: 1,
				},
			],
		})

		const app = createApp(makeUser({ id: 'viewall-user' }))
		const res = await app.request(
			'/api/fleets/tracking/stats/characters/1514842406?from=2026-07-01T00:00:00.000Z&to=2026-08-05T00:00:00.000Z&limit=10&offset=10',
			{},
			env
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toMatchObject({
			characterId: '1514842406',
			totals: { fleetsJoined: 22 },
			recentSessionsTotal: 22,
			recentSessionsLimit: 10,
			recentSessionsOffset: 10,
			recentSessions: [{ sessionId: 'session-2' }],
		})
		expect(fleetsStub.getCharacterFleetSessionsPage).toHaveBeenCalledWith({
			characterId: '1514842406',
			range: {
				from: '2026-07-01T00:00:00.000Z',
				to: '2026-08-05T00:00:00.000Z',
			},
			limit: 10,
			offset: 10,
		})
	})

	it('loads all user fleet sessions through the batch page endpoint', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: 'urn:fleet-tracking:view-all' }] as any)
		createDbMock.mockReturnValue(
			makeDbStub([
				{
					characterId: '1001',
					characterName: 'Pilot One',
					is_primary: true,
					corporationId: null,
					corporationName: null,
				},
			])
		)
		fleetsStub.getStatsForCharacters.mockResolvedValue({})
		fleetsStub.getUserFleetSessionsPage.mockResolvedValue({
			total: 31,
			items: [
				{
					characterId: '1001',
					sessionId: 'session-31',
					sessionName: 'Fleet 31',
					fleetId: 'fleet-31',
					wasFC: false,
					startedAt: '2026-08-04T10:00:00.000Z',
					endedAt: '2026-08-04T11:00:00.000Z',
					totalMinutes: 60,
					shipsFlown: 1,
				},
			],
		})

		const app = createApp(makeUser({ id: 'viewall-user' }))
		const res = await app.request(
			'/api/fleets/tracking/stats/users/viewall-user?from=2026-07-01T00:00:00.000Z&to=2026-08-05T00:00:00.000Z&limit=10&offset=20',
			{},
			env
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toMatchObject({
			recentSessionsTotal: 31,
			recentSessionsLimit: 10,
			recentSessionsOffset: 20,
			recentSessions: [{ characterId: '1001', sessionId: 'session-31' }],
		})
		expect(fleetsStub.getUserFleetSessionsPage).toHaveBeenCalledWith({
			characterIds: ['1001'],
			range: {
				from: '2026-07-01T00:00:00.000Z',
				to: '2026-08-05T00:00:00.000Z',
			},
			limit: 10,
			offset: 20,
		})
	})

	it('uses the fleet DO for export month metadata without loading participation rows', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		fleetsStub.getCorporationFleetParticipationMonths.mockResolvedValue([
			{ month: '2026-07', from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
		])
		const app = createApp(makeUser({ id: 'admin-user', is_admin: true }))

		const res = await app.request(
			'/api/fleets/tracking/stats/corporations/505/export-months',
			{},
			env
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({
			months: [
				{ month: '2026-07', from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
			],
		})
		expect(fleetsStub.getCorporationFleetParticipationMonths).toHaveBeenCalledWith('505')
	})

	it('allows a corporation CEO to access export metadata under the same self-service gate', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '3001' })
		corpDataStub.getDirectors.mockResolvedValue([])
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '506' })
		fleetsStub.getCorporationFleetParticipationMonths.mockResolvedValue([])

		const app = createApp(makeLeaderUser('export-ceo-user', '3001'))
		const res = await app.request(
			'/api/fleets/tracking/stats/corporations/506/export-months',
			{},
			env
		)

		expect(res.status).toBe(200)
		expect(fleetsStub.getCorporationFleetParticipationMonths).toHaveBeenCalledWith('506')
	})

	it('denies a plain corporation member from export metadata', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		corpDataStub.getCorporationInfo.mockResolvedValue({ ceoId: '9999' })
		corpDataStub.getDirectors.mockResolvedValue([])
		charDataStub.getCharacterInfo.mockResolvedValue({ corporationId: '507' })

		const app = createApp(makeLeaderUser('export-member-user', '3002'))
		const res = await app.request(
			'/api/fleets/tracking/stats/corporations/507/export-months',
			{},
			env
		)

		expect(res.status).toBe(403)
		expect(fleetsStub.getCorporationFleetParticipationMonths).not.toHaveBeenCalled()
	})

	it('validates the export range before creating a workflow', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([])
		const app = createApp(makeUser({ id: 'admin-user', is_admin: true }))

		const res = await app.request(
			'/api/fleets/tracking/stats/corporations/505/export',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dateFrom: '2026-08-01T00:00:00.000Z',
					dateTo: '2026-07-01T00:00:00.000Z',
				}),
			},
			env
		)

		expect(res.status).toBe(400)
		expect(createWorkflowMock).not.toHaveBeenCalled()
	})
})
