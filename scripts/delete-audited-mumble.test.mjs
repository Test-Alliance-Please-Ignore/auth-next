import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { applyPlan, approvedPlanDigest, makePlan } from './delete-audited-mumble.mjs'

const SOURCE_RUN = '11111111-1111-4111-8111-111111111111'
const FRESH_RUN = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-17T12:30:00.000Z')
const CORPS = Array.from({ length: 37 }, (_, index) => String(2_000_000 + index))
const ids = Array.from(
	{ length: 57 },
	(_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
)
const config = {
	authBaseUrl: 'https://auth.example.test',
	controlBaseUrl: 'https://control.example.test',
	runId: FRESH_RUN,
	serverId: 'srv-1',
	cookie: 'session=private',
	controlToken: 'private-token',
}
const source = {
	auditRunId: SOURCE_RUN,
	serverId: config.serverId,
	memberCorpCount: CORPS.length,
	memberCorporationIds: CORPS,
	basisSuspect: false,
	ineligibleWithEnabledMumbleAccount: ids.length,
	matches: ids.map((userId, index) => ({
		userId,
		reason: 'unmanaged_corp',
		mainCharacterName: `Character ${index + 1}`,
		loginName: `login-${index + 1}`,
		displayName: `Display ${index + 1}`,
	})),
}
const expectedSourceSha256 = createHash('sha256').update(JSON.stringify(source)).digest('hex')

function fixture({
	changedCorpBasis = false,
	eligibleAtDelete = null,
	memberAtDelete = null,
	deleteStatus = 200,
	absentPlayerCorp = false,
	npcCharacter = false,
	badCorp404 = false,
} = {}) {
	const accounts = new Map(
		source.matches.map((candidate) => [
			candidate.userId,
			{
				subjectId: candidate.userId,
				loginName: candidate.loginName,
				displayName: candidate.displayName,
				enabled: true,
			},
		])
	)
	const calls = []
	const detailReads = new Map()
	const corpReads = new Map()
	const fetchImpl = async (input, request) => {
		const url = new URL(input)
		calls.push({ url: url.toString(), method: request.method })
		let body
		let status = 200
		let json404 = false
		if (url.pathname === `/api/services-audit/runs/${FRESH_RUN}`) {
			body = {
				id: FRESH_RUN,
				status: 'awaiting_confirmation',
				completedAt: '2026-10-17T12:00:00.000Z',
				scanned: 100,
				eligibleCount: 43,
				ineligibleCount: 57,
				memberCorpCount: 37,
				memberCorporationIds: changedCorpBasis ? [...CORPS.slice(0, -1), '999999999'] : CORPS,
				basisComparedToCount: 37,
				basisRemovedCorporationIds: [],
				basisNote: null,
				basisSuspect: false,
				blastRadiusTripped: true,
			}
		} else if (url.pathname === `/api/services-audit/runs/${FRESH_RUN}/rows`) {
			body = {
				rows: source.matches.map((candidate) => ({
					...candidate,
					eligible: false,
				})),
				pagination: { page: 1, pageSize: 100, totalCount: 57, totalPages: 1 },
			}
		} else if (url.pathname === '/api/admin/users') {
			body = { total: 100 }
		} else if (url.pathname.startsWith('/api/corporations/')) {
			const corporationId = url.pathname.split('/').at(-1)
			const reads = (corpReads.get(corporationId) ?? 0) + 1
			corpReads.set(corporationId, reads)
			if (absentPlayerCorp) {
				status = 404
				if (badCorp404) body = '<html>wrong route</html>'
				else {
					body = { error: 'Corporation not found' }
					json404 = true
				}
			} else {
				body = {
					corporationId,
					isMemberCorporation:
						memberAtDelete === ids[Number(corporationId) - 900_000_001] && reads >= 3,
				}
			}
		} else if (url.pathname === '/v1/servers/srv-1/local-accounts' && request.method === 'GET') {
			body = { serverId: 'srv-1', accounts: [...accounts.values()] }
		} else if (url.pathname.startsWith('/api/admin/users/')) {
			const id = url.pathname.split('/').at(-1)
			const reads = (detailReads.get(id) ?? 0) + 1
			detailReads.set(id, reads)
			body = {
				id,
				is_admin: eligibleAtDelete === id && reads >= 3,
				characters: [
					{
						corporationId: npcCharacter ? '1000001' : String(900_000_000 + Number(id.slice(-12))),
					},
				],
			}
		} else if (url.pathname === '/v1/servers/srv-1/local-accounts:delete') {
			const [id] = JSON.parse(request.body).subjectIds
			if (deleteStatus !== 200) {
				status = deleteStatus
				body = { error: 'simulated failure' }
			} else {
				accounts.delete(id)
				body = { serverId: 'srv-1', deletedSubjectIds: [id], disconnectedSessions: 1 }
			}
		} else if (url.pathname.startsWith('/v1/servers/srv-1/local-accounts/')) {
			const id = url.pathname.split('/').at(-1)
			if (accounts.has(id)) body = { serverId: 'srv-1', account: accounts.get(id) }
			else status = 404
		} else if (url.pathname === '/v1/servers/srv-1/state/users') {
			const id = url.searchParams.get('subjectId')
			body = {
				serverId: 'srv-1',
				users: accounts.has(id)
					? [
							{
								subjectId: id,
								loginName: accounts.get(id).loginName,
								murmurUserId: 100,
							},
						]
					: [],
			}
		} else {
			throw new Error(`Unexpected request ${url}`)
		}
		return new Response(status === 404 && !json404 ? (body ?? '') : JSON.stringify(body), {
			status,
			headers: status === 404 && !json404 ? {} : { 'content-type': 'application/json' },
		})
	}
	return { calls, fetchImpl }
}

test('plans only the original 57 after a fresh audit and live eligibility checks', async () => {
	const { calls, fetchImpl } = fixture()
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	assert.equal(plan.candidates.length, 57)
	assert.equal(plan.skipped.length, 0)
	assert.ok(plan.freshAuditWarnings.some((warning) => warning.code === 'blast_radius'))
	assert.ok(calls.every((call) => call.method === 'GET'))
})

test('refuses a changed member-corporation basis before deletion', async () => {
	const { calls, fetchImpl } = fixture({ changedCorpBasis: true })
	await assert.rejects(
		makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 }),
		/member-corporation/
	)
	assert.ok(!calls.some((call) => call.method === 'POST'))
})

test('an unmanaged player corporation with no database row remains ineligible', async () => {
	const { fetchImpl } = fixture({ absentPlayerCorp: true })
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	assert.equal(plan.candidates.length, 57)
})

test('an unexpected proxy 404 cannot stand in for an absent managed corporation', async () => {
	const { calls, fetchImpl } = fixture({ absentPlayerCorp: true, badCorp404: true })
	await assert.rejects(
		makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 }),
		/Corporation .* did not return JSON/
	)
	assert.ok(!calls.some((call) => call.method === 'POST'))
})

test('an NPC corporation hidden by the detail route is skipped', async () => {
	const { fetchImpl } = fixture({ absentPlayerCorp: true, npcCharacter: true })
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	assert.equal(plan.candidates.length, 0)
	assert.equal(plan.skipped.length, 57)
	assert.ok(plan.skipped.every((item) => item.reason === 'npc_corporation_unverifiable'))
})

test('a changed source report cannot add another subject to the 57', async () => {
	const { calls, fetchImpl } = fixture()
	const changedSource = structuredClone(source)
	changedSource.matches[0].userId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
	await assert.rejects(
		makePlan(config, changedSource, { fetchImpl, now: () => NOW, expectedSourceSha256 }),
		/differs from the original/
	)
	assert.equal(calls.length, 0)
})

test('apply skips a user who becomes eligible just before deletion', async () => {
	const { calls, fetchImpl } = fixture({ eligibleAtDelete: ids[0] })
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	const events = []
	const results = await applyPlan(config, source, plan, approvedPlanDigest(plan), {
		fetchImpl,
		now: () => NOW,
		expectedSourceSha256,
		onResult: async (event) => events.push(event),
	})
	assert.equal(results.length, 57)
	assert.equal(results[0].status, 'skipped_currently_eligible')
	assert.equal(
		results.filter((result) => result.status === 'deleted_local_and_projection').length,
		56
	)
	assert.equal(events.filter((event) => event.status === 'attempting_delete').length, 56)
	assert.equal(calls.filter((call) => call.method === 'POST').length, 56)
})

test('apply skips a user whose corporation becomes a member just before deletion', async () => {
	const { calls, fetchImpl } = fixture({ memberAtDelete: ids[0] })
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	const results = await applyPlan(config, source, plan, approvedPlanDigest(plan), {
		fetchImpl,
		now: () => NOW,
		expectedSourceSha256,
	})
	assert.equal(results[0].status, 'skipped_currently_eligible')
	assert.equal(calls.filter((call) => call.method === 'POST').length, 56)
})

test('apply halts on a delete failure without attempting later subjects', async () => {
	const { calls, fetchImpl } = fixture({ deleteStatus: 503 })
	const plan = await makePlan(config, source, { fetchImpl, now: () => NOW, expectedSourceSha256 })
	const events = []
	await assert.rejects(
		applyPlan(config, source, plan, approvedPlanDigest(plan), {
			fetchImpl,
			now: () => NOW,
			expectedSourceSha256,
			onResult: async (event) => events.push(event),
		}),
		/HTTP 503/
	)
	assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
	assert.deepEqual(events, [{ userId: ids[0], status: 'attempting_delete' }])
})
