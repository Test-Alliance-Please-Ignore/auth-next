#!/usr/bin/env node

/**
 * One-time, allowlisted cleanup of the 57 local Mumble accounts identified by
 * audit-ineligible-mumble.mjs. The old report supplies candidates only. A new
 * Services Audit, the reviewed 37-to-36 member-corporation change, current
 * user details and current local accounts must all agree before deletion.
 *
 * Preview checks only the first two original candidates and cannot be applied.
 * Plan all 57; inspect the private JSON file; then provide its printed SHA-256
 * as MUMBLE_DELETE_APPROVAL_SHA256 in apply mode. Apply also requires an
 * explicit acknowledgement that the mumble-control kick/unregister fix is
 * deployed. Never store credentials or reports in this repository.
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { configFromEnvironment, runAudit, writeReportFile } from './audit-ineligible-mumble.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_PLAN_AGE_MS = 60 * 60 * 1000
const EXPECTED_SOURCE_CANDIDATES = 57
const ORIGINAL_REPORT_SHA256 = '94b64723666ba21e4f92dfd487314b3d0056eaee83edc5c37c4d962c556318d4'
// The operator confirmed this corporation was intentionally de-flagged after
// the original report. This one-time exception is an exact set transition.
const REVIEWED_REMOVED_CORPORATION_ID = '98648795'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function assert(condition, message) {
	if (!condition) throw new Error(message)
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sortedIds(ids) {
	return [...ids].sort((a, b) => a.localeCompare(b))
}

function sameIds(left, right) {
	return JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right))
}

export async function readPrivateJson(path, label) {
	assert(typeof path === 'string' && path.startsWith('/'), `${label} needs an absolute file path`)
	const fileStat = await stat(path)
	assert(fileStat.isFile() && (fileStat.mode & 0o077) === 0, `${label} must be mode 0600`)
	assert(fileStat.size <= MAX_RESPONSE_BYTES, `${label} is too large`)
	try {
		return JSON.parse(await readFile(path, 'utf8'))
	} catch {
		throw new Error(`${label} is not valid JSON`)
	}
}

export async function assertPrivateOutputPath(path, label) {
	assert(typeof path === 'string' && path.startsWith('/'), `${label} needs an absolute file path`)
	const parent = await realpath(dirname(path))
	const repoRoot = await realpath(REPO_ROOT)
	assert(
		parent !== repoRoot && !parent.startsWith(`${repoRoot}${sep}`),
		`${label} must be outside the auth-next repository`
	)
}

export async function apiJson(
	fetchImpl,
	url,
	headers,
	label,
	{ method = 'GET', body, allow404 = false, expectedNotFoundError = null } = {}
) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
	try {
		const response = await fetchImpl(url, {
			method,
			headers: {
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			redirect: 'error',
			signal: controller.signal,
		})
		const isExpected404 = allow404 && response.status === 404
		if (isExpected404 && expectedNotFoundError === null) return null
		assert(response.status === 200 || isExpected404, `${label} returned HTTP ${response.status}`)
		assert(
			response.headers.get('content-type')?.toLowerCase().includes('application/json'),
			`${label} did not return JSON`
		)
		const contentLength = Number(response.headers.get('content-length'))
		assert(
			!Number.isFinite(contentLength) || contentLength <= MAX_RESPONSE_BYTES,
			`${label} response is too large`
		)
		const bytes = []
		let size = 0
		assert(response.body, `${label} returned no body`)
		for await (const chunk of response.body) {
			size += chunk.byteLength
			assert(size <= MAX_RESPONSE_BYTES, `${label} response is too large`)
			bytes.push(chunk)
		}
		let data
		try {
			data = JSON.parse(Buffer.concat(bytes).toString('utf8'))
		} catch {
			throw new Error(`${label} returned invalid JSON`)
		}
		if (isExpected404) {
			assert(data?.error === expectedNotFoundError, `${label} returned an unrecognized HTTP 404`)
			return null
		}
		return data
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error
		throw new Error(
			`${label} request failed: ${error instanceof Error ? error.message : String(error)}`
		)
	} finally {
		clearTimeout(timeout)
	}
}

function validateSource(report, serverId, expectedSourceSha256) {
	assert(report && typeof report === 'object', 'Source report is malformed')
	assert(
		digest(report) === expectedSourceSha256,
		'Source report differs from the original 57-candidate report'
	)
	assert(report.serverId === serverId, 'Source report names another Mumble server')
	assert(UUID.test(report.auditRunId), 'Source report has no valid audit ID')
	assert(
		Array.isArray(report.matches) &&
			report.matches.length === EXPECTED_SOURCE_CANDIDATES &&
			report.ineligibleWithEnabledMumbleAccount === EXPECTED_SOURCE_CANDIDATES,
		`Source report must contain exactly the original ${EXPECTED_SOURCE_CANDIDATES} candidates`
	)
	assert(
		Array.isArray(report.memberCorporationIds) &&
			report.memberCorporationIds.length === report.memberCorpCount &&
			report.memberCorporationIds.every((id) => typeof id === 'string' && id.length > 0) &&
			new Set(report.memberCorporationIds).size === report.memberCorpCount &&
			report.basisSuspect === false,
		'Source report has an invalid corporation basis'
	)
	const seen = new Set()
	for (const match of report.matches) {
		assert(
			match &&
				UUID.test(match.userId) &&
				match.reason === 'unmanaged_corp' &&
				typeof match.loginName === 'string' &&
				match.loginName.length > 0 &&
				typeof match.displayName === 'string' &&
				match.displayName.length > 0 &&
				!seen.has(match.userId),
			'Source report contains an invalid or duplicate candidate'
		)
		seen.add(match.userId)
	}
}

function requestHeaders(config) {
	return {
		auth: { Cookie: config.cookie, 'X-Requested-With': 'XMLHttpRequest' },
		control: { Authorization: `Bearer ${config.controlToken}` },
	}
}

export async function inspectCandidate(
	config,
	candidate,
	memberCorporationIds,
	fetchImpl,
	{ verifiedCharacterCorporations = null } = {}
) {
	const headers = requestHeaders(config)
	const approvedMemberCorpIds = new Set(memberCorporationIds)
	const user = await apiJson(
		fetchImpl,
		`${config.authBaseUrl}/api/admin/users/${encodeURIComponent(candidate.userId)}`,
		headers.auth,
		`User ${candidate.userId}`,
		{ allow404: true }
	)
	if (!user) return 'user_missing'
	assert(
		user.id === candidate.userId &&
			typeof user.is_admin === 'boolean' &&
			Array.isArray(user.characters) &&
			user.characters.every(
				(character) =>
					character &&
					(typeof character.corporationId === 'string' || character.corporationId == null)
			),
		`User ${candidate.userId} details are malformed`
	)
	if (user.is_admin) return 'currently_eligible'
	if (verifiedCharacterCorporations !== null) {
		assert(
			verifiedCharacterCorporations instanceof Map,
			'Verified character corporations are malformed'
		)
		if (
			verifiedCharacterCorporations.size !== user.characters.length ||
			user.characters.some(
				(character) =>
					typeof character.characterId !== 'string' ||
					!verifiedCharacterCorporations.has(character.characterId) ||
					verifiedCharacterCorporations.get(character.characterId) !== character.corporationId
			)
		) {
			return 'character_affiliation_changed'
		}
	}
	// The paginated corporation list is cached for one hour. The detail route
	// reads each corporation directly from the database. For a player corp, 404
	// means no managed-corporation row exists and cannot grant membership.
	// The route deliberately hides NPC corps, so their 404 is unverifiable.
	for (const corporationId of new Set(
		user.characters.map((character) => character.corporationId)
	)) {
		if (!corporationId) continue
		// A planned member corp remains protected if its live flag changes after
		// the audit snapshot. This deletion run cannot approve a second removal.
		if (approvedMemberCorpIds.has(corporationId)) return 'member_corporation_in_approved_basis'
		assert(/^\d+$/.test(corporationId), `Corporation ${corporationId} ID is malformed`)
		const numericId = Number(corporationId)
		assert(Number.isSafeInteger(numericId), `Corporation ${corporationId} ID is malformed`)
		const corporation = await apiJson(
			fetchImpl,
			`${config.authBaseUrl}/api/corporations/${encodeURIComponent(corporationId)}`,
			headers.auth,
			`Corporation ${corporationId}`,
			{ allow404: true, expectedNotFoundError: 'Corporation not found' }
		)
		if (!corporation) {
			if (numericId >= 1_000_000 && numericId < 2_000_000) {
				if (verifiedCharacterCorporations === null) return 'npc_corporation_unverifiable'
			}
			continue
		}
		assert(
			corporation.corporationId === corporationId &&
				typeof corporation.isMemberCorporation === 'boolean',
			`Corporation ${corporationId} details are malformed`
		)
		if (corporation.isMemberCorporation) return 'currently_eligible'
	}

	const local = await apiJson(
		fetchImpl,
		`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts/${encodeURIComponent(candidate.userId)}`,
		headers.control,
		`Mumble account ${candidate.userId}`,
		{ allow404: true }
	)
	if (!local) return 'account_missing'
	assert(
		local.serverId === config.serverId && local.account,
		'Mumble account response is malformed'
	)
	const account = local.account
	assert(account.subjectId === candidate.userId, 'Mumble account subject changed')
	assert(typeof account.enabled === 'boolean', 'Mumble account enabled state is malformed')
	if (!account.enabled) return 'account_disabled'
	if (account.loginName !== candidate.loginName || account.displayName !== candidate.displayName) {
		return 'account_identity_changed'
	}
	const projection = await apiJson(
		fetchImpl,
		`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/state/users?subjectId=${encodeURIComponent(candidate.userId)}`,
		headers.control,
		`Mumble projection ${candidate.userId}`
	)
	assert(
		projection?.serverId === config.serverId && Array.isArray(projection.users),
		'Mumble projection response is malformed'
	)
	if (projection.users.length !== 1) return 'projection_missing_or_ambiguous'
	const projected = projection.users[0]
	if (
		projected.subjectId !== candidate.userId ||
		projected.loginName !== candidate.loginName ||
		!Number.isSafeInteger(projected.murmurUserId) ||
		projected.murmurUserId < 1
	) {
		return 'projection_identity_or_murmur_id_unverified'
	}
	return 'ready'
}

export async function makePlan(
	config,
	source,
	{
		fetchImpl = fetch,
		now = Date.now,
		expectedSourceSha256 = ORIGINAL_REPORT_SHA256,
		candidateLimit = EXPECTED_SOURCE_CANDIDATES,
		onProgress = async () => {},
	} = {}
) {
	validateSource(source, config.serverId, expectedSourceSha256)
	assert(config.runId !== source.auditRunId, 'Start a NEW Services Audit for the deletion plan')
	assert(
		Number.isInteger(candidateLimit) &&
			candidateLimit >= 1 &&
			candidateLimit <= EXPECTED_SOURCE_CANDIDATES,
		'Candidate limit is invalid'
	)
	await onProgress(`Checking Services Audit and Mumble account intersection`)
	const fresh = await runAudit(config, { fetchImpl, now })
	const sourceCorpIds = new Set(source.memberCorporationIds)
	const freshCorpIds = new Set(fresh.memberCorporationIds)
	const basisDiagnostic = {
		comparedToCount: fresh.basisComparedToCount,
		memberCorpCount: fresh.memberCorpCount,
		basisSuspect: fresh.basisSuspect,
		basisRemovedCorporationIds: fresh.basisRemovedCorporationIds,
		missingFromFresh: source.memberCorporationIds.filter((id) => !freshCorpIds.has(id)),
		addedInFresh: fresh.memberCorporationIds.filter((id) => !sourceCorpIds.has(id)),
		warningCodes: fresh.auditWarnings.map((warning) => warning.code),
	}
	const reviewedRemoval = [REVIEWED_REMOVED_CORPORATION_ID]
	const expectedFreshCorpIds = source.memberCorporationIds.filter(
		(id) => id !== REVIEWED_REMOVED_CORPORATION_ID
	)
	const warningCodes = fresh.auditWarnings.map((warning) => warning.code)
	assert(
		source.memberCorpCount === 37 &&
			sourceCorpIds.has(REVIEWED_REMOVED_CORPORATION_ID) &&
			fresh.basisComparedToCount === source.memberCorpCount &&
			fresh.memberCorpCount === source.memberCorpCount - 1 &&
			fresh.basisSuspect === false &&
			fresh.basisNote === null &&
			Array.isArray(fresh.basisRemovedCorporationIds) &&
			sameIds(fresh.basisRemovedCorporationIds, reviewedRemoval) &&
			sameIds(fresh.memberCorporationIds, expectedFreshCorpIds) &&
			warningCodes.filter((code) => code === 'member_corps_changed').length === 1 &&
			warningCodes.every((code) => code === 'member_corps_changed' || code === 'blast_radius'),
		`Fresh audit has an unvalidated or changed member-corporation basis: ${JSON.stringify(basisDiagnostic)}`
	)
	const freshMatches = new Map(fresh.matches.map((match) => [match.userId, match]))
	const candidates = []
	const skipped = []
	const inspected = source.matches.slice(0, candidateLimit)
	for (const [index, original] of inspected.entries()) {
		await onProgress(`Checking candidate ${index + 1}/${candidateLimit}`)
		const current = freshMatches.get(original.userId)
		if (!current) {
			skipped.push({ userId: original.userId, reason: 'not_in_fresh_intersection' })
			continue
		}
		if (
			current.reason !== original.reason ||
			current.loginName !== original.loginName ||
			current.displayName !== original.displayName
		) {
			skipped.push({ userId: original.userId, reason: 'identity_or_reason_changed' })
			continue
		}
		const status = await inspectCandidate(config, original, fresh.memberCorporationIds, fetchImpl)
		if (status === 'ready') {
			candidates.push({
				userId: original.userId,
				mainCharacterName: original.mainCharacterName,
				loginName: original.loginName,
				displayName: original.displayName,
			})
		} else {
			skipped.push({ userId: original.userId, reason: status })
		}
	}
	assert(candidates.length + skipped.length === candidateLimit, 'Plan coverage is incomplete')
	return {
		version: 2,
		previewOnly: candidateLimit < EXPECTED_SOURCE_CANDIDATES,
		deferredCount: EXPECTED_SOURCE_CANDIDATES - candidateLimit,
		createdAt: new Date(now()).toISOString(),
		serverId: config.serverId,
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		freshAuditRunId: fresh.auditRunId,
		freshAuditCompletedAt: fresh.auditCompletedAt,
		memberCorporationIds: sortedIds(fresh.memberCorporationIds),
		basisChange: {
			previousCount: source.memberCorpCount,
			currentCount: fresh.memberCorpCount,
			removedCorporationIds: reviewedRemoval,
			addedCorporationIds: [],
		},
		freshAuditWarnings: fresh.auditWarnings,
		candidates,
		skipped,
	}
}

export function approvedPlanDigest(plan) {
	return digest(plan)
}

export async function applyPlan(
	config,
	source,
	plan,
	approvalSha256,
	{
		fetchImpl = fetch,
		now = Date.now,
		onResult = async () => {},
		expectedSourceSha256 = ORIGINAL_REPORT_SHA256,
	} = {}
) {
	assert(
		plan &&
			plan.previewOnly === false &&
			plan.deferredCount === 0 &&
			Array.isArray(plan.candidates) &&
			Array.isArray(plan.skipped) &&
			plan.candidates.length + plan.skipped.length === EXPECTED_SOURCE_CANDIDATES,
		'Preview files cannot be applied'
	)
	assert(/^[0-9a-f]{64}$/.test(approvalSha256), 'A 64-character plan SHA-256 approval is required')
	assert(digest(plan) === approvalSha256, 'Plan SHA-256 approval does not match the plan file')
	assert(plan.version === 2 && plan.serverId === config.serverId, 'Plan version or server is wrong')
	assert(plan.sourceSha256 === digest(source), 'Source report changed after planning')
	assert(plan.freshAuditRunId === config.runId, 'Plan names another fresh audit run')
	const created = Date.parse(plan.createdAt)
	assert(
		Number.isFinite(created) && created <= now() && now() - created <= MAX_PLAN_AGE_MS,
		'Plan is older than one hour; make a new plan from a new Services Audit'
	)
	const currentPlan = await makePlan(config, source, { fetchImpl, now, expectedSourceSha256 })
	assert(
		currentPlan.freshAuditCompletedAt === plan.freshAuditCompletedAt &&
			JSON.stringify(currentPlan.basisChange) === JSON.stringify(plan.basisChange) &&
			JSON.stringify(currentPlan.memberCorporationIds) ===
				JSON.stringify(plan.memberCorporationIds) &&
			JSON.stringify(currentPlan.candidates) === JSON.stringify(plan.candidates) &&
			JSON.stringify(currentPlan.skipped) === JSON.stringify(plan.skipped) &&
			JSON.stringify(currentPlan.freshAuditWarnings) === JSON.stringify(plan.freshAuditWarnings),
		'Plan changed during apply preflight; make and approve a new plan'
	)
	const headers = requestHeaders(config)
	const results = []
	for (const candidate of plan.candidates) {
		// User and corporation details are direct database reads. Check again
		// immediately before this subject's irreversible request.
		const status = await inspectCandidate(config, candidate, plan.memberCorporationIds, fetchImpl)
		if (status !== 'ready') {
			const result = { userId: candidate.userId, status: `skipped_${status}` }
			results.push(result)
			await onResult(result)
			continue
		}
		await onResult({ userId: candidate.userId, status: 'attempting_delete' })
		const deleted = await apiJson(
			fetchImpl,
			`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts:delete`,
			headers.control,
			`Mumble delete ${candidate.userId}`,
			{
				method: 'POST',
				body: { subjectIds: [candidate.userId], reason: 'Voice account access ended.' },
			}
		)
		assert(
			deleted?.serverId === config.serverId &&
				Array.isArray(deleted.deletedSubjectIds) &&
				deleted.deletedSubjectIds.length === 1 &&
				deleted.deletedSubjectIds[0] === candidate.userId &&
				Number.isSafeInteger(deleted.disconnectedSessions) &&
				deleted.disconnectedSessions >= 0,
			`Mumble delete ${candidate.userId} returned an unexpected result; inspect the server before resuming`
		)
		const after = await apiJson(
			fetchImpl,
			`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts/${encodeURIComponent(candidate.userId)}`,
			headers.control,
			`Mumble post-delete account ${candidate.userId}`,
			{ allow404: true }
		)
		assert(after === null, `Mumble account ${candidate.userId} still exists after deletion`)
		const projection = await apiJson(
			fetchImpl,
			`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/state/users?subjectId=${encodeURIComponent(candidate.userId)}`,
			headers.control,
			`Mumble post-delete projection ${candidate.userId}`
		)
		assert(
			projection?.serverId === config.serverId &&
				Array.isArray(projection.users) &&
				projection.users.length === 0,
			`Mumble projection ${candidate.userId} still exists after deletion`
		)
		const result = {
			userId: candidate.userId,
			status: 'deleted_local_and_projection',
			disconnectedSessions: deleted.disconnectedSessions,
		}
		results.push(result)
		await onResult(result)
	}
	return results
}

async function main() {
	const mode = process.argv[2]
	assert(
		mode === 'preview' || mode === 'plan' || mode === 'apply',
		'Usage: delete-audited-mumble.mjs preview|plan|apply'
	)
	const planFile = process.env.MUMBLE_DELETE_PLAN_FILE
	assert(planFile, 'MUMBLE_DELETE_PLAN_FILE is required')
	const config = await configFromEnvironment({
		...process.env,
		MUMBLE_AUDIT_OUTPUT_FILE: planFile,
	})
	const source = await readPrivateJson(process.env.MUMBLE_DELETE_SOURCE_REPORT, 'Source report')
	if (mode === 'preview' || mode === 'plan') {
		const plan = await makePlan(config, source, {
			candidateLimit: mode === 'preview' ? 2 : EXPECTED_SOURCE_CANDIDATES,
			onProgress: async (message) => process.stderr.write(`${message}\n`),
		})
		await writeReportFile(plan, planFile)
		for (const warning of plan.freshAuditWarnings) {
			process.stderr.write(`Plan warning [${warning.code}]: ${warning.message}\n`)
		}
		process.stdout.write(
			`${mode === 'preview' ? 'Preview' : 'Plan'} written to ${planFile}\n` +
				`Candidates: ${plan.candidates.length}; skipped: ${plan.skipped.length}; deferred: ${plan.deferredCount}\n` +
				(mode === 'preview'
					? 'Preview cannot be applied.\n'
					: `Approval SHA-256: ${digest(plan)}\n`)
		)
		return
	}
	assert(
		process.env.MUMBLE_CONTROL_KICK_FIX_DEPLOYED === 'YES',
		'Apply requires MUMBLE_CONTROL_KICK_FIX_DEPLOYED=YES after the control API kick/unregister fix is deployed'
	)
	const plan = await readPrivateJson(planFile, 'Plan')
	const resultsFile = process.env.MUMBLE_DELETE_RESULT_FILE
	await assertPrivateOutputPath(resultsFile, 'MUMBLE_DELETE_RESULT_FILE')
	const handle = await open(resultsFile, 'ax', 0o600)
	try {
		await handle.appendFile(`${JSON.stringify({ planSha256: digest(plan) })}\n`)
		await handle.sync()
		process.stdout.write(`Private result log: ${resultsFile}\n`)
		const results = await applyPlan(
			config,
			source,
			plan,
			process.env.MUMBLE_DELETE_APPROVAL_SHA256,
			{
				onResult: async (result) => {
					await handle.appendFile(`${JSON.stringify(result)}\n`)
					await handle.sync()
					process.stdout.write(`${result.status}: ${result.userId}\n`)
				},
			}
		)
		process.stdout.write(
			`Finished ${results.length} planned candidates. Private result log: ${resultsFile}\n`
		)
	} finally {
		await handle.close()
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		await main()
	} catch (error) {
		process.stderr.write(
			`Deletion stopped: ${error instanceof Error ? error.message : String(error)}\n`
		)
		process.exitCode = 1
	}
}
