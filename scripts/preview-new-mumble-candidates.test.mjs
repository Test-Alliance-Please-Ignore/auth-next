import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { previewFirstTwo } from './preview-new-mumble-candidates.mjs'

const NOW = Date.parse('2026-10-17T12:30:00.000Z')
const CONFIG = {
	authBaseUrl: 'https://auth.example.test',
	controlBaseUrl: 'https://control.example.test',
	serverId: 'srv-1',
	cookie: 'session=test',
	controlToken: 'test-token',
}

function userId(index) {
	return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function sourceReport() {
	return {
		auditRunId: 'fc5a6bb4-332d-4cd7-8c48-f8f33de6b7ca',
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
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

test('previews only two candidates with live GET checks and no delete request', async () => {
	const source = sourceReport()
	const calls = []
	const fetchImpl = async (url, request) => {
		const parsed = new URL(url)
		calls.push({ url: parsed, method: request.method })
		let body
		if (parsed.pathname === `/api/admin/users/${userId(1)}`) {
			body = { id: userId(1), is_admin: false, characters: [{ corporationId: null }] }
		} else if (parsed.pathname === `/api/admin/users/${userId(2)}`) {
			body = { id: userId(2), is_admin: true, characters: [] }
		} else if (parsed.pathname === `/v1/servers/srv-1/local-accounts/${userId(1)}`) {
			body = {
				serverId: 'srv-1',
				account: {
					subjectId: userId(1),
					enabled: true,
					loginName: 'login-1',
					displayName: 'Display 1',
				},
			}
		} else if (parsed.pathname === '/v1/servers/srv-1/state/users') {
			assert.equal(parsed.searchParams.get('subjectId'), userId(1))
			body = {
				serverId: 'srv-1',
				users: [{ subjectId: userId(1), loginName: 'login-1', murmurUserId: 42 }],
			}
		} else {
			throw new Error(`Unexpected preview request: ${parsed.pathname}`)
		}
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}
	const preview = await previewFirstTwo(CONFIG, source, {
		fetchImpl,
		now: () => NOW,
		expectedSourceSha256: digest(source),
	})
	assert.equal(preview.previewOnly, true)
	assert.equal(preview.deferredCount, 82)
	assert.deepEqual(
		preview.candidates.map((candidate) => candidate.status),
		['currently_ineligible_with_matching_account', 'currently_eligible']
	)
	assert.ok(calls.every((call) => call.method === 'GET'))
	assert.ok(calls.every((call) => !call.url.pathname.includes('delete')))
	assert.ok(calls.every((call) => !call.url.pathname.includes(userId(3))))
})

test('rejects a changed report or basis before any request', async () => {
	const source = sourceReport()
	let calls = 0
	const fetchImpl = async () => {
		calls += 1
		throw new Error('unexpected request')
	}
	const reviewedDigest = digest(source)
	source.matches[0].loginName = 'changed'
	await assert.rejects(
		previewFirstTwo(CONFIG, source, { fetchImpl, expectedSourceSha256: reviewedDigest }),
		/differs from the reviewed report/
	)
	source.basisRemovedCorporationIds = ['unexpected']
	await assert.rejects(
		previewFirstTwo(CONFIG, source, { fetchImpl, expectedSourceSha256: digest(source) }),
		/unreviewed member-corporation basis/
	)
	assert.equal(calls, 0)
})
