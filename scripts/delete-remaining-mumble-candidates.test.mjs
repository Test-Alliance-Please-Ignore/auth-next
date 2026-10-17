import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
	applyRemainingPlan,
	makeRemainingPlan,
	remainingPlanDigest,
} from './delete-remaining-mumble-candidates.mjs'

const NOW = Date.parse('2026-10-17T12:00:00.000Z')
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const CONFIG = {
	authBaseUrl: 'https://auth.example.test',
	controlBaseUrl: 'https://control.example.test',
	runId: RUN_ID,
	serverId: 'srv-1',
	cookie: 'session=test',
	controlToken: 'test-token',
}

function id(index) {
	return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function fixture({
	liveMemberIndex = null,
	npcIndex = null,
	npcAltMemberIndex = null,
	driftIndex = null,
	lateMemberAltIndex = null,
	missingEsiIndex = null,
	failFirstDelete = false,
	changedBasis = false,
} = {}) {
	const memberCorporationIds = Array.from({ length: 36 }, (_, index) => String(100_000_000 + index))
	const source = {
		auditRunId: 'fc5a6bb4-332d-4cd7-8c48-f8f33de6b7ca',
		auditCompletedAt: '2026-10-17T10:00:00.000Z',
		serverId: 'srv-1',
		memberCorpCount: 36,
		memberCorporationIds,
		basisComparedToCount: 37,
		basisRemovedCorporationIds: ['98648795'],
		basisSuspect: false,
		basisNote: null,
		blastRadiusTripped: true,
		auditWarnings: [
			{ code: 'member_corps_changed', message: 'Reviewed removal' },
			{ code: 'blast_radius', message: 'Review counts' },
		],
		ineligibleWithEnabledMumbleAccount: 84,
		matches: Array.from({ length: 84 }, (_, index) => ({
			userId: id(index + 1),
			reason: 'unmanaged_corp',
			mainCharacterName: `Character ${index + 1}`,
			loginName: `login-${index + 1}`,
			displayName: `Display ${index + 1}`,
		})),
	}
	const preview = {
		kind: 'mumble-candidate-preview',
		version: 1,
		previewOnly: true,
		checkedAt: '2026-10-17T10:05:00.000Z',
		serverId: 'srv-1',
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		deferredCount: 82,
		candidates: source.matches.slice(0, 2).map((candidate) => ({
			...candidate,
			status: 'currently_ineligible_with_matching_account',
		})),
	}
	const twoPlan = {
		kind: 'mumble-exact-two-deletion-plan',
		serverId: 'srv-1',
		sourceSha256: digest(source),
		previewSha256: digest(preview),
		freshAuditRunId: '22222222-2222-4222-8222-222222222222',
		candidates: source.matches.slice(0, 2),
	}
	const twoResult = {
		rawSha256: 'result-file-sha',
		modifiedAt: '2026-10-17T10:40:00.000Z',
		records: [
			{ planSha256: digest(twoPlan) },
			{ status: 'attempting_delete', userId: id(1) },
			{ status: 'deleted_local_and_projection', userId: id(1), disconnectedSessions: 0 },
			{ status: 'attempting_delete', userId: id(2) },
			{ status: 'deleted_local_and_projection', userId: id(2), disconnectedSessions: 0 },
		],
	}
	const pins = {
		expectedSourceSha256: digest(source),
		expectedPreviewSha256: digest(preview),
		expectedTwoPlanSha256: digest(twoPlan),
		expectedTwoResultSha256: twoResult.rawSha256,
		expectedRemainingIdsSha256: digest(
			source.matches.slice(2).map((candidate) => candidate.userId)
		),
	}
	const deleted = new Set()
	const calls = []
	const liveState = { memberIndex: liveMemberIndex }
	const detailReads = new Map()
	const fetchImpl = async (url, request) => {
		const parsed = new URL(url)
		calls.push({ url: parsed, method: request.method, body: request.body })
		let body
		let status = 200
		if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}`) {
			body = {
				id: RUN_ID,
				status: 'awaiting_confirmation',
				completedAt: '2026-10-17T11:00:00.000Z',
				scanned: 100,
				eligibleCount: 16,
				ineligibleCount: 84,
				memberCorpCount: 36,
				memberCorporationIds: changedBasis
					? memberCorporationIds.slice(1).concat('99999999')
					: memberCorporationIds,
				basisComparedToCount: 36,
				basisRemovedCorporationIds: [],
				basisNote: null,
				basisSuspect: false,
				blastRadiusTripped: true,
			}
		} else if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}/rows`) {
			body = {
				rows: source.matches.map((candidate) => ({ ...candidate, eligible: false })),
				pagination: { page: 1, pageSize: 100, totalCount: 84, totalPages: 1 },
			}
		} else if (parsed.pathname === '/api/admin/users') {
			body = { users: [], total: 100 }
		} else if (parsed.pathname === '/v1/servers/srv-1/local-accounts') {
			body = {
				serverId: 'srv-1',
				accounts: source.matches
					.slice(2)
					.filter((candidate) => !deleted.has(candidate.userId))
					.map((candidate) => ({
						subjectId: candidate.userId,
						enabled: true,
						loginName: candidate.loginName,
						displayName: candidate.displayName,
					})),
			}
		} else if (parsed.pathname.startsWith('/api/admin/users/')) {
			const userId = parsed.pathname.split('/').at(-1)
			const index = source.matches.findIndex((candidate) => candidate.userId === userId) + 1
			const reads = (detailReads.get(userId) ?? 0) + 1
			detailReads.set(userId, reads)
			const corporationId =
				index === driftIndex && reads > 1
					? '1000002'
					: index === npcIndex || index === npcAltMemberIndex
						? '1000001'
						: '20000000'
			body = {
				id: userId,
				is_admin: false,
				characters: [
					{ characterId: String(90_000_000 + index), corporationId },
					...(index === npcAltMemberIndex || (index === lateMemberAltIndex && reads > 1)
						? [{ characterId: String(91_000_000 + index), corporationId: memberCorporationIds[0] }]
						: []),
				],
			}
		} else if (parsed.pathname === '/api/corporations/20000000') {
			body = { corporationId: '20000000', isMemberCorporation: false }
		} else if (parsed.pathname === '/api/corporations/1000001') {
			status = 404
			body = { error: 'Corporation not found' }
		} else if (parsed.hostname === 'esi.evetech.net') {
			assert.equal(request.method, 'POST')
			body = JSON.parse(request.body)
				.filter((characterId) => characterId - 90_000_000 !== missingEsiIndex)
				.map((characterId) => {
					const alt = characterId >= 91_000_000
					const index = characterId - (alt ? 91_000_000 : 90_000_000)
					return {
						character_id: characterId,
						corporation_id:
							alt || index === liveState.memberIndex
								? Number(memberCorporationIds[0])
								: index === npcIndex || index === npcAltMemberIndex
									? 1_000_001
									: 20_000_000,
					}
				})
		} else if (parsed.pathname === '/v1/servers/srv-1/local-accounts:delete') {
			assert.equal(request.method, 'POST')
			const [userId] = JSON.parse(request.body).subjectIds
			assert.ok(source.matches.slice(2).some((candidate) => candidate.userId === userId))
			if (failFirstDelete && deleted.size === 0) {
				status = 500
				body = { error: 'failed' }
			} else {
				deleted.add(userId)
				body = { serverId: 'srv-1', deletedSubjectIds: [userId], disconnectedSessions: 0 }
			}
		} else if (parsed.pathname.startsWith('/v1/servers/srv-1/local-accounts/')) {
			const userId = parsed.pathname.split('/').at(-1)
			const candidate = source.matches.find((match) => match.userId === userId)
			if (deleted.has(userId)) status = 404
			else
				body = {
					serverId: 'srv-1',
					account: {
						subjectId: userId,
						enabled: true,
						loginName: candidate.loginName,
						displayName: candidate.displayName,
					},
				}
		} else if (parsed.pathname === '/v1/servers/srv-1/state/users') {
			const userId = parsed.searchParams.get('subjectId')
			const candidate = source.matches.find((match) => match.userId === userId)
			body = {
				serverId: 'srv-1',
				users: deleted.has(userId)
					? []
					: [{ subjectId: userId, loginName: candidate.loginName, murmurUserId: 42 }],
			}
		} else {
			throw new Error(`Unexpected request: ${parsed.pathname}`)
		}
		return new Response(status === 404 && body === undefined ? null : JSON.stringify(body), {
			status,
			headers: status === 404 && body === undefined ? {} : { 'content-type': 'application/json' },
		})
	}
	return { source, preview, twoPlan, twoResult, pins, deleted, calls, liveState, fetchImpl }
}

test('plans and applies only the reviewed remaining 82 after live affiliation checks', async () => {
	const f = fixture()
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.equal(plan.candidates.length, 82)
	assert.equal(plan.skipped.length, 0)
	assert.ok(
		f.calls.every((call) => call.url.pathname !== '/v1/servers/srv-1/local-accounts:delete')
	)
	const results = await applyRemainingPlan(
		CONFIG,
		f.source,
		f.preview,
		f.twoPlan,
		f.twoResult,
		plan,
		remainingPlanDigest(plan),
		{
			fetchImpl: f.fetchImpl,
			now: () => NOW + 60_000,
			kickFixDeployed: true,
			authFixDeployed: true,
			...f.pins,
		}
	)
	assert.equal(results.length, 82)
	assert.ok(results.every((result) => result.status === 'deleted_local_and_projection'))
	assert.equal(f.deleted.size, 82)
	assert.ok(!f.deleted.has(id(1)) && !f.deleted.has(id(2)))
	assert.equal(
		f.calls.filter((call) => call.url.pathname === '/v1/servers/srv-1/local-accounts:delete')
			.length,
		82
	)
})

test('skips an account whose live ESI corporation is a member corporation', async () => {
	const f = fixture({ liveMemberIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.equal(plan.candidates.length, 81)
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'live_member_corporation' }])
	assert.ok(
		f.calls.every((call) => call.url.pathname !== '/v1/servers/srv-1/local-accounts:delete')
	)
})

test('an NPC-only user is eligible for deletion after exact ESI and auth-next checks', async () => {
	const f = fixture({ npcIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.equal(plan.candidates.length, 82)
	assert.equal(plan.skipped.length, 0)
	assert.ok(plan.candidates.some((candidate) => candidate.userId === id(3)))
	assert.equal(f.deleted.size, 0)
})

test('an NPC character with a member-corporation alt keeps the Mumble account', async () => {
	const f = fixture({ npcAltMemberIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.equal(plan.candidates.length, 81)
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'live_member_corporation' }])
})

test('skips an NPC character when ESI omits its affiliation', async () => {
	const f = fixture({ npcIndex: 3, missingEsiIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'esi_affiliation_incomplete' }])
})

test('skips an NPC character changed between ESI and final auth-next read', async () => {
	const f = fixture({ npcIndex: 3, driftIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'character_affiliation_changed' }])
})

test('skips a newly linked member-corporation alt after the ESI check', async () => {
	const f = fixture({ npcIndex: 3, lateMemberAltIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'character_affiliation_changed' }])
})

test('skips a player-corporation change after the ESI check', async () => {
	const f = fixture({ driftIndex: 3 })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	assert.deepEqual(plan.skipped, [{ userId: id(3), reason: 'character_affiliation_changed' }])
})

test('skips a newly eligible user immediately before the first deletion', async () => {
	const f = fixture()
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	const events = []
	const results = await applyRemainingPlan(
		CONFIG,
		f.source,
		f.preview,
		f.twoPlan,
		f.twoResult,
		plan,
		remainingPlanDigest(plan),
		{
			fetchImpl: f.fetchImpl,
			now: () => NOW + 60_000,
			kickFixDeployed: true,
			authFixDeployed: true,
			onResult: async (event) => {
				events.push(event)
				if (event.status === 'checking' && event.userId === id(3)) f.liveState.memberIndex = 3
			},
			...f.pins,
		}
	)
	assert.equal(results.length, 82)
	assert.deepEqual(
		events
			.filter((event) => event.status === 'skipped_live_member_corporation')
			.map((event) => event.userId),
		[id(3)]
	)
	assert.equal(f.deleted.size, 81)
	assert.ok(!f.deleted.has(id(3)))
})

test('rejects corporation-basis drift before any candidate check', async () => {
	const f = fixture({ changedBasis: true })
	await assert.rejects(
		makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
			fetchImpl: f.fetchImpl,
			now: () => NOW,
			...f.pins,
		}),
		/changed or unreviewed member-corporation basis/
	)
	assert.ok(f.calls.every((call) => !call.url.pathname.startsWith('/api/admin/users/')))
})

test('rejects a changed first-two result log before any request', async () => {
	const f = fixture()
	f.twoResult.rawSha256 = 'changed-result'
	await assert.rejects(
		makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
			fetchImpl: f.fetchImpl,
			now: () => NOW,
			...f.pins,
		}),
		/First-two result log changed/
	)
	assert.equal(f.calls.length, 0)
})

test('rejects a plan made before the NPC eligibility check changed', async () => {
	const f = fixture()
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	plan.version = 1
	const priorCalls = f.calls.length
	await assert.rejects(
		applyRemainingPlan(
			CONFIG,
			f.source,
			f.preview,
			f.twoPlan,
			f.twoResult,
			plan,
			remainingPlanDigest(plan),
			{
				fetchImpl: f.fetchImpl,
				now: () => NOW + 60_000,
				kickFixDeployed: true,
				authFixDeployed: true,
				...f.pins,
			}
		),
		/Plan does not cover exactly the reviewed 82 candidates/
	)
	assert.equal(f.calls.length, priorCalls)
})

test('requires both production fixes before apply makes any request', async () => {
	const f = fixture()
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	const priorCalls = f.calls.length
	await assert.rejects(
		applyRemainingPlan(
			CONFIG,
			f.source,
			f.preview,
			f.twoPlan,
			f.twoResult,
			plan,
			remainingPlanDigest(plan),
			{ fetchImpl: f.fetchImpl, now: () => NOW, kickFixDeployed: true, ...f.pins }
		),
		/Both control and auth-next fixes must be deployed/
	)
	assert.equal(f.calls.length, priorCalls)
})

test('stops on an uncertain delete outcome and never attempts another subject', async () => {
	const f = fixture({ failFirstDelete: true })
	const plan = await makeRemainingPlan(CONFIG, f.source, f.preview, f.twoPlan, f.twoResult, {
		fetchImpl: f.fetchImpl,
		now: () => NOW,
		...f.pins,
	})
	const events = []
	await assert.rejects(
		applyRemainingPlan(
			CONFIG,
			f.source,
			f.preview,
			f.twoPlan,
			f.twoResult,
			plan,
			remainingPlanDigest(plan),
			{
				fetchImpl: f.fetchImpl,
				now: () => NOW + 60_000,
				kickFixDeployed: true,
				authFixDeployed: true,
				onResult: async (event) => events.push(event),
				...f.pins,
			}
		),
		/HTTP 500/
	)
	assert.deepEqual(
		events.filter((event) => event.status === 'outcome_unknown').map((event) => event.userId),
		[id(3)]
	)
	assert.equal(
		f.calls.filter((call) => call.url.pathname === '/v1/servers/srv-1/local-accounts:delete')
			.length,
		1
	)
})
