#!/usr/bin/env node

/**
 * One-time cleanup of source.matches[2..83] in the reviewed 84-account report.
 * The first two require a pinned successful result log. A new Services Audit,
 * live auth-next details, public ESI affiliation, and the current Mumble state
 * are checked before planning and again before each single-account deletion.
 */
import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { configFromEnvironment, runAudit, writeReportFile } from './audit-ineligible-mumble.mjs'
import {
	apiJson,
	assertPrivateOutputPath,
	inspectCandidate,
	readPrivateJson,
} from './delete-audited-mumble.mjs'
import { validateEvidence } from './delete-two-new-mumble-candidates.mjs'

const SOURCE_SHA256 = '3ae6c37927f358ce0d266e52f418ada30adb90788dd8f55a5bc50ed4654369e6'
const PREVIEW_SHA256 = 'ee4d936f5922fabe9fc2e48d4e40d42bdfdb81bd3021f3e164fb22652c953704'
const TWO_PLAN_SHA256 = 'a163fbf24f8034a4660c3a362d4c882abba1f4f7f9363a271af750457fac042d'
const TWO_RESULT_SHA256 = 'cf730a8dbc1ef7daf8ba13de4c08166fe4fcb86ff1cc190782a03bf1c0c2ee5a'
const REMAINING_IDS_SHA256 = 'c938f10ad4162473284d6e57f45c96958873ecdd5172f3159a2ca33c7d33a3f9'
const REVIEWED_REMOVED_CORP_ID = '98648795'
const ESI_AFFILIATION_URL =
	'https://esi.evetech.net/latest/characters/affiliation/?datasource=tranquility'
const MAX_PLAN_AGE_MS = 60 * 60 * 1000
const EXPECTED_SERVER_ID = 'srv-1'
const TARGET_COUNT = 82
const READ_CONCURRENCY = 4

function assert(condition, message) {
	if (!condition) throw new Error(message)
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sameIds(left, right) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

async function readTwoResultLog(path) {
	assert(
		typeof path === 'string' && path.startsWith('/'),
		'Two-account result needs an absolute path'
	)
	const metadata = await stat(path)
	assert(
		metadata.isFile() && (metadata.mode & 0o077) === 0 && metadata.size <= 1024 * 1024,
		'Two-account result must be a private file no larger than 1 MiB'
	)
	const raw = await readFile(path, 'utf8')
	const records = raw
		.trimEnd()
		.split('\n')
		.map((line) => JSON.parse(line))
	return {
		rawSha256: createHash('sha256').update(raw).digest('hex'),
		modifiedAt: metadata.mtime.toISOString(),
		records,
	}
}

export function validateRemainingEvidence(
	source,
	preview,
	twoPlan,
	twoResult,
	{
		expectedSourceSha256 = SOURCE_SHA256,
		expectedPreviewSha256 = PREVIEW_SHA256,
		expectedTwoPlanSha256 = TWO_PLAN_SHA256,
		expectedTwoResultSha256 = TWO_RESULT_SHA256,
		expectedRemainingIdsSha256 = REMAINING_IDS_SHA256,
	} = {}
) {
	validateEvidence(source, preview, { expectedSourceSha256, expectedPreviewSha256 })
	assert(digest(twoPlan) === expectedTwoPlanSha256, 'First-two plan differs from the reviewed plan')
	assert(
		twoPlan.kind === 'mumble-exact-two-deletion-plan' &&
			twoPlan.serverId === EXPECTED_SERVER_ID &&
			twoPlan.sourceSha256 === digest(source) &&
			twoPlan.previewSha256 === digest(preview) &&
			Array.isArray(twoPlan.candidates) &&
			twoPlan.candidates.length === 2 &&
			twoPlan.candidates.every(
				(candidate, index) => candidate.userId === source.matches[index].userId
			),
		'First-two plan does not cover exactly the first two source accounts'
	)
	assert(twoResult.rawSha256 === expectedTwoResultSha256, 'First-two result log changed')
	const records = twoResult.records
	assert(Array.isArray(records) && records.length === 5, 'First-two result log is incomplete')
	assert(records[0]?.planSha256 === digest(twoPlan), 'First-two result names another plan')
	for (let index = 0; index < 2; index += 1) {
		const userId = source.matches[index].userId
		assert(
			records[index * 2 + 1]?.status === 'attempting_delete' &&
				records[index * 2 + 1]?.userId === userId &&
				records[index * 2 + 2]?.status === 'deleted_local_and_projection' &&
				records[index * 2 + 2]?.userId === userId &&
				Number.isSafeInteger(records[index * 2 + 2]?.disconnectedSessions) &&
				records[index * 2 + 2].disconnectedSessions >= 0,
			`First-two result does not verify source candidate ${index + 1}`
		)
	}
	assert(
		Number.isFinite(Date.parse(twoResult.modifiedAt)),
		'First-two result has no valid completion time'
	)
	const remainingIds = source.matches.slice(2).map((candidate) => candidate.userId)
	assert(
		remainingIds.length === TARGET_COUNT && digest(remainingIds) === expectedRemainingIdsSha256,
		'Remaining scope differs from the reviewed 82 users'
	)
}

function assertFreshBasis(fresh, source, twoPlan, twoResult) {
	const completedAt = Date.parse(fresh.auditCompletedAt)
	assert(
		fresh.auditRunId !== source.auditRunId &&
			fresh.auditRunId !== twoPlan.freshAuditRunId &&
			Number.isFinite(completedAt) &&
			completedAt > Date.parse(twoResult.modifiedAt),
		'Start a NEW Services Audit after the first two deletions'
	)
	const warningCodes = fresh.auditWarnings.map((warning) => warning.code)
	const sameBaseline =
		fresh.basisComparedToCount === 36 &&
		Array.isArray(fresh.basisRemovedCorporationIds) &&
		fresh.basisRemovedCorporationIds.length === 0
	const reviewedBaseline =
		fresh.basisComparedToCount === 37 &&
		Array.isArray(fresh.basisRemovedCorporationIds) &&
		sameIds(fresh.basisRemovedCorporationIds, [REVIEWED_REMOVED_CORP_ID])
	assert(
		sameIds(fresh.memberCorporationIds, source.memberCorporationIds) &&
			fresh.memberCorpCount === 36 &&
			fresh.basisSuspect === false &&
			fresh.basisNote === null &&
			(sameBaseline || reviewedBaseline) &&
			warningCodes.every((code) => code === 'blast_radius' || code === 'member_corps_changed') &&
			(!sameBaseline || !warningCodes.includes('member_corps_changed')) &&
			(!reviewedBaseline || warningCodes.includes('member_corps_changed')),
		'New Services Audit has a changed or unreviewed member-corporation basis'
	)
	const freshIds = new Set(fresh.matches.map((candidate) => candidate.userId))
	assert(
		source.matches.slice(0, 2).every((candidate) => !freshIds.has(candidate.userId)),
		'One of the first two deleted accounts reappeared in the fresh intersection'
	)
}

async function checkLiveAffiliation(config, candidate, memberCorporationIds, fetchImpl) {
	const user = await apiJson(
		fetchImpl,
		`${config.authBaseUrl}/api/admin/users/${encodeURIComponent(candidate.userId)}`,
		{ Cookie: config.cookie, 'X-Requested-With': 'XMLHttpRequest' },
		`Live-affiliation user ${candidate.userId}`,
		{ allow404: true }
	)
	if (!user) return { status: 'user_missing' }
	assert(
		user.id === candidate.userId &&
			typeof user.is_admin === 'boolean' &&
			Array.isArray(user.characters),
		`Live-affiliation user ${candidate.userId} details are malformed`
	)
	if (user.is_admin) return { status: 'currently_eligible' }
	if (user.characters.length === 0) return { status: 'no_characters_to_verify' }
	const ids = user.characters.map((character) => {
		assert(
			character &&
				typeof character.characterId === 'string' &&
				/^\d+$/.test(character.characterId) &&
				Number.isSafeInteger(Number(character.characterId)) &&
				(typeof character.corporationId === 'string' || character.corporationId == null),
			`Live-affiliation user ${candidate.userId} has invalid character details`
		)
		return character.characterId
	})
	assert(
		new Set(ids).size === ids.length,
		`Live-affiliation user ${candidate.userId} has duplicate characters`
	)
	const affiliations = await apiJson(
		fetchImpl,
		ESI_AFFILIATION_URL,
		{},
		`ESI affiliation ${candidate.userId}`,
		{ method: 'POST', body: ids.map(Number) }
	)
	assert(Array.isArray(affiliations), `ESI affiliation ${candidate.userId} is malformed`)
	const byId = new Map()
	for (const affiliation of affiliations) {
		assert(
			affiliation &&
				Number.isSafeInteger(affiliation.character_id) &&
				affiliation.character_id > 0 &&
				Number.isSafeInteger(affiliation.corporation_id) &&
				affiliation.corporation_id > 0 &&
				!byId.has(String(affiliation.character_id)),
			`ESI affiliation ${candidate.userId} contains invalid or duplicate rows`
		)
		byId.set(String(affiliation.character_id), String(affiliation.corporation_id))
	}
	if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
		return { status: 'esi_affiliation_incomplete' }
	}
	const members = new Set(memberCorporationIds)
	for (const character of user.characters) {
		const liveCorpId = byId.get(character.characterId)
		if (members.has(liveCorpId)) return { status: 'live_member_corporation' }
		if (character.corporationId !== liveCorpId) return { status: 'affiliation_drift' }
	}
	return { status: 'ready', verifiedCharacterCorporations: byId }
}

async function inspectReadyCandidate(config, candidate, memberCorporationIds, fetchImpl) {
	const live = await checkLiveAffiliation(config, candidate, memberCorporationIds, fetchImpl)
	if (live.status !== 'ready') return live.status
	// The auth-next corporation detail route deliberately returns 404 for NPC
	// corporations. Compare every character against the ESI snapshot when the
	// final inspector re-reads auth-next, including for player corporations.
	return inspectCandidate(config, candidate, memberCorporationIds, fetchImpl, {
		verifiedCharacterCorporations: live.verifiedCharacterCorporations,
	})
}

async function mapWithConcurrency(items, limit, worker) {
	const results = new Array(items.length)
	let nextIndex = 0
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (nextIndex < items.length) {
				const index = nextIndex++
				results[index] = await worker(items[index], index)
			}
		})
	)
	return results
}

export async function makeRemainingPlan(
	config,
	source,
	preview,
	twoPlan,
	twoResult,
	{ fetchImpl = fetch, now = Date.now, onProgress = async () => {}, ...pins } = {}
) {
	validateRemainingEvidence(source, preview, twoPlan, twoResult, pins)
	assert(config.serverId === EXPECTED_SERVER_ID, 'Plan names another Mumble server')
	await onProgress('Checking new Services Audit and current Mumble account intersection')
	const fresh = await runAudit(config, { fetchImpl, now })
	assertFreshBasis(fresh, source, twoPlan, twoResult)
	const freshMatches = new Map(fresh.matches.map((candidate) => [candidate.userId, candidate]))
	let completed = 0
	const entries = await mapWithConcurrency(
		source.matches.slice(2),
		READ_CONCURRENCY,
		async (original) => {
			const current = freshMatches.get(original.userId)
			let status
			if (!current) status = 'not_in_fresh_intersection'
			else if (
				current.reason !== original.reason ||
				current.loginName !== original.loginName ||
				current.displayName !== original.displayName
			)
				status = 'identity_or_reason_changed'
			else
				status = await inspectReadyCandidate(
					config,
					original,
					fresh.memberCorporationIds,
					fetchImpl
				)
			completed += 1
			await onProgress(`Checked ${completed}/${TARGET_COUNT}: ${status}`)
			return status === 'ready'
				? {
						kind: 'ready',
						candidate: {
							userId: original.userId,
							mainCharacterName: original.mainCharacterName,
							loginName: original.loginName,
							displayName: original.displayName,
						},
					}
				: { kind: 'skipped', userId: original.userId, reason: status }
		}
	)
	return {
		kind: 'mumble-remaining-82-deletion-plan',
		version: 2,
		createdAt: new Date(now()).toISOString(),
		serverId: EXPECTED_SERVER_ID,
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		previewSha256: digest(preview),
		firstTwoPlanSha256: digest(twoPlan),
		firstTwoResultSha256: twoResult.rawSha256,
		firstTwoResultModifiedAt: twoResult.modifiedAt,
		freshAuditRunId: fresh.auditRunId,
		freshAuditCompletedAt: fresh.auditCompletedAt,
		memberCorporationIds: [...fresh.memberCorporationIds].sort(),
		freshAuditWarnings: fresh.auditWarnings,
		targetCount: TARGET_COUNT,
		candidates: entries.filter((entry) => entry.kind === 'ready').map((entry) => entry.candidate),
		skipped: entries
			.filter((entry) => entry.kind === 'skipped')
			.map(({ userId, reason }) => ({ userId, reason })),
		unrelatedFreshMatches: fresh.matches.filter(
			(candidate) => !source.matches.some((original) => original.userId === candidate.userId)
		).length,
	}
}

export function remainingPlanDigest(plan) {
	return digest(plan)
}

function assertPlanScope(plan, source, preview, twoPlan, twoResult, config) {
	assert(
		plan?.kind === 'mumble-remaining-82-deletion-plan' &&
			plan.version === 2 &&
			plan.serverId === EXPECTED_SERVER_ID &&
			plan.serverId === config.serverId &&
			plan.sourceSha256 === digest(source) &&
			plan.previewSha256 === digest(preview) &&
			plan.firstTwoPlanSha256 === digest(twoPlan) &&
			plan.firstTwoResultSha256 === twoResult.rawSha256 &&
			plan.firstTwoResultModifiedAt === twoResult.modifiedAt &&
			plan.freshAuditRunId === config.runId &&
			plan.targetCount === TARGET_COUNT &&
			Array.isArray(plan.candidates) &&
			Array.isArray(plan.skipped) &&
			plan.candidates.length + plan.skipped.length === TARGET_COUNT,
		'Plan does not cover exactly the reviewed 82 candidates'
	)
	const sourceById = new Map(
		source.matches.slice(2).map((candidate) => [candidate.userId, candidate])
	)
	const planIds = [
		...plan.candidates.map((candidate) => candidate.userId),
		...plan.skipped.map((item) => item.userId),
	]
	assert(
		planIds.length === new Set(planIds).size && sameIds(planIds, [...sourceById.keys()]),
		'Plan includes an unexpected or duplicate subject'
	)
	for (const candidate of plan.candidates) {
		const original = sourceById.get(candidate.userId)
		assert(
			candidate.mainCharacterName === original.mainCharacterName &&
				candidate.loginName === original.loginName &&
				candidate.displayName === original.displayName,
			'Plan candidate identity changed'
		)
	}
}

export async function applyRemainingPlan(
	config,
	source,
	preview,
	twoPlan,
	twoResult,
	plan,
	approvalSha256,
	{
		fetchImpl = fetch,
		now = Date.now,
		onResult = async () => {},
		onProgress = async () => {},
		kickFixDeployed = false,
		authFixDeployed = false,
		pauseBetweenDeletesMs = 0,
		...pins
	} = {}
) {
	validateRemainingEvidence(source, preview, twoPlan, twoResult, pins)
	assert(kickFixDeployed && authFixDeployed, 'Both control and auth-next fixes must be deployed')
	assert(/^[0-9a-f]{64}$/.test(approvalSha256), 'Plan SHA-256 approval is required')
	assert(digest(plan) === approvalSha256, 'Plan SHA-256 approval does not match')
	assertPlanScope(plan, source, preview, twoPlan, twoResult, config)
	const createdAtMs = Date.parse(plan.createdAt)
	assert(
		Number.isFinite(createdAtMs) && createdAtMs <= now() && now() - createdAtMs <= MAX_PLAN_AGE_MS,
		'Plan is older than one hour; make a new plan'
	)
	const currentPlan = await makeRemainingPlan(config, source, preview, twoPlan, twoResult, {
		fetchImpl,
		now,
		onProgress,
		...pins,
	})
	for (const field of [
		'freshAuditCompletedAt',
		'memberCorporationIds',
		'freshAuditWarnings',
		'candidates',
		'skipped',
		'unrelatedFreshMatches',
	]) {
		assert(
			JSON.stringify(currentPlan[field]) === JSON.stringify(plan[field]),
			`Plan ${field} changed during apply preflight; make a new plan`
		)
	}
	const results = []
	const controlHeaders = { Authorization: `Bearer ${config.controlToken}` }
	for (const [index, candidate] of plan.candidates.entries()) {
		assert(now() - createdAtMs <= MAX_PLAN_AGE_MS, 'Plan expired during apply; make a new plan')
		await onResult({
			userId: candidate.userId,
			status: 'checking',
			index: index + 1,
			total: plan.candidates.length,
		})
		const status = await inspectReadyCandidate(
			config,
			candidate,
			plan.memberCorporationIds,
			fetchImpl
		)
		if (status !== 'ready') {
			const result = { userId: candidate.userId, status: `skipped_${status}` }
			results.push(result)
			await onResult(result)
			continue
		}
		await onResult({ userId: candidate.userId, status: 'attempting_delete' })
		let deletionAccepted = false
		let result
		try {
			const deleted = await apiJson(
				fetchImpl,
				`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts:delete`,
				controlHeaders,
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
				`Mumble delete ${candidate.userId} returned an unexpected result`
			)
			deletionAccepted = true
			const after = await apiJson(
				fetchImpl,
				`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/local-accounts/${encodeURIComponent(candidate.userId)}`,
				controlHeaders,
				`Mumble post-delete account ${candidate.userId}`,
				{ allow404: true }
			)
			assert(after === null, `Mumble account ${candidate.userId} still exists after deletion`)
			const projection = await apiJson(
				fetchImpl,
				`${config.controlBaseUrl}/v1/servers/${encodeURIComponent(config.serverId)}/state/users?subjectId=${encodeURIComponent(candidate.userId)}`,
				controlHeaders,
				`Mumble post-delete projection ${candidate.userId}`
			)
			assert(
				projection?.serverId === config.serverId &&
					Array.isArray(projection.users) &&
					projection.users.length === 0,
				`Mumble projection ${candidate.userId} still exists after deletion`
			)
			result = {
				userId: candidate.userId,
				status: 'deleted_local_and_projection',
				disconnectedSessions: deleted.disconnectedSessions,
			}
		} catch (error) {
			await onResult({
				userId: candidate.userId,
				status: deletionAccepted ? 'verification_failed' : 'outcome_unknown',
			})
			throw error
		}
		results.push(result)
		await onResult(result)
		if (pauseBetweenDeletesMs > 0 && index + 1 < plan.candidates.length) {
			await delay(pauseBetweenDeletesMs)
		}
	}
	return results
}

async function main() {
	const mode = process.argv[2]
	assert(
		mode === 'plan' || mode === 'apply',
		'Usage: delete-remaining-mumble-candidates.mjs plan|apply'
	)
	const source = await readPrivateJson(process.env.MUMBLE_REMAINING_SOURCE_REPORT, 'Source report')
	const preview = await readPrivateJson(
		process.env.MUMBLE_REMAINING_PREVIEW_FILE,
		'First-two preview'
	)
	const twoPlan = await readPrivateJson(
		process.env.MUMBLE_REMAINING_TWO_PLAN_FILE,
		'First-two plan'
	)
	const twoResult = await readTwoResultLog(process.env.MUMBLE_REMAINING_TWO_RESULT_FILE)
	const planFile = process.env.MUMBLE_REMAINING_PLAN_FILE
	assert(planFile, 'MUMBLE_REMAINING_PLAN_FILE is required')
	const plan = mode === 'apply' ? await readPrivateJson(planFile, 'Remaining plan') : null
	const config = await configFromEnvironment({
		...process.env,
		AUTH_NEXT_AUDIT_RUN_ID: plan?.freshAuditRunId ?? process.env.AUTH_NEXT_AUDIT_RUN_ID,
		MUMBLE_AUDIT_OUTPUT_FILE: planFile,
	})
	if (mode === 'plan') {
		const newPlan = await makeRemainingPlan(config, source, preview, twoPlan, twoResult, {
			onProgress: async (message) => process.stderr.write(`${message}\n`),
		})
		await writeReportFile(newPlan, planFile)
		process.stdout.write(`Private remaining-82 plan written to ${planFile}\n`)
		process.stdout.write(
			`Ready: ${newPlan.candidates.length}; skipped: ${newPlan.skipped.length}; unrelated new matches: ${newPlan.unrelatedFreshMatches}\n`
		)
		process.stdout.write(`Approval SHA-256: ${digest(newPlan)}\n`)
		return
	}
	assert(
		process.env.MUMBLE_CONTROL_KICK_FIX_DEPLOYED === 'YES',
		'Control kick fix deployment must be acknowledged'
	)
	assert(
		process.env.AUTH_NEXT_OFFBOARDING_FIX_DEPLOYED === 'YES',
		'auth-next offboarding fix deployment must be acknowledged'
	)
	const approval = process.env.MUMBLE_REMAINING_APPROVAL_SHA256
	assert(/^[0-9a-f]{64}$/.test(approval), 'MUMBLE_REMAINING_APPROVAL_SHA256 must be a plan SHA-256')
	const resultsFile = process.env.MUMBLE_REMAINING_RESULT_FILE
	await assertPrivateOutputPath(resultsFile, 'MUMBLE_REMAINING_RESULT_FILE')
	const handle = await open(resultsFile, 'ax', 0o600)
	try {
		await handle.appendFile(
			`${JSON.stringify({ planSha256: digest(plan), targetCount: TARGET_COUNT })}\n`
		)
		await handle.sync()
		process.stdout.write(`Private remaining-82 result log: ${resultsFile}\n`)
		let attemptedDelete = false
		let results
		try {
			results = await applyRemainingPlan(
				config,
				source,
				preview,
				twoPlan,
				twoResult,
				plan,
				approval,
				{
					kickFixDeployed: true,
					authFixDeployed: true,
					pauseBetweenDeletesMs: 250,
					onProgress: async (message) => process.stderr.write(`${message}\n`),
					onResult: async (result) => {
						if (result.status === 'attempting_delete') attemptedDelete = true
						await handle.appendFile(`${JSON.stringify(result)}\n`)
						await handle.sync()
						process.stdout.write(`${result.status}: ${result.userId ?? ''}\n`)
					},
				}
			)
		} catch (error) {
			if (!attemptedDelete) {
				await handle.appendFile(`${JSON.stringify({ status: 'preflight_rejected' })}\n`)
				await handle.sync()
			}
			throw error
		}
		process.stdout.write(`Finished ${results.length} ready candidates.\n`)
	} finally {
		await handle.close()
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		process.stderr.write(`Remaining-82 cleanup failed: ${error.message}\n`)
		process.exitCode = 1
	})
}
