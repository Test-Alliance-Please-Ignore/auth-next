import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import servicesAuditRoutes from '../services-audit'

import type { SessionUser } from '../../context'

/**
 * Routes for the READ-ONLY service access audit. The router's
 * requireAuth()+requireAdmin() guards are mocked to pass-through here so these
 * tests exercise the handlers; the getStub/getDiscordStub mocks are the
 * mechanism that proves no route issues a service RPC.
 */
const { getStubMock, getDiscordStubMock, createWorkflowMock } = vi.hoisted(() => ({
	getStubMock: vi.fn(),
	getDiscordStubMock: vi.fn(),
	createWorkflowMock: vi.fn(),
}))

vi.mock('../../middleware/session', () => ({
	requireAuth: () => async (_c: unknown, next: () => Promise<void>) => next(),
	requireAdmin: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('@repo/do-utils', () => ({ getStub: getStubMock }))
vi.mock('@repo/discord', () => ({
	getDiscordStub: getDiscordStubMock,
	DISCORD_EXCLUDED_AUTH_ROLE_IDS: new Set<string>(),
}))
vi.mock('@repo/workflow-utils', () => ({ createWorkflow: createWorkflowMock }))
vi.mock('../../db', () => ({ createDb: vi.fn() }))

const RUN_ID = '11111111-1111-4111-8111-111111111111'

function makeUser(over: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'admin-1',
		mainCharacterId: 'm',
		sessionId: 's',
		characters: [],
		is_admin: true,
		roles: [],
		discordUserId: null,
		...over,
	} as SessionUser
}

const env = { SERVICE_ACCESS_AUDIT_WORKFLOW: {}, FEATURES: {} } as never

function createApp(db: unknown, user: SessionUser = makeUser()) {
	const app = new Hono<{
		Bindings: Record<string, unknown>
		Variables: { user?: SessionUser; db?: unknown }
	}>()
	app.use('*', async (c, next) => {
		c.set('user', user)
		c.set('db', db)
		await next()
	})
	app.route('/api/services-audit', servicesAuditRoutes)
	return app
}

function post(db: unknown, path = '/runs') {
	return createApp(db).request(`/api/services-audit${path}`, { method: 'POST' }, env)
}

/** Postgres unique-violation, as the driver surfaces it. */
function uniqueViolation(nested = false): Error {
	const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: '23505',
	})
	if (!nested) return pgError
	// MEMORY: the Neon driver has been seen wrapping the real error on .cause.
	return Object.assign(new Error('Failed query'), { cause: pgError })
}

/** A db whose run insert resolves to one row. */
function makeInsertingDb(onInsert?: () => void) {
	return {
		insert: vi.fn(() => ({
			values: () => ({
				returning: async () => {
					onInsert?.()
					return [{ id: RUN_ID, status: 'scanning' }]
				},
			}),
		})),
		update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	getStubMock.mockReturnValue({ checkFlag: vi.fn(async () => true) })
	createWorkflowMock.mockResolvedValue({ id: 'instance-1' })
})

describe('POST /runs', () => {
	it('starts a scan and returns 201 with the run and workflow instance ids', async () => {
		const res = await post(makeInsertingDb())

		// 201, deliberately: the discord-servers precedent returns a bare 200.
		expect(res.status).toBe(201)
		const body = (await res.json()) as Record<string, unknown>
		expect(body).toMatchObject({ runId: RUN_ID, status: 'scanning' })
		expect(body.workflowInstanceId).toMatch(/^service-access-audit-/)

		// Created via createWorkflow (retention policy is centralised there), and
		// the row and the instance share the minted id.
		expect(createWorkflowMock).toHaveBeenCalledTimes(1)
		const [, options] = createWorkflowMock.mock.calls[0] as [unknown, Record<string, unknown>]
		expect(options.id).toBe(body.workflowInstanceId)
		expect(options.params).toMatchObject({ runId: RUN_ID, initiatedByUserId: 'admin-1' })
	})

	it('409s when a live run already holds the active lock', async () => {
		const db = {
			insert: vi.fn(() => ({
				values: () => ({
					returning: async () => {
						throw uniqueViolation()
					},
				}),
			})),
			update: vi.fn(),
		}

		const res = await post(db)

		expect(res.status).toBe(409)
		expect(await res.json()).toMatchObject({
			error: 'A service access audit run is already in progress',
		})
		// No workflow may be created for a run that never got the lock.
		expect(createWorkflowMock).not.toHaveBeenCalled()
	})

	it('409s when the driver nests the unique violation on error.cause', async () => {
		const db = {
			insert: vi.fn(() => ({
				values: () => ({
					returning: async () => {
						throw uniqueViolation(true)
					},
				}),
			})),
			update: vi.fn(),
		}

		expect((await post(db)).status).toBe(409)
	})

	it('does NOT report an unrelated database error as 409', async () => {
		// A broad try/catch would tell an operator "a run is already live" during an
		// emergency when in fact the database is simply broken.
		const db = {
			insert: vi.fn(() => ({
				values: () => ({
					returning: async () => {
						throw new Error('connection refused')
					},
				}),
			})),
			update: vi.fn(),
		}

		const res = await post(db)
		expect(res.status).toBe(500)
		expect(await res.json()).toMatchObject({ error: 'Failed to start audit run' })
	})

	it('CONCURRENT starts: exactly one 201 and one 409', async () => {
		// The lock is a UNIQUE index on active_lock, so the loser 23505s. This is a
		// race-free insert, not a check-then-insert.
		let lockHeld = false
		const db = {
			insert: vi.fn(() => ({
				values: () => ({
					returning: async () => {
						if (lockHeld) throw uniqueViolation()
						lockHeld = true
						return [{ id: RUN_ID, status: 'scanning' }]
					},
				}),
			})),
			update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
		}

		const [a, b] = await Promise.all([post(db), post(db)])
		const statuses = [a.status, b.status].sort()

		expect(statuses).toEqual([201, 409])
		expect(createWorkflowMock).toHaveBeenCalledTimes(1)
	})

	it('RELEASES the lock when the workflow fails to start', async () => {
		// Otherwise the lock is held forever by a run whose workflow will never run
		// and therefore will never NULL it — bricking the tool with no UI recovery.
		const sets: Array<Record<string, unknown>> = []
		const db = {
			insert: vi.fn(() => ({
				values: () => ({ returning: async () => [{ id: RUN_ID, status: 'scanning' }] }),
			})),
			update: vi.fn(() => ({
				set: (values: Record<string, unknown>) => {
					sets.push(values)
					return { where: async () => undefined }
				},
			})),
		}
		createWorkflowMock.mockRejectedValue(new Error('workflows unavailable'))

		const res = await post(db)

		expect(res.status).toBe(500)
		expect(sets).toHaveLength(1)
		expect(sets[0]).toMatchObject({ status: 'failed', activeLock: null })
	})

	it('issues no service RPCs', async () => {
		await post(makeInsertingDb())

		expect(getStubMock).not.toHaveBeenCalled()
		expect(getDiscordStubMock).not.toHaveBeenCalled()
	})
})

describe('GET /runs/:id', () => {
	function makeReadDb(run: Record<string, unknown> | undefined) {
		return {
			query: {
				serviceAccessAuditRuns: { findFirst: vi.fn(async () => run) },
				serviceAccessAuditRows: { findMany: vi.fn(async () => []) },
			},
			select: vi.fn(() => ({
				from: () => ({ where: () => ({ groupBy: async () => [] }) }),
			})),
		}
	}

	it('404s for an unknown run', async () => {
		const app = createApp(makeReadDb(undefined))
		const res = await app.request(`/api/services-audit/runs/${RUN_ID}`, {}, env)
		expect(res.status).toBe(404)
	})

	it('reports the Mumble flag state and is explicit that the denominator is Discord-only', async () => {
		getStubMock.mockReturnValue({ checkFlag: vi.fn(async () => false) })
		const app = createApp(
			makeReadDb({ id: RUN_ID, status: 'awaiting_confirmation', memberCorpCount: 12 })
		)

		const res = await app.request(`/api/services-audit/runs/${RUN_ID}`, {}, env)
		const body = (await res.json()) as Record<string, unknown>

		expect(res.status).toBe(200)
		// The flag is off => enforcement would silently no-op. The UI must be able
		// to say that, distinctly from "we could not tell".
		expect(body.mumbleFeature).toMatchObject({ enabled: false, state: 'flag_off' })
		// The scan cannot know Mumble provisioning without an RPC, so it must not
		// pretend inPopulation is a complete denominator.
		expect(body.mumblePopulationKnown).toBe(false)
		expect(body.inPopulationBasis).toBe('discord_link_only')
	})

	it('distinguishes an unreachable FEATURES DO from a disabled flag', async () => {
		getStubMock.mockImplementation(() => {
			throw new Error('DO down')
		})
		const app = createApp(makeReadDb({ id: RUN_ID, status: 'completed' }))

		const res = await app.request(`/api/services-audit/runs/${RUN_ID}`, {}, env)
		const body = (await res.json()) as Record<string, unknown>

		expect(body.mumbleFeature).toMatchObject({ enabled: false, state: 'unreachable' })
	})
})

describe('GET /runs/:id/rows', () => {
	function makeRowsDb() {
		return {
			select: vi.fn(() => ({ from: () => ({ where: async () => [{ count: 3 }] }) })),
			query: {
				serviceAccessAuditRows: {
					// Takes its args explicitly so the limit/offset pushed into SQL are
					// observable to the assertions below.
					findMany: vi.fn(async (_args?: Record<string, unknown>) => [
						{ id: 'r1', userId: 'u1', reason: 'unmanaged_corp', eligible: false },
					]),
				},
			},
		}
	}

	it('paginates in SQL and returns pagination metadata', async () => {
		const db = makeRowsDb()
		const app = createApp(db)

		const res = await app.request(
			`/api/services-audit/runs/${RUN_ID}/rows?page=2&pageSize=10`,
			{},
			env
		)
		const body = (await res.json()) as Record<string, unknown>

		expect(res.status).toBe(200)
		expect(body.pagination).toMatchObject({ page: 2, pageSize: 10, totalCount: 3 })
		// Filtering/pagination must be pushed into SQL — the existing discord audit
		// slices in JS, which is fatal under a 5s poll.
		const findManyArgs = db.query.serviceAccessAuditRows.findMany.mock.calls[0]?.[0] as
			| Record<string, unknown>
			| undefined
		expect(findManyArgs).toMatchObject({ limit: 10, offset: 10 })
	})

	it('rejects an unknown reason subcode', async () => {
		const app = createApp(makeRowsDb())
		const res = await app.request(
			`/api/services-audit/runs/${RUN_ID}/rows?reason=not_a_reason`,
			{},
			env
		)
		expect(res.status).toBe(400)
	})

	it('rejects an oversized pageSize rather than letting it through', async () => {
		const app = createApp(makeRowsDb())
		const res = await app.request(
			`/api/services-audit/runs/${RUN_ID}/rows?pageSize=10000`,
			{},
			env
		)
		expect(res.status).toBe(400)
	})
})

describe('the enforcement surface does not exist yet', () => {
	it('exposes no enforce/confirm route', async () => {
		// Increment 3 is read-only on purpose: nobody should be able to revoke
		// anything until the real ineligible count has been measured. A route that
		// exists is a route that gets called at 04:00.
		const db = makeInsertingDb()
		for (const path of ['/runs/enforce', `/runs/${RUN_ID}/enforce`, `/runs/${RUN_ID}/confirm`]) {
			const res = await post(db, path)
			expect(res.status).toBe(404)
		}
		expect(createWorkflowMock).not.toHaveBeenCalled()
	})
})
