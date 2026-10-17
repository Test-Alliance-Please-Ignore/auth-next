import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { configFromEnvironment, runAudit, writeReportFile } from './audit-ineligible-mumble.mjs'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-10-17T12:30:00.000Z')
const AUTH_BASE = 'https://auth.example.test'
const CONTROL_BASE = 'http://127.0.0.1:3000'
const CONFIG = {
	authBaseUrl: AUTH_BASE,
	controlBaseUrl: CONTROL_BASE,
	runId: RUN_ID,
	serverId: 'srv-1',
	cookie: 'session=private-cookie',
	controlToken: 'private-token',
}

function userId(index) {
	return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

function fixture(options = {}) {
	const count = options.count ?? 2
	const rows = Array.from({ length: count }, (_, index) => ({
		userId: userId(index + 1),
		eligible: false,
		reason: 'unmanaged_corp',
		mainCharacterName: `User ${index + 1}`,
	}))
	const run = {
		id: RUN_ID,
		status: count > 0 ? 'awaiting_confirmation' : 'completed',
		completedAt: '2026-10-17T12:00:00.000Z',
		scanned: count + 3,
		eligibleCount: 3,
		ineligibleCount: count,
		memberCorpCount: 5,
		memberCorporationIds: ['corp-1', 'corp-2', 'corp-3', 'corp-4', 'corp-5'],
		basisComparedToCount: null,
		basisRemovedCorporationIds: [],
		basisNote: null,
		basisSuspect: false,
		blastRadiusTripped: false,
		...options.run,
	}
	const listing = {
		serverId: 'srv-1',
		accounts: [
			{ subjectId: userId(1), enabled: true, loginName: 'first', displayName: 'First' },
			{ subjectId: userId(2), enabled: false, loginName: 'second', displayName: 'Second' },
			{ subjectId: userId(999), enabled: true, loginName: 'eligible', displayName: 'Eligible' },
		],
		...options.listing,
	}
	const calls = []
	const fetchImpl = async (url, request) => {
		calls.push({ url: String(url), request })
		const parsed = new URL(url)
		let body
		if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}`) {
			body = run
		} else if (parsed.pathname === `/api/services-audit/runs/${RUN_ID}/rows`) {
			const page = Number(parsed.searchParams.get('page'))
			body = {
				rows: rows.slice((page - 1) * 100, page * 100),
				pagination: {
					page,
					pageSize: 100,
					totalCount: count,
					totalPages: Math.max(1, Math.ceil(count / 100)),
				},
			}
			if (options.page) body = options.page(body)
		} else if (parsed.pathname === '/api/admin/users') {
			body = { users: [], total: options.userTotal ?? run.scanned }
		} else if (parsed.pathname === '/v1/servers/srv-1/local-accounts') {
			body = listing
		} else {
			throw new Error(`Unexpected request: ${url}`)
		}
		if (options.status && parsed.pathname === options.status.path) {
			return new Response('', { status: options.status.code })
		}
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}
	return { calls, fetchImpl }
}

test('reports enabled ineligible accounts after reading every audit page', async () => {
	const { calls, fetchImpl } = fixture({ count: 101 })
	const report = await runAudit(CONFIG, { fetchImpl, now: () => NOW })

	assert.equal(report.ineligibleUsers, 101)
	assert.equal(report.memberCorpCount, 5)
	assert.deepEqual(report.memberCorporationIds, ['corp-1', 'corp-2', 'corp-3', 'corp-4', 'corp-5'])
	assert.equal(report.ineligibleWithEnabledMumbleAccount, 1)
	assert.equal(report.ineligibleWithDisabledMumbleAccount, 1)
	assert.equal(report.ineligibleWithoutMumbleAccount, 99)
	assert.deepEqual(
		report.matches.map((match) => match.userId),
		[userId(1)]
	)
	assert.equal(calls.filter((call) => call.url.includes('/rows?')).length, 2)
	assert.equal(calls.filter((call) => call.url.includes('/local-accounts')).length, 1)
	assert.ok(
		calls.every((call) => call.request.method === 'GET' && call.request.redirect === 'error')
	)
	for (const call of calls) {
		if (call.url.startsWith(AUTH_BASE)) {
			assert.equal(call.request.headers.Cookie, CONFIG.cookie)
			assert.equal(call.request.headers.Authorization, undefined)
		} else {
			assert.equal(call.request.headers.Authorization, `Bearer ${CONFIG.controlToken}`)
			assert.equal(call.request.headers.Cookie, undefined)
		}
	}
})

test('refuses an incomplete audit page before reading mumble-control', async () => {
	const { calls, fetchImpl } = fixture({
		page: (result) => ({ ...result, pagination: { ...result.pagination, totalCount: 3 } }),
	})
	await assert.rejects(
		runAudit(CONFIG, { fetchImpl, now: () => NOW }),
		/incomplete or inconsistent/
	)
	assert.equal(
		calls.some((call) => call.url.includes('/local-accounts')),
		false
	)
})

test('refuses a truncated audit or malformed basis metadata', async () => {
	for (const options of [
		{ userTotal: 99 },
		{ run: { basisSuspect: undefined } },
		{ run: { blastRadiusTripped: undefined } },
		{ run: { memberCorpCount: undefined } },
		{ run: { memberCorporationIds: ['corp-1'] } },
		{ run: { status: 'completed' } },
	]) {
		const { fetchImpl } = fixture(options)
		await assert.rejects(runAudit(CONFIG, { fetchImpl, now: () => NOW }))
	}
})

test('reports warning flags without hiding a read-only suspect scan', async () => {
	const { fetchImpl } = fixture({
		run: {
			basisSuspect: true,
			blastRadiusTripped: true,
			basisComparedToCount: 6,
			basisRemovedCorporationIds: ['corp-6'],
			basisNote: 'One member corporation left the basis.',
		},
	})
	const report = await runAudit(CONFIG, { fetchImpl, now: () => NOW })
	assert.equal(report.ineligibleWithEnabledMumbleAccount, 1)
	assert.deepEqual(
		report.auditWarnings.map((warning) => warning.code),
		['basis_shrank', 'blast_radius']
	)
	assert.deepEqual(report.basisRemovedCorporationIds, ['corp-6'])
	assert.equal(report.basisNote, 'One member corporation left the basis.')
})

test('warns when corporations leave the basis below the shrink threshold', async () => {
	const { fetchImpl } = fixture({
		run: {
			basisComparedToCount: 6,
			basisRemovedCorporationIds: ['corp-6'],
		},
	})
	const report = await runAudit(CONFIG, { fetchImpl, now: () => NOW })
	assert.deepEqual(
		report.auditWarnings.map((warning) => warning.code),
		['member_corps_changed']
	)
})

test('reports zero matches when no users are ineligible', async () => {
	const { fetchImpl } = fixture({ count: 0 })
	const report = await runAudit(CONFIG, { fetchImpl, now: () => NOW })
	assert.equal(report.ineligibleUsers, 0)
	assert.equal(report.ineligibleWithEnabledMumbleAccount, 0)
	assert.deepEqual(report.matches, [])
})

test('refuses duplicate Mumble subjects and never includes secrets in HTTP errors', async () => {
	const duplicate = fixture({
		listing: {
			accounts: [
				{ subjectId: userId(1), enabled: true },
				{ subjectId: userId(1), enabled: true },
			],
		},
	})
	await assert.rejects(
		runAudit(CONFIG, { fetchImpl: duplicate.fetchImpl, now: () => NOW }),
		/duplicate subject/
	)

	const unauthorized = fixture({
		status: { path: '/v1/servers/srv-1/local-accounts', code: 401 },
	})
	await assert.rejects(
		runAudit(CONFIG, { fetchImpl: unauthorized.fetchImpl, now: () => NOW }),
		(error) =>
			!error.message.includes(CONFIG.cookie) &&
			!error.message.includes(CONFIG.controlToken) &&
			/HTTP 401/.test(error.message)
	)
})

test('refuses an empty Mumble account list that may indicate the wrong server ID', async () => {
	const { fetchImpl } = fixture({ listing: { accounts: [] } })
	await assert.rejects(runAudit(CONFIG, { fetchImpl, now: () => NOW }), /account list is empty/)
})

test('reads credentials from owner-only files', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'mumble-audit-'))
	try {
		const cookieFile = join(directory, 'cookie')
		const tokenFile = join(directory, 'token')
		await writeFile(cookieFile, 'session=private-cookie\n', { mode: 0o600 })
		await writeFile(tokenFile, 'private-token\n', { mode: 0o600 })
		const env = {
			AUTH_NEXT_BASE_URL: AUTH_BASE,
			AUTH_NEXT_AUDIT_RUN_ID: RUN_ID,
			AUTH_NEXT_COOKIE_FILE: cookieFile,
			MUMBLE_CONTROL_BASE_URL: CONTROL_BASE,
			MUMBLE_CONTROL_TOKEN_FILE: tokenFile,
			MUMBLE_SERVER_ID: 'srv-1',
			MUMBLE_AUDIT_OUTPUT_FILE: join(directory, 'report.json'),
		}
		assert.equal((await configFromEnvironment(env)).cookie, CONFIG.cookie)
		await writeFile(tokenFile, 'Bearer private-token\n')
		await assert.rejects(configFromEnvironment(env), /must contain only the raw token/)
		await writeFile(tokenFile, 'private-token\n')
		await assert.rejects(
			configFromEnvironment({ ...env, AUTH_NEXT_BASE_URL: undefined }),
			/AUTH_NEXT_BASE_URL is required/
		)
		await assert.rejects(
			configFromEnvironment({ ...env, AUTH_NEXT_BASE_URL: 'not-a-url' }),
			/AUTH_NEXT_BASE_URL must be a valid URL/
		)
		await chmod(cookieFile, 0o644)
		await assert.rejects(configFromEnvironment(env), /mode 0600/)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('writes a private report outside the checkout and refuses overwrite', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'mumble-audit-report-'))
	try {
		const reportFile = join(directory, 'report.json')
		await writeReportFile({ matches: [{ userId: userId(1) }] }, reportFile)
		const metadata = await stat(reportFile)
		assert.equal(metadata.mode & 0o777, 0o600)
		await assert.rejects(writeReportFile({}, reportFile), /EEXIST/)
		await assert.rejects(writeReportFile({}, 'report.json'), /absolute path/)
		await assert.rejects(
			writeReportFile({}, join(dirname(fileURLToPath(import.meta.url)), 'report.json')),
			/outside the auth-next repository/
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
