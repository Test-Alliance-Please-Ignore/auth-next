import { describe, expect, it, vi, beforeEach } from 'vitest'

const harness = vi.hoisted(() => ({
	currentDb: null as unknown,
	stubs: new Map<string, unknown>(),
	namespaceIds: new WeakMap<object, string>(),
	namespaceSeq: 0,
}))

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public state: DurableObjectState,
			public env: unknown
		) {}
	}

	return {
		DurableObject,
	}
})

vi.mock('@repo/db-utils', async () => {
	return {
		and: vi.fn(() => ({})),
		asc: vi.fn(() => ({})),
		desc: vi.fn(() => ({})),
		eq: vi.fn(() => ({})),
		gt: vi.fn(() => ({})),
		gte: vi.fn(() => ({})),
		inArray: vi.fn(() => ({})),
		isNull: vi.fn(() => ({})),
		isNotNull: vi.fn(() => ({})),
		lt: vi.fn(() => ({})),
		lte: vi.fn(() => ({})),
		or: vi.fn(() => ({})),
		sql: vi.fn(() => ({})),
		createDbClient: vi.fn(() => harness.currentDb),
		createDbClientWs: vi.fn(() => harness.currentDb),
	}
})

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace: object, id: string) => {
		const nsKey = getNamespaceKey(namespace)
		return harness.stubs.get(`${nsKey}:${id}`) ?? {}
	}),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

import {
	fleetMemberShipEvents,
	fleetSummaries,
	fleetTrackingSessionEvents,
	fleetTrackingSessions,
} from '../../db/schema'
import { FleetMonitorDO } from '../../fleet-monitor'
import { FleetsDO } from '../../durable-object'

function getNamespaceKey(namespace: object): string {
	const existing = harness.namespaceIds.get(namespace)
	if (existing) return existing

	const key = `ns-${++harness.namespaceSeq}`
	harness.namespaceIds.set(namespace, key)
	return key
}

function registerStub(namespace: object, id: string, stub: unknown): void {
	harness.stubs.set(`${getNamespaceKey(namespace)}:${id}`, stub)
}

function createDbMock(options: {
	selectResults?: unknown[]
	insertResults?: unknown[]
	updateResults?: unknown[]
	deleteResults?: unknown[]
} = {}) {
	const queues = {
		select: [...(options.selectResults ?? [])],
		insert: [...(options.insertResults ?? [])],
		update: [...(options.updateResults ?? [])],
		delete: [...(options.deleteResults ?? [])],
	}

	const captures = {
		selects: [] as Array<Record<string, unknown>>,
		inserts: [] as Array<Record<string, unknown>>,
		updates: [] as Array<Record<string, unknown>>,
		deletes: [] as Array<Record<string, unknown>>,
	}

	const makeChain = (queue: unknown[], capture: Record<string, unknown>) => {
		const chain: any = {
			from: (...args: unknown[]) => {
				capture.from = args
				return chain
			},
			leftJoin: (...args: unknown[]) => {
				capture.leftJoin = args
				return chain
			},
			where: (...args: unknown[]) => {
				capture.where = args
				return chain
			},
			orderBy: (...args: unknown[]) => {
				capture.orderBy = args
				return chain
			},
			limit: (...args: unknown[]) => {
				capture.limit = args
				return chain
			},
			offset: (...args: unknown[]) => {
				capture.offset = args
				return chain
			},
			groupBy: (...args: unknown[]) => {
				capture.groupBy = args
				return chain
			},
			values: (...args: unknown[]) => {
				capture.values = args
				return chain
			},
			set: (...args: unknown[]) => {
				capture.set = args
				return chain
			},
			returning: (...args: unknown[]) => {
				capture.returning = args
				return Promise.resolve(queue.shift())
			},
			onConflictDoUpdate: (...args: unknown[]) => {
				capture.onConflictDoUpdate = args
				return Promise.resolve(queue.shift())
			},
			then: (onFulfilled: ((value: unknown) => unknown) | null, onRejected: ((reason: unknown) => unknown) | null) =>
				Promise.resolve(queue.shift()).then(onFulfilled, onRejected),
		}

		return chain
	}

	return {
		select: vi.fn((selection: unknown) => {
			const capture: Record<string, unknown> = { selection }
			captures.selects.push(capture)
			return makeChain(queues.select, capture)
		}),
		insert: vi.fn((table: unknown) => {
			const capture: Record<string, unknown> = { table }
			captures.inserts.push(capture)
			return makeChain(queues.insert, capture)
		}),
		update: vi.fn((table: unknown) => {
			const capture: Record<string, unknown> = { table }
			captures.updates.push(capture)
			return makeChain(queues.update, capture)
		}),
		delete: vi.fn((table: unknown) => {
			const capture: Record<string, unknown> = { table }
			captures.deletes.push(capture)
			return makeChain(queues.delete, capture)
		}),
		captures,
		queues,
	}
}

function createBaseEnv() {
	const FLEET_MONITOR = {} as DurableObjectNamespace
	const EVE_TOKEN_STORE = {} as DurableObjectNamespace
	const EVE_CHARACTER_DATA = {} as DurableObjectNamespace
	const UNIVERSE = {} as DurableObjectNamespace
	const ESI_RATE_LIMITS = {} as KVNamespace

	return {
		DATABASE_URL: 'postgres://example',
		FLEET_MONITOR,
		EVE_TOKEN_STORE,
		EVE_CHARACTER_DATA,
		UNIVERSE,
		ESI_RATE_LIMITS,
		EVE_SSO_CLIENT_ID: 'client-id',
	}
}

function createFleetsDo(db: ReturnType<typeof createDbMock>) {
	harness.currentDb = db
	return new FleetsDO({} as DurableObjectState, createBaseEnv() as never)
}

function createFleetMonitorDo(db: ReturnType<typeof createDbMock>) {
	harness.currentDb = db
	const state = {
		storage: {
			sql: {
				exec: vi.fn((query: string) => ({
					toArray: () => (query.includes('SELECT version') ? [{ version: 5 }] : []),
				})),
			},
			deleteAlarm: vi.fn().mockResolvedValue(undefined),
			setAlarm: vi.fn().mockResolvedValue(undefined),
		},
	} as never

	return new FleetMonitorDO(state, createBaseEnv() as never)
}

beforeEach(() => {
	harness.currentDb = null
	harness.stubs.clear()
	harness.namespaceIds = new WeakMap<object, string>()
	harness.namespaceSeq = 0
	vi.clearAllMocks()
})

describe('fleet lifecycle management', () => {
	it('starts a new tracking session and initializes the fleet monitor', async () => {
		const db = createDbMock({
			selectResults: [[]],
			insertResults: [[{ id: 'session-1' }]],
		})
		const fleets = createFleetsDo(db)
		const env = createBaseEnv()
		const monitorStub = {
			initializeMonitoring: vi.fn().mockResolvedValue(undefined),
		}
		registerStub(env.FLEET_MONITOR, 'fleet-123', monitorStub)

		;(fleets as any).env = env
		;(fleets as any).getCharacterFleetInformation = vi.fn().mockResolvedValue({
			fleet_id: '123',
			fleet_boss_id: '42',
			role: 'squad_member',
			squad_id: 1,
			wing_id: 2,
			lastUpdated: '2026-07-20T00:00:00.000Z',
		})
		;(fleets as any).recordSessionLifecycleEvent = vi.fn().mockResolvedValue(undefined)

		const result = await fleets.startTrackingSession({
			characterId: '42',
			startedByUserId: 'user-1',
			name: 'Alpha Fleet',
		})

		expect(result).toEqual({ sessionId: 'session-1' })
		expect(db.captures.inserts[0]?.table).toBe(fleetTrackingSessions)
		expect(db.captures.inserts[0]?.values).toEqual([
			expect.objectContaining({
				name: 'Alpha Fleet',
				characterId: '42',
				startedByUserId: 'user-1',
				fleetId: '123',
				status: 'active',
			}),
		])
		expect(monitorStub.initializeMonitoring).toHaveBeenCalledWith('123', '42', 'session-1', {
			force: true,
			previousFleetBossCharacterId: null,
			resumedExistingSession: false,
		})
		expect((fleets as any).recordSessionLifecycleEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				fleetId: '123',
				trackingSessionId: 'session-1',
				eventType: 'started',
			})
		)
	})

	it('takes over an ended session and records a resumed lifecycle event', async () => {
		const db = createDbMock({
			selectResults: [
				[
					{
						id: 'session-1',
						status: 'ended',
						endedAt: new Date('2026-07-19T23:59:00.000Z'),
						characterId: '41',
					},
				],
			],
			updateResults: [[{ id: 'session-1' }]],
			deleteResults: [undefined],
		})
		const fleets = createFleetsDo(db)
		const env = createBaseEnv()
		const monitorStub = {
			initializeMonitoring: vi.fn().mockResolvedValue(undefined),
		}
		registerStub(env.FLEET_MONITOR, 'fleet-123', monitorStub)
		;(fleets as any).env = env
		;(fleets as any).getCharacterFleetInformation = vi.fn().mockResolvedValue({
			fleet_id: '123',
			fleet_boss_id: '42',
			role: 'squad_member',
			squad_id: 1,
			wing_id: 2,
			lastUpdated: '2026-07-20T00:00:00.000Z',
		})
		;(fleets as any).recordSessionLifecycleEvent = vi.fn().mockResolvedValue(undefined)

		const result = await fleets.startTrackingSession({
			characterId: '42',
			startedByUserId: 'user-1',
			name: 'Alpha Fleet',
			action: 'take_over',
		})

		expect(result).toEqual({ sessionId: 'session-1' })
		expect(db.captures.updates[0]?.table).toBe(fleetTrackingSessions)
		expect(db.captures.updates[0]?.set).toEqual([
			expect.objectContaining({
				name: 'Alpha Fleet',
				characterId: '42',
				status: 'active',
				endedAt: null,
				endedReason: null,
				endedByUserId: null,
			}),
		])
		expect(monitorStub.initializeMonitoring).toHaveBeenCalledWith('123', '42', 'session-1', {
			force: true,
			previousFleetBossCharacterId: '41',
			resumedExistingSession: true,
		})
		expect((fleets as any).recordSessionLifecycleEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				fleetId: '123',
				trackingSessionId: 'session-1',
				eventType: 'resumed',
				previousCharacterId: '41',
			})
		)
		expect(db.captures.deletes[0]?.table).toBe(fleetSummaries)
	})

	it('rejects a new session when one is already active', async () => {
		const db = createDbMock({
			selectResults: [
				[
					{
						id: 'session-1',
						status: 'active',
						endedAt: null,
						characterId: '41',
					},
				],
			],
		})
		const fleets = createFleetsDo(db)
		const env = createBaseEnv()
		registerStub(env.FLEET_MONITOR, 'fleet-123', {})
		;(fleets as any).env = env
		;(fleets as any).getCharacterFleetInformation = vi.fn().mockResolvedValue({
			fleet_id: '123',
			fleet_boss_id: '42',
			role: 'squad_member',
			squad_id: 1,
			wing_id: 2,
			lastUpdated: '2026-07-20T00:00:00.000Z',
		})

		await expect(
			fleets.startTrackingSession({
				characterId: '42',
				startedByUserId: 'user-1',
				name: 'Alpha Fleet',
			})
		).rejects.toMatchObject({ code: 'fleet_session_active' })
		expect(db.captures.inserts).toHaveLength(0)
	})

	it('delegates stop requests only for active sessions', async () => {
		const db = createDbMock({
			selectResults: [
				[
					{
						id: 'session-1',
						status: 'active',
						endedAt: null,
						fleetId: '123',
					},
				],
				[
					{
						id: 'session-2',
						status: 'ended',
						endedAt: new Date('2026-07-19T23:59:00.000Z'),
						fleetId: '123',
					},
				],
			],
		})
		const fleets = createFleetsDo(db)
		const env = createBaseEnv()
		const monitorStub = {
			endSession: vi.fn().mockResolvedValue(undefined),
		}
		registerStub(env.FLEET_MONITOR, 'fleet-123', monitorStub)
		;(fleets as any).env = env

		await fleets.stopTrackingSession({
			sessionId: 'session-1',
			endedReason: 'user_stopped',
			endedByUserId: 'user-1',
		})

		await fleets.stopTrackingSession({
			sessionId: 'session-2',
			endedReason: 'admin_stopped',
			endedByUserId: 'user-2',
		})

		expect(monitorStub.endSession).toHaveBeenCalledTimes(1)
		expect(monitorStub.endSession).toHaveBeenCalledWith({
			sessionId: 'session-1',
			endedReason: 'user_stopped',
			endedByUserId: 'user-1',
		})
	})

	it('treats live snapshot and member lookups as session-gated', async () => {
		const activeSnapshotDb = createDbMock({
			selectResults: [
				[
					{
						fleetId: '123',
						status: 'active',
						endedAt: null,
					},
				],
				[
					{
						id: 'cache-row',
						fleetId: '123',
						memberCount: 3,
						motd: 'Test motd',
						isFreeMove: true,
						isRegistered: false,
						isVoiceEnabled: true,
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date('2026-07-20T00:00:00.000Z'),
						createdAt: new Date('2026-07-20T00:00:00.000Z'),
						updatedAt: new Date('2026-07-20T00:00:00.000Z'),
					},
				],
			],
		})
		const activeSnapshotDo = createFleetsDo(activeSnapshotDb)
		const activeSnapshotEnv = createBaseEnv()
		const monitorStub = {
			getMonitorState: vi.fn().mockResolvedValue({ peakMemberCount: 8 }),
		}
		registerStub(activeSnapshotEnv.FLEET_MONITOR, 'fleet-123', monitorStub)
		;(activeSnapshotDo as any).env = activeSnapshotEnv

		await expect(activeSnapshotDo.getSessionLiveSnapshot('session-1')).resolves.toEqual({
			fleetId: '123',
			memberCount: 3,
			peakMemberCount: 8,
			motd: 'Test motd',
			isFreeMove: true,
			isRegistered: false,
			isVoiceEnabled: true,
			lastChecked: '2026-07-20T00:00:00.000Z',
			updatedAt: '2026-07-20T00:00:00.000Z',
		})
		expect(monitorStub.getMonitorState).toHaveBeenCalledTimes(1)

		const endedLocationsDb = createDbMock({
			selectResults: [[{ fleetId: '123', status: 'ended', endedAt: new Date('2026-07-19T23:59:00.000Z') }]],
		})
		const endedLocationsDo = createFleetsDo(endedLocationsDb)
		const endedLocationsEnv = createBaseEnv()
		const liveMonitorStub = {
			getFleetStatus: vi.fn().mockResolvedValue({ members: [] }),
		}
		registerStub(endedLocationsEnv.FLEET_MONITOR, 'fleet-123', liveMonitorStub)
		;(endedLocationsDo as any).env = endedLocationsEnv

		await expect(endedLocationsDo.getSessionLiveMemberLocations('session-2')).resolves.toEqual([])
		expect(liveMonitorStub.getFleetStatus).not.toHaveBeenCalled()
	})

	it('treats inconsistent session rows as closed when stopping tracking', async () => {
		const db = createDbMock({
			selectResults: [
				[
					{
						id: 'session-1',
						status: 'active',
						endedAt: new Date('2026-07-20T00:00:00.000Z'),
						fleetId: '123',
					},
				],
			],
		})
		const fleets = createFleetsDo(db)
		const env = createBaseEnv()
		const monitorStub = {
			endSession: vi.fn().mockResolvedValue(undefined),
		}
		registerStub(env.FLEET_MONITOR, 'fleet-123', monitorStub)
		;(fleets as any).env = env

		await fleets.stopTrackingSession({
			sessionId: 'session-1',
			endedReason: 'user_stopped',
			endedByUserId: 'user-1',
		})

		expect(monitorStub.endSession).not.toHaveBeenCalled()
	})

	it('finalizes a fleet monitor session once and ignores mismatches', async () => {
		const db = createDbMock({
			selectResults: [
				[
					{
						id: 'cache-row',
						fleetId: '123',
						fleetBossId: '42',
						memberCount: 4,
						motd: 'Test motd',
						isFreeMove: true,
						isRegistered: false,
						isVoiceEnabled: true,
						notFound: false,
						notFoundAt: null,
						lastChecked: new Date('2026-07-20T00:00:00.000Z'),
						createdAt: new Date('2026-07-20T00:00:00.000Z'),
						updatedAt: new Date('2026-07-20T00:00:00.000Z'),
					},
				],
				[],
			],
			insertResults: [undefined, undefined],
			updateResults: [undefined, undefined],
		})
		const monitor = createFleetMonitorDo(db)
		const finalize = (monitor as any).finalizeSession.bind(monitor)

		await Promise.all([
			finalize({
				fleetId: '123',
				fleetBossId: '42',
				trackingSessionId: 'session-2',
				endedAt: new Date('2026-07-20T00:01:00.000Z'),
				endedReason: 'fleet_disbanded',
				endedByUserId: null,
				peakMemberCount: 7,
			}),
			finalize({
				fleetId: '123',
				fleetBossId: '42',
				trackingSessionId: 'session-2',
				endedAt: new Date('2026-07-20T00:01:00.000Z'),
				endedReason: 'fleet_disbanded',
				endedByUserId: null,
				peakMemberCount: 7,
			}),
		])

		expect(db.captures.inserts.filter((entry) => entry.table === fleetTrackingSessionEvents)).toHaveLength(1)
		expect(db.captures.updates.filter((entry) => entry.table === fleetMemberShipEvents)).toHaveLength(1)
		expect(db.captures.updates.filter((entry) => entry.table === fleetTrackingSessions)).toHaveLength(1)
		expect(db.captures.inserts.filter((entry) => entry.table === fleetSummaries)).toHaveLength(1)
	})
})
