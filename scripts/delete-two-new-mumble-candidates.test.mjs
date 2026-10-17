import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { applyTwoPlan, makeTwoPlan, twoPlanDigest } from './delete-two-new-mumble-candidates.mjs'

const NOW = Date.parse('2026-10-17T12:30:00.000Z')
const RUN_ID = '11111111-1111-4111-8111-111111111111'
const CONFIG = {
	authBaseUrl: 'https://auth.example.test',
	controlBaseUrl: 'https://control.example.test',
	runId: RUN_ID,
	serverId: 'srv-1',
	cookie: 'session=test',
	controlToken: 'test-token',
}

function userId(index) {
	return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function fixture() {
	const source = {
		auditRunId: 'fc5a6bb4-332d-4cd7-8c48-f8f33de6b7ca',
		auditCompletedAt: '2026-10-17T12:00:00.000Z',
		serverId: 'srv-1',
		memberCorpCount: 36,
		memberCorporationIds: Array.from({ length: 36 }, (_, index) => String(100_000_000 + index)),
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
			userId: userId(index + 1),
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
		checkedAt: '2026-10-17T12:05:00.000Z',
		serverId: 'srv-1',
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		deferredCount: 82,
		candidates: source.matches.slice(0, 2).map((candidate) => ({
			...candidate,
			status: 'currently_ineligible_with_matching_account',
		})),
	}
	const hashes = {
		expectedSourceSha256: digest(source),
		expectedPreviewSha256: digest(preview),
	}
	const deleted = new Set()
	const calls = []
	const fetchImpl = async (url, request) => {
		const parsed = new URL(url)
		calls.push({ url: parsed, method: request.method, body: request.body })
		let body
		let status = 200
		if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}`) {
			body = {
				id: RUN_ID,
				status: 'awaiting_confirmation',
				completedAt: '2026-10-17T12:15:00.000Z',
				scanned: 5,
				eligibleCount: 3,
				ineligibleCount: 2,
				memberCorpCount: 36,
				memberCorporationIds: source.memberCorporationIds,
				basisComparedToCount: 36,
				basisRemovedCorporationIds: [],
				basisNote: null,
				basisSuspect: false,
				blastRadiusTripped: false,
			}
		} else if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}/rows`) {
			body = {
				rows: source.matches.slice(0, 2).map((candidate) => ({ ...candidate, eligible: false })),
				pagination: { page: 1, pageSize: 100, totalCount: 2, totalPages: 1 },
			}
		} else if (parsed.pathname === '/api/admin/users') {
			body = { users: [], total: 5 }
		} else if (parsed.pathname === '/v1/servers/srv-1/local-accounts') {
			body = {
				serverId: 'srv-1',
				accounts: source.matches.slice(0, 2).map((candidate) => ({
					subjectId: candidate.userId,
					enabled: true,
					loginName: candidate.loginName,
					displayName: candidate.displayName,
				})),
			}
		} else if (parsed.pathname.startsWith('/api/admin/users/')) {
			const id = parsed.pathname.split('/').at(-1)
			body = { id, is_admin: false, characters: [{ corporationId: null }] }
		} else if (parsed.pathname === '/v1/servers/srv-1/local-accounts:delete') {
			assert.equal(request.method, 'POST')
			const ids = JSON.parse(request.body).subjectIds
			assert.equal(ids.length, 1)
			assert.ok(ids[0] === userId(1) || ids[0] === userId(2))
			deleted.add(ids[0])
			body = { serverId: 'srv-1', deletedSubjectIds: ids, disconnectedSessions: 0 }
		} else if (parsed.pathname.startsWith('/v1/servers/srv-1/local-accounts/')) {
			const id = parsed.pathname.split('/').at(-1)
			const candidate = source.matches.find((match) => match.userId === id)
			if (deleted.has(id)) status = 404
			else {
				body = {
					serverId: 'srv-1',
					account: {
						subjectId: id,
						enabled: true,
						loginName: candidate.loginName,
						displayName: candidate.displayName,
					},
				}
			}
		} else if (parsed.pathname === '/v1/servers/srv-1/state/users') {
			const id = parsed.searchParams.get('subjectId')
			body = {
				serverId: 'srv-1',
				users: deleted.has(id)
					? []
					: [
							{
								subjectId: id,
								loginName: source.matches.find((match) => match.userId === id).loginName,
								murmurUserId: 42,
							},
						],
			}
		} else {
			throw new Error(`Unexpected request: ${parsed.pathname}`)
		}
		return new Response(status === 404 ? null : JSON.stringify(body), {
			status,
			headers: status === 404 ? {} : { 'content-type': 'application/json' },
		})
	}
	return { source, preview, hashes, deleted, calls, fetchImpl }
}

test('plans and applies exactly the reviewed first two after fresh and live checks', async () => {
	const { source, preview, hashes, deleted, calls, fetchImpl } = fixture()
	const plan = await makeTwoPlan(CONFIG, source, preview, { fetchImpl, now: () => NOW, ...hashes })
	assert.equal(plan.kind, 'mumble-exact-two-deletion-plan')
	assert.deepEqual(
		plan.candidates.map((candidate) => candidate.userId),
		[userId(1), userId(2)]
	)
	assert.equal(plan.deferredCount, 82)
	assert.ok(calls.every((call) => call.method === 'GET'))
	const results = await applyTwoPlan(CONFIG, source, preview, plan, twoPlanDigest(plan), {
		fetchImpl,
		now: () => NOW + 60_000,
		kickFixDeployed: true,
		...hashes,
	})
	assert.deepEqual(
		results.map((result) => result.status),
		['deleted_local_and_projection', 'deleted_local_and_projection']
	)
	assert.deepEqual([...deleted], [userId(1), userId(2)])
	assert.equal(calls.filter((call) => call.method === 'POST').length, 2)
	assert.ok(calls.every((call) => !call.url.pathname.includes(userId(3))))
})

test('rejects an unapproved or expired two-account plan without a request', async () => {
	const { source, preview, hashes, calls, fetchImpl } = fixture()
	const plan = await makeTwoPlan(CONFIG, source, preview, { fetchImpl, now: () => NOW, ...hashes })
	const before = calls.length
	await assert.rejects(
		applyTwoPlan(CONFIG, source, preview, plan, '0'.repeat(64), {
			fetchImpl,
			now: () => NOW,
			kickFixDeployed: true,
			...hashes,
		}),
		/approval does not match/
	)
	await assert.rejects(
		applyTwoPlan(CONFIG, source, preview, plan, twoPlanDigest(plan), {
			fetchImpl,
			now: () => NOW + 2 * 60 * 60 * 1000,
			kickFixDeployed: true,
			...hashes,
		}),
		/older than one hour/
	)
	assert.equal(calls.length, before)
})

test('rejects an audit completed before the reviewed preview', async () => {
	const { source, preview, hashes, calls, fetchImpl } = fixture()
	preview.checkedAt = '2026-10-17T12:20:00.000Z'
	await assert.rejects(
		makeTwoPlan(CONFIG, source, preview, {
			fetchImpl,
			now: () => NOW,
			...hashes,
			expectedPreviewSha256: digest(preview),
		}),
		/completed after the reviewed preview/
	)
	assert.ok(calls.every((call) => call.method === 'GET'))
})

test('stops after the first deletion if the second candidate becomes eligible', async () => {
	const { source, preview, hashes, deleted, fetchImpl } = fixture()
	const plan = await makeTwoPlan(CONFIG, source, preview, { fetchImpl, now: () => NOW, ...hashes })
	let secondUserReads = 1
	const results = []
	const driftFetch = (url, request) => {
		if (new URL(url).pathname === `/api/admin/users/${userId(2)}`) {
			secondUserReads += 1
			if (secondUserReads === 3) {
				return Promise.resolve(
					new Response(JSON.stringify({ id: userId(2), is_admin: true, characters: [] }), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					})
				)
			}
		}
		return fetchImpl(url, request)
	}
	await assert.rejects(
		applyTwoPlan(CONFIG, source, preview, plan, twoPlanDigest(plan), {
			fetchImpl: driftFetch,
			now: () => NOW + 60_000,
			kickFixDeployed: true,
			onResult: async (result) => results.push(result),
			...hashes,
		}),
		/changed before deletion/
	)
	assert.deepEqual([...deleted], [userId(1)])
	assert.deepEqual(
		results.map((result) => result.status),
		['attempting_delete', 'deleted_local_and_projection', 'stopped_currently_eligible']
	)
})

test('records an uncertain outcome and stops after a failed delete request', async () => {
	const { source, preview, hashes, deleted, fetchImpl } = fixture()
	const plan = await makeTwoPlan(CONFIG, source, preview, { fetchImpl, now: () => NOW, ...hashes })
	const results = []
	const failingFetch = (url, request) =>
		new URL(url).pathname === '/v1/servers/srv-1/local-accounts:delete'
			? Promise.resolve(new Response('', { status: 500 }))
			: fetchImpl(url, request)
	await assert.rejects(
		applyTwoPlan(CONFIG, source, preview, plan, twoPlanDigest(plan), {
			fetchImpl: failingFetch,
			now: () => NOW + 60_000,
			kickFixDeployed: true,
			onResult: async (result) => results.push(result),
			...hashes,
		}),
		/HTTP 500/
	)
	assert.deepEqual([...deleted], [])
	assert.deepEqual(
		results.map((result) => result.status),
		['attempting_delete', 'outcome_unknown']
	)
})
