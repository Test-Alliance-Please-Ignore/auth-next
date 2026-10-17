#!/usr/bin/env node

/**
 * Read-only intersection of a completed auth-next Services Audit and enabled
 * mumble-control local accounts. This does not inspect Murmur registrations or
 * disconnect/delete anyone.
 *
 * Run from a trusted operator machine that can reach both APIs. Put the raw
 * auth-next admin Cookie header VALUE and the mumble-control admin token in
 * separate mode-0600 files. Never put either secret on the command line.
 *
 *   AUTH_NEXT_BASE_URL=https://auth.example.invalid \
 *   AUTH_NEXT_AUDIT_RUN_ID=00000000-0000-0000-0000-000000000000 \
 *   AUTH_NEXT_COOKIE_FILE=/secure/auth-cookie \
 *   MUMBLE_CONTROL_BASE_URL=http://127.0.0.1:3000 \
 *   MUMBLE_CONTROL_TOKEN_FILE=/secure/control-token \
 *   MUMBLE_SERVER_ID=srv-1 \
 *   MUMBLE_AUDIT_OUTPUT_FILE=/secure/reports/ineligible-mumble.json \
 *   node scripts/audit-ineligible-mumble.mjs
 *
 * Start the Services Audit from the admin UI first. A report is emitted only
 * after every page and the control API account list have been validated. The
 * output file must be outside this repository; it is created mode 0600 and
 * never overwrites an existing file. Review the corporation basis before
 * acting on the report, and recheck each candidate's current eligibility.
 */
import { Buffer } from 'node:buffer'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 30_000
const MAX_AUDIT_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_CONTROL_RESPONSE_BYTES = 32 * 1024 * 1024
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function required(value, name) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${name} is required`)
	}
	return value.trim()
}

function baseUrl(value, name) {
	const input = required(value, name)
	let url
	try {
		url = new URL(input)
	} catch {
		throw new Error(`${name} must be a valid URL`)
	}
	const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error(`${name} must be an HTTPS origin or an HTTP loopback origin`)
	}
	return url.origin
}

async function readSecret(path, name) {
	const file = required(path, name)
	const metadata = await stat(file)
	if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
		throw new Error(`${name} must be a regular file readable only by its owner (mode 0600)`)
	}
	const value = (await readFile(file, 'utf8')).trim()
	if (!value || /[\r\n]/.test(value)) {
		throw new Error(`${name} must contain one non-empty line`)
	}
	if (name === 'MUMBLE_CONTROL_TOKEN_FILE' && /^(?:authorization\s*:|bearer\s+)/i.test(value)) {
		throw new Error(`${name} must contain only the raw token, without Authorization: or Bearer`)
	}
	return value
}

export async function configFromEnvironment(env = process.env) {
	const runId = required(env.AUTH_NEXT_AUDIT_RUN_ID, 'AUTH_NEXT_AUDIT_RUN_ID')
	if (!UUID_PATTERN.test(runId)) {
		throw new Error('AUTH_NEXT_AUDIT_RUN_ID must be a UUID')
	}
	const serverId = required(env.MUMBLE_SERVER_ID, 'MUMBLE_SERVER_ID')
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(serverId)) {
		throw new Error('MUMBLE_SERVER_ID contains invalid characters')
	}
	return {
		authBaseUrl: baseUrl(env.AUTH_NEXT_BASE_URL, 'AUTH_NEXT_BASE_URL'),
		controlBaseUrl: baseUrl(env.MUMBLE_CONTROL_BASE_URL, 'MUMBLE_CONTROL_BASE_URL'),
		runId,
		serverId,
		cookie: await readSecret(env.AUTH_NEXT_COOKIE_FILE, 'AUTH_NEXT_COOKIE_FILE'),
		controlToken: await readSecret(env.MUMBLE_CONTROL_TOKEN_FILE, 'MUMBLE_CONTROL_TOKEN_FILE'),
		outputFile: required(env.MUMBLE_AUDIT_OUTPUT_FILE, 'MUMBLE_AUDIT_OUTPUT_FILE'),
	}
}

/** Create a private report outside the source checkout; never overwrite one. */
export async function writeReportFile(report, outputFile) {
	if (!isAbsolute(outputFile)) {
		throw new Error('MUMBLE_AUDIT_OUTPUT_FILE must be an absolute path')
	}
	const parent = await realpath(dirname(outputFile))
	const repoRoot = await realpath(REPO_ROOT)
	if (parent === repoRoot || parent.startsWith(`${repoRoot}${sep}`)) {
		throw new Error('MUMBLE_AUDIT_OUTPUT_FILE must be outside the auth-next repository')
	}
	await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600,
	})
}

async function getJson(fetchImpl, url, headers, label, maxBytes) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	let response
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			headers: { Accept: 'application/json', ...headers },
			redirect: 'error',
			signal: controller.signal,
		})
		if (response.status !== 200) {
			if (label === 'Mumble account list' && response.status === 401) {
				throw new Error(
					'Mumble account list returned HTTP 401; verify the raw token matches an admin-scoped entry in the running control API MURMUR_CONTROL_API_TOKENS configuration'
				)
			}
			throw new Error(`${label} returned HTTP ${response.status}`)
		}
		if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
			throw new Error(`${label} did not return JSON`)
		}
		const contentLength = Number(response.headers.get('content-length'))
		if (Number.isFinite(contentLength) && contentLength > maxBytes) {
			throw new Error(`${label} exceeded the ${maxBytes}-byte response limit`)
		}
		if (!response.body) throw new Error(`${label} returned an empty body`)
		const chunks = []
		let size = 0
		for await (const chunk of response.body) {
			size += chunk.byteLength
			if (size > maxBytes) {
				throw new Error(`${label} exceeded the ${maxBytes}-byte response limit`)
			}
			chunks.push(chunk)
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString('utf8'))
		} catch {
			throw new Error(`${label} returned invalid JSON`)
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error
		throw new Error(`${label} request failed or timed out`)
	} finally {
		clearTimeout(timeout)
	}
}

function validateRun(run, runId, now) {
	if (!run || typeof run !== 'object' || run.id !== runId) {
		throw new Error('Audit run response does not match the requested ID')
	}
	if (!['completed', 'awaiting_confirmation'].includes(run.status)) {
		throw new Error(`Audit run is not complete (status: ${String(run.status)})`)
	}
	if (typeof run.basisSuspect !== 'boolean' || typeof run.blastRadiusTripped !== 'boolean') {
		throw new Error('Audit run warning flags are missing or invalid')
	}
	if (!Number.isSafeInteger(run.memberCorpCount) || run.memberCorpCount < 1) {
		throw new Error('Audit run has no valid member-corporation basis')
	}
	if (
		!Array.isArray(run.memberCorporationIds) ||
		run.memberCorporationIds.length !== run.memberCorpCount ||
		run.memberCorporationIds.some((id) => typeof id !== 'string' || !id) ||
		new Set(run.memberCorporationIds).size !== run.memberCorpCount
	) {
		throw new Error('Audit run member-corporation IDs do not match its basis count')
	}
	if (
		run.basisComparedToCount !== null &&
		(!Number.isSafeInteger(run.basisComparedToCount) || run.basisComparedToCount < 1)
	) {
		throw new Error('Audit run has an invalid member-corporation baseline count')
	}
	if (
		run.basisRemovedCorporationIds !== null &&
		(!Array.isArray(run.basisRemovedCorporationIds) ||
			run.basisRemovedCorporationIds.some((id) => typeof id !== 'string' || !id))
	) {
		throw new Error('Audit run has invalid removed-corporation IDs')
	}
	if (run.basisNote !== null && typeof run.basisNote !== 'string') {
		throw new Error('Audit run has an invalid basis note')
	}
	for (const field of ['scanned', 'eligibleCount', 'ineligibleCount']) {
		if (!Number.isSafeInteger(run[field]) || run[field] < 0) {
			throw new Error(`Audit run has an invalid ${field}`)
		}
	}
	if (run.scanned === 0 || run.eligibleCount + run.ineligibleCount !== run.scanned) {
		throw new Error('Audit run counts are incomplete or inconsistent')
	}
	if (
		(run.status === 'completed' && run.ineligibleCount !== 0) ||
		(run.status === 'awaiting_confirmation' && run.ineligibleCount === 0)
	) {
		throw new Error('Audit run status is inconsistent with its ineligible count')
	}
	const completedAtMs = Date.parse(run.completedAt)
	if (!Number.isFinite(completedAtMs) || completedAtMs > now + 5 * 60 * 1000) {
		throw new Error('Audit run has an invalid or future completion time')
	}
	return {
		id: run.id,
		status: run.status,
		completedAt: run.completedAt,
		scanned: run.scanned,
		eligibleCount: run.eligibleCount,
		ineligibleCount: run.ineligibleCount,
		memberCorpCount: run.memberCorpCount,
		memberCorporationIds: run.memberCorporationIds,
		basisComparedToCount: run.basisComparedToCount,
		basisRemovedCorporationIds: run.basisRemovedCorporationIds,
		basisNote: run.basisNote,
		basisSuspect: run.basisSuspect,
		blastRadiusTripped: run.blastRadiusTripped,
	}
}

/** Return a report only when both read-only sources are complete and valid. */
export async function runAudit(config, { fetchImpl = fetch, now = Date.now } = {}) {
	const authHeaders = {
		Cookie: config.cookie,
		'X-Requested-With': 'XMLHttpRequest',
	}
	const controlHeaders = { Authorization: `Bearer ${config.controlToken}` }
	const runUrl = `${config.authBaseUrl}/api/services-audit/runs/${encodeURIComponent(config.runId)}`
	const run = validateRun(
		await getJson(fetchImpl, runUrl, authHeaders, 'Audit run', MAX_AUDIT_RESPONSE_BYTES),
		config.runId,
		now()
	)

	const expectedPages = Math.max(1, Math.ceil(run.ineligibleCount / PAGE_SIZE))
	const ineligible = new Map()
	for (let page = 1; page <= expectedPages; page += 1) {
		const rowsUrl = `${runUrl}/rows?eligible=false&page=${page}&pageSize=${PAGE_SIZE}`
		const result = await getJson(
			fetchImpl,
			rowsUrl,
			authHeaders,
			`Audit page ${page}`,
			MAX_AUDIT_RESPONSE_BYTES
		)
		const expectedRows = Math.min(PAGE_SIZE, run.ineligibleCount - (page - 1) * PAGE_SIZE)
		if (
			!result ||
			!Array.isArray(result.rows) ||
			!result.pagination ||
			result.pagination.page !== page ||
			result.pagination.pageSize !== PAGE_SIZE ||
			result.pagination.totalCount !== run.ineligibleCount ||
			result.pagination.totalPages !== expectedPages ||
			result.rows.length !== expectedRows
		) {
			throw new Error(`Audit page ${page} is incomplete or inconsistent`)
		}
		for (const row of result.rows) {
			if (
				!row ||
				!UUID_PATTERN.test(row.userId) ||
				row.eligible !== false ||
				typeof row.reason !== 'string' ||
				(row.mainCharacterName !== null && typeof row.mainCharacterName !== 'string') ||
				ineligible.has(row.userId)
			) {
				throw new Error(`Audit page ${page} contains an invalid or duplicate user`)
			}
			ineligible.set(row.userId, {
				userId: row.userId,
				mainCharacterName: row.mainCharacterName,
				reason: row.reason,
			})
		}
	}
	if (ineligible.size !== run.ineligibleCount) {
		throw new Error('Audit pages did not cover every ineligible user')
	}
	// The workflow has a defensive page ceiling. Its own counters can still be
	// internally consistent if that ceiling truncated the scan, so compare them
	// with the current core user count before calling the report complete.
	const usersResult = await getJson(
		fetchImpl,
		`${config.authBaseUrl}/api/admin/users?limit=1&offset=0`,
		authHeaders,
		'Auth user count',
		MAX_AUDIT_RESPONSE_BYTES
	)
	if (!Number.isSafeInteger(usersResult?.total) || usersResult.total !== run.scanned) {
		throw new Error('Audit did not cover the current auth-next user population')
	}

	const accountUrl = `${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts`
	const listing = await getJson(
		fetchImpl,
		accountUrl,
		controlHeaders,
		'Mumble account list',
		MAX_CONTROL_RESPONSE_BYTES
	)
	if (!listing || listing.serverId !== config.serverId || !Array.isArray(listing.accounts)) {
		throw new Error('Mumble account list is malformed or belongs to another server')
	}
	// An empty server is indistinguishable from a mistyped server ID. This audit
	// targets an existing production installation, so refuse a false clean bill.
	if (listing.accounts.length === 0) {
		throw new Error('Mumble account list is empty; verify the server ID and control database')
	}
	const accounts = new Map()
	for (const account of listing.accounts) {
		if (
			!account ||
			typeof account.subjectId !== 'string' ||
			!account.subjectId ||
			typeof account.enabled !== 'boolean' ||
			accounts.has(account.subjectId)
		) {
			throw new Error('Mumble account list contains an invalid or duplicate subject')
		}
		accounts.set(account.subjectId, account)
	}

	// A completed run should be immutable. Re-read its summary to detect a
	// replaced/mutated snapshot before emitting any operator-facing result.
	const confirmedRun = validateRun(
		await getJson(fetchImpl, runUrl, authHeaders, 'Audit run recheck', MAX_AUDIT_RESPONSE_BYTES),
		config.runId,
		now()
	)
	if (JSON.stringify(confirmedRun) !== JSON.stringify(run)) {
		throw new Error('Audit run changed while accounts were being checked')
	}

	const matches = []
	let disabled = 0
	for (const [userId, user] of ineligible) {
		const account = accounts.get(userId)
		if (!account) continue
		if (!account.enabled) {
			disabled += 1
			continue
		}
		matches.push({
			...user,
			loginName: typeof account.loginName === 'string' ? account.loginName : null,
			displayName: typeof account.displayName === 'string' ? account.displayName : null,
			lastAuthenticatedAt:
				typeof account.lastAuthenticatedAt === 'string' ? account.lastAuthenticatedAt : null,
		})
	}
	matches.sort((a, b) => a.userId.localeCompare(b.userId))
	const auditWarnings = []
	if (run.basisComparedToCount === null) {
		auditWarnings.push({
			code: 'unvalidated_bootstrap_basis',
			message:
				'No earlier audit basis is available for comparison; review the member-corporation IDs.',
		})
	}
	if (run.basisSuspect) {
		auditWarnings.push({
			code: 'basis_shrank',
			message:
				'Member-corporation basis shrank. Review the removed corporation IDs before relying on eligibility results.',
		})
	} else if (run.basisRemovedCorporationIds?.length > 0) {
		auditWarnings.push({
			code: 'member_corps_changed',
			message:
				'Member corporations left the basis even though the shrink threshold was not tripped. Review the removed corporation IDs.',
		})
	}
	if (run.blastRadiusTripped) {
		auditWarnings.push({
			code: 'blast_radius',
			message:
				'A large share of users is ineligible. Verify the basis and current eligibility before taking action.',
		})
	}
	return {
		auditRunId: run.id,
		auditCompletedAt: run.completedAt,
		mumbleCheckedAt: new Date(now()).toISOString(),
		serverId: config.serverId,
		scannedUsers: run.scanned,
		memberCorpCount: run.memberCorpCount,
		memberCorporationIds: run.memberCorporationIds,
		basisComparedToCount: run.basisComparedToCount,
		basisRemovedCorporationIds: run.basisRemovedCorporationIds,
		basisNote: run.basisNote,
		basisSuspect: run.basisSuspect,
		blastRadiusTripped: run.blastRadiusTripped,
		auditWarnings,
		ineligibleUsers: run.ineligibleCount,
		mumbleLocalAccounts: accounts.size,
		ineligibleWithEnabledMumbleAccount: matches.length,
		ineligibleWithDisabledMumbleAccount: disabled,
		ineligibleWithoutMumbleAccount: ineligible.size - matches.length - disabled,
		matches,
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		const config = await configFromEnvironment()
		const report = await runAudit(config)
		await writeReportFile(report, config.outputFile)
		for (const warning of report.auditWarnings) {
			process.stderr.write(`Audit warning [${warning.code}]: ${warning.message}\n`)
		}
		process.stdout.write(`Private report written to ${config.outputFile}\n`)
	} catch (error) {
		process.stderr.write(
			`Audit failed: ${error instanceof Error ? error.message : String(error)}\n`
		)
		process.exitCode = 1
	}
}
