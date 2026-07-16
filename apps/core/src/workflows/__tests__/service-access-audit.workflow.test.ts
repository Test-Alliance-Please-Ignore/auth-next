import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceAccessAuditWorkflow } from '../service-access-audit.workflow'

import type { ServiceAccessAuditWorkflowParams } from '../service-access-audit.workflow'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

/**
 * `cloudflare:workers` is aliased to src/test/mocks/cloudflare-workers.ts by
 * vitest.unit.config.ts, so WorkflowEntrypoint needs no vi.mock here.
 */

const { createDbMock, getStubMock, getDiscordStubMock, captureExceptionMock } = vi.hoisted(() => ({
	createDbMock: vi.fn(),
	getStubMock: vi.fn(),
	getDiscordStubMock: vi.fn(),
	captureExceptionMock: vi.fn(),
}))

vi.mock('../../db', () => ({ createDb: createDbMock }))

/**
 * THE ZERO-RPC HARNESS. Mocking both stub factories at the module-graph level is
 * what lets us assert that a scan issues NO service calls: a real Mumble call
 * would surface as a getStub call, and a real Discord call as a getDiscordStub
 * call. Nothing else can reach those services.
 */
vi.mock('@repo/do-utils', () => ({ getStub: getStubMock }))
vi.mock('@repo/discord', () => ({
	getDiscordStub: getDiscordStubMock,
	DISCORD_EXCLUDED_AUTH_ROLE_IDS: new Set<string>(),
}))
vi.mock('@repo/hono-helpers', () => ({
	captureException: captureExceptionMock,
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const RUN_ID = '11111111-1111-4111-8111-111111111111'

/**
 * Reconstruct a drizzle sql template's text so db.execute calls can be routed by
 * content rather than by brittle call-ordering.
 *
 * MUST recurse: drizzle nests sql`` fragments (e.g. the keyset
 * `WHERE u.id > ${cursor}` in scanUserEligibilityPage) as child SQL objects
 * rather than flattening them into string chunks. A non-recursive version
 * silently fails to see the cursor clause, which makes the fake serve page 1
 * forever.
 */
function sqlText(query: unknown): string {
	if (typeof query === 'string') return query
	if (query === null || typeof query !== 'object') return ''

	const node = query as { queryChunks?: unknown[]; value?: unknown }
	if (Array.isArray(node.queryChunks)) {
		return node.queryChunks.map(sqlText).join('')
	}
	// StringChunk holds its text in a `value` array.
	if (Array.isArray(node.value)) return node.value.join('')
	return ''
}

interface ScanUserFixture {
	id: string
	is_admin: boolean
	has_discord_link: boolean
	has_member_corp_character: boolean
	has_any_character: boolean
	has_any_corporation: boolean
	had_deleted_member_corp_character: boolean
}

function makeDb(options: {
	memberCorporationIds?: string[]
	lastGoodMemberCorpCount?: number | null
	users?: ScanUserFixture[]
}) {
	const memberCorporationIds = options.memberCorporationIds ?? ['1000001', '1000002']
	const users = options.users ?? []

	const insertedRows: Array<Record<string, unknown>> = []
	const runUpdates: Array<Record<string, unknown>> = []

	// The finalize aggregate is computed from the rows actually inserted — this
	// mirrors the real SQL aggregate and is what makes the "counters cannot
	// double-count on retry" property observable in a unit test.
	const aggregate = () => {
		const unique = new Map(insertedRows.map((row) => [row.userId as string, row]))
		const rows = [...unique.values()]
		return {
			scanned: rows.length,
			eligible_count: rows.filter((r) => r.eligible === true).length,
			ineligible_count: rows.filter((r) => r.eligible === false).length,
			in_population: rows.filter((r) => r.hasDiscordLink === true).length,
		}
	}

	const db = {
		query: {
			managedCorporations: {
				findMany: vi.fn(async () =>
					memberCorporationIds.map((corporationId) => ({ corporationId }))
				),
			},
			serviceAccessAuditRuns: {
				// getBasisBaseline takes the MAX over recent good runs, so it reads a
				// list rather than the single latest row.
				findMany: vi.fn(async () =>
					options.lastGoodMemberCorpCount === null ||
					options.lastGoodMemberCorpCount === undefined
						? []
						: [
								{
									memberCorpCount: options.lastGoodMemberCorpCount,
									memberCorporationIds: Array.from(
										{ length: options.lastGoodMemberCorpCount },
										(_, i) => `baseline-corp-${i + 1}`
									),
								},
							]
				),
			},
		},
		execute: vi.fn(async (query: unknown) => {
			const text = sqlText(query)

			// scanUserEligibilityPage — keyset page over users.
			// Keysets off the ACTUAL cursor param in the query, not off a hidden
			// counter: a fake that ignores the cursor would serve page 1 forever and
			// mask a genuinely broken cursor behind correct-looking totals.
			if (text.includes('AS has_member_corp_character')) {
				const cursor = /u\.id > ([^:\s]+)::uuid/.exec(text)?.[1]
				const start = cursor ? users.findIndex((u) => u.id === cursor) + 1 : 0
				return { rows: users.slice(start, start + 500) }
			}

			// fetchUserEnrichment — main character + corporations for the page.
			// Only returns users actually named in the query, so an enrichment call
			// that failed to scope to its page would show up as missing names.
			if (text.includes('AS corporation_ids')) {
				return {
					rows: users
						.filter((user) => text.includes(user.id))
						.map((user) => ({
							id: user.id,
							main_character_id: `char-${user.id}`,
							main_character_name: `Pilot ${user.id}`,
							corporation_ids: user.has_any_corporation ? ['1000001'] : [],
						})),
				}
			}

			// finalize aggregate.
			if (text.includes('AS scanned')) {
				return { rows: [aggregate()] }
			}

			throw new Error(`Unexpected db.execute call: ${text}`)
		}),
		insert: vi.fn(() => ({
			values: (rows: Array<Record<string, unknown>>) => ({
				onConflictDoNothing: async () => {
					insertedRows.push(...rows)
				},
			}),
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					runUpdates.push(values)
				},
			}),
		})),
	}

	return { db, insertedRows, runUpdates }
}

/** Fake step: runs the callback inline, tolerating both step.do(name, fn) and
 * step.do(name, config, fn). */
function makeStep(): WorkflowStep {
	return {
		do: async (_name: string, configOrFn: unknown, maybeFn?: unknown) => {
			const fn = typeof configOrFn === 'function' ? configOrFn : maybeFn
			return (fn as () => Promise<unknown>)()
		},
		sleep: async () => undefined,
	} as unknown as WorkflowStep
}

function makeEvent(): WorkflowEvent<ServiceAccessAuditWorkflowParams> {
	return {
		payload: { runId: RUN_ID, initiatedByUserId: 'admin-1' },
		timestamp: new Date(),
		instanceId: 'instance-1',
	} as WorkflowEvent<ServiceAccessAuditWorkflowParams>
}

function makeEnv() {
	return {
		DATABASE_URL: 'postgres://fake',
		FEATURES: {},
	} as never
}

function runWorkflow(env = makeEnv()) {
	const workflow = new ServiceAccessAuditWorkflow({} as never, env)
	return workflow.run(makeEvent(), makeStep())
}

/** A user fixture that lands on a given eligibility reason. */
function user(id: string, over: Partial<ScanUserFixture> = {}): ScanUserFixture {
	return {
		id,
		is_admin: false,
		has_discord_link: true,
		has_member_corp_character: true,
		has_any_character: true,
		has_any_corporation: true,
		had_deleted_member_corp_character: false,
		...over,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	// Default: feature flag reachable and enabled.
	getStubMock.mockReturnValue({ checkFlag: vi.fn(async () => true) })
})

describe('ServiceAccessAuditWorkflow — the circuit breaker', () => {
	it('BLOCKS and writes ZERO rows when managed_corporations is empty', async () => {
		const { db, insertedRows, runUpdates } = makeDb({
			memberCorporationIds: [],
			lastGoodMemberCorpCount: 50,
			users: [user('u1'), user('u2')],
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		// THE core property: a blocked run must not act on an inverted rule.
		expect(insertedRows).toHaveLength(0)
		expect(db.insert).not.toHaveBeenCalled()

		const blockedUpdate = runUpdates.find((u) => u.status === 'blocked')
		expect(blockedUpdate).toBeDefined()
		expect(blockedUpdate?.errorMessage).toContain('cannot be overridden')
		// Terminal => the one-live-run lock is released.
		expect(blockedUpdate?.activeLock).toBeNull()

		// A blocked run is a terminal OUTCOME, not an error: it must not be reported
		// to Sentry, and it must never be overwritten by status='failed'.
		expect(captureExceptionMock).not.toHaveBeenCalled()
		expect(runUpdates.some((u) => u.status === 'failed')).toBe(false)
	})

	it('does NOT block a shrunken basis — it scans and records basisSuspect', async () => {
		// THE REGRESSION. An earlier version hard-blocked any >20% shrink, on the
		// false premise that "corps leaving does not shrink the basis". De-flagging a
		// corp IS how a corp leaves (routes/corporations/index.ts) and it shrinks the
		// basis by construction — so blocking here refused the tool's primary use
		// case, unoverridably. A scan is read-only and cannot hurt anyone; the teeth
		// belong at enforcement.
		const { db, insertedRows, runUpdates } = makeDb({
			memberCorporationIds: ['1000001', '1000002'],
			lastGoodMemberCorpCount: 50,
			users: [user('u1')],
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		expect(runUpdates.find((u) => u.status === 'blocked')).toBeUndefined()
		// It scanned.
		expect(insertedRows.length).toBeGreaterThan(0)
		// And it told the operator exactly what changed, rather than just a ratio.
		const suspectUpdate = runUpdates.find((u) => u.basisSuspect === true)
		expect(suspectUpdate).toBeDefined()
		expect(suspectUpdate?.basisComparedToCount).toBe(50)
		expect(suspectUpdate?.basisNote).toContain('corporation(s) left the basis')
		expect(suspectUpdate?.basisRemovedCorporationIds as string[]).not.toHaveLength(0)
	})

	it('does NOT block when the basis is intact, even if many users are ineligible', async () => {
		// The asymmetry: a real defection must not be blocked by the basis check.
		const users = Array.from({ length: 40 }, (_, i) =>
			user(`u${i}`, i < 30 ? { has_member_corp_character: false } : {})
		)
		const { db, runUpdates } = makeDb({
			memberCorporationIds: Array.from({ length: 50 }, (_, i) => `${i}`),
			lastGoodMemberCorpCount: 50,
			users,
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		expect(runUpdates.some((u) => u.status === 'blocked')).toBe(false)
		const finalize = runUpdates.find((u) => u.status === 'awaiting_confirmation')
		expect(finalize).toBeDefined()
		// The soft heuristic flags it instead — 30/40 = 75%, past the 25 floor.
		expect(finalize?.blastRadiusTripped).toBe(true)
	})
})

describe('ServiceAccessAuditWorkflow — read-only guarantee', () => {
	it('issues ZERO Mumble and ZERO Discord RPCs during a full scan', async () => {
		const { db } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users: [user('u1'), user('u2', { has_member_corp_character: false })],
		})
		createDbMock.mockReturnValue(db)

		const env = makeEnv() as unknown as { FEATURES: object; MUMBLE?: unknown }
		await runWorkflow(env as never)

		// Discord is never reached at all.
		expect(getDiscordStubMock).not.toHaveBeenCalled()

		// getStub is reached exactly once, and ONLY for the FEATURES flag read —
		// which reads a flag, not a service. No Mumble binding is ever passed.
		const stubBindings = getStubMock.mock.calls.map((call) => call[0])
		expect(stubBindings).toEqual([env.FEATURES])
	})
})

describe('ServiceAccessAuditWorkflow — counters', () => {
	it('derives counters and the reason breakdown from the rows, matching hand-computed fixtures', async () => {
		const users = [
			// 2 eligible via member corp.
			user('a1'),
			user('a2'),
			// 1 eligible via admin exemption (no member corp, but is_admin).
			user('a3', { is_admin: true, has_member_corp_character: false }),
			// 1 ineligible: no characters at all.
			user('b1', {
				has_member_corp_character: false,
				has_any_character: false,
				has_any_corporation: false,
			}),
			// 1 ineligible: characters exist, all corps NULL.
			user('b2', { has_member_corp_character: false, has_any_corporation: false }),
			// 1 ineligible: only a deleted member-corp character.
			user('b3', { has_member_corp_character: false, had_deleted_member_corp_character: true }),
			// 1 ineligible: in corps, none of them member corps. No Discord link.
			user('b4', { has_member_corp_character: false, has_discord_link: false }),
		]
		const { db, insertedRows, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users,
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		const finalize = runUpdates.find(
			(u) => u.status === 'awaiting_confirmation' || u.status === 'completed'
		)
		expect(finalize).toMatchObject({
			status: 'awaiting_confirmation',
			scanned: 7,
			eligibleCount: 3,
			ineligibleCount: 4,
			// Discord-linked only: b4 has no link. This is the HONEST denominator —
			// Mumble provisioning is not knowable without an RPC.
			inPopulation: 6,
			// 4/7 is past 20% but only 4 ineligible — below the absolute floor of 25.
			blastRadiusTripped: false,
			activeLock: null,
		})

		// The reason subcodes are what make a big number reviewable.
		const reasons = insertedRows.map((row) => row.reason)
		expect(reasons).toEqual([
			'member_corp',
			'member_corp',
			'admin_exempt',
			'no_characters',
			'null_corp',
			'only_deleted_member_char',
			'unmanaged_corp',
		])

		// Names, not just counts.
		expect(insertedRows[0]).toMatchObject({
			runId: RUN_ID,
			userId: 'a1',
			mainCharacterName: 'Pilot a1',
		})
	})

	it('walks every page via the keyset cursor and counts each user exactly once', async () => {
		// 1,200 users => 3 pages of 500/500/200 plus a final empty page. Pins that
		// the cursor actually advances: a cursor that failed to advance would serve
		// page 1 forever, and because the inserts are onConflictDoNothing the
		// duplicate rows would vanish and the totals would still LOOK correct.
		const users = Array.from({ length: 1200 }, (_, i) =>
			user(`u${String(i).padStart(4, '0')}`)
		)
		const { db, insertedRows, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users,
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		expect(insertedRows).toHaveLength(1200)
		expect(new Set(insertedRows.map((r) => r.userId)).size).toBe(1200)
		expect(runUpdates.find((u) => u.status === 'completed')).toMatchObject({
			scanned: 1200,
			eligibleCount: 1200,
		})
	})

	it("completes (not awaiting_confirmation) when nobody is ineligible, and still releases the lock", async () => {
		const { db, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users: [user('a1'), user('a2')],
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		const finalize = runUpdates.find((u) => u.status === 'completed')
		expect(finalize).toMatchObject({
			status: 'completed',
			scanned: 2,
			ineligibleCount: 0,
			activeLock: null,
		})
	})
})

describe('ServiceAccessAuditWorkflow — failure path', () => {
	it('NULLs the activeLock, reports to Sentry, and RE-THROWS when the scan fails', async () => {
		const { db, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users: [user('u1')],
		})
		const boom = new Error('neon exploded')
		db.insert.mockImplementation(() => {
			throw boom
		})
		createDbMock.mockReturnValue(db)

		// RE-THROW is load-bearing: returning instead would make the Workflows
		// engine record this instance as SUCCESSFUL and destroy failure attribution.
		await expect(runWorkflow()).rejects.toThrow('neon exploded')

		const failed = runUpdates.find((u) => u.status === 'failed')
		expect(failed).toBeDefined()
		// If this regresses, one crashed run bricks the emergency tool permanently:
		// the lock's unique index would 409 every later POST /runs with no UI recovery.
		expect(failed?.activeLock).toBeNull()
		expect(failed?.errorMessage).toContain('neon exploded')

		expect(captureExceptionMock).toHaveBeenCalledWith(
			boom,
			expect.objectContaining({
				tags: expect.objectContaining({ workflow: 'ServiceAccessAuditWorkflow', runId: RUN_ID }),
			})
		)
	})
})

describe('ServiceAccessAuditWorkflow — Mumble feature reporting', () => {
	it('scans anyway when the Mumble flag is off, rather than refusing to start', async () => {
		// A scan that refuses to run tells the operator nothing. A scan that runs
		// and reports "flag off" tells them enforcement would silently no-op.
		getStubMock.mockReturnValue({ checkFlag: vi.fn(async () => false) })
		const { db, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users: [user('u1', { has_member_corp_character: false })],
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		expect(runUpdates.some((u) => u.status === 'awaiting_confirmation')).toBe(true)
	})

	it('scans anyway when the FEATURES DO is unreachable', async () => {
		getStubMock.mockImplementation(() => {
			throw new Error('DO unreachable')
		})
		const { db, runUpdates } = makeDb({
			memberCorporationIds: ['1000001'],
			lastGoodMemberCorpCount: 1,
			users: [user('u1')],
		})
		createDbMock.mockReturnValue(db)

		await runWorkflow()

		// An unreachable flag DO must not abort a read-only scan.
		expect(runUpdates.some((u) => u.status === 'completed')).toBe(true)
	})
})
