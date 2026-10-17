#!/usr/bin/env node

/**
 * Separate, exact-two cleanup for the first two accounts in the reviewed
 * 84-account report. A second Services Audit and live account checks must
 * agree before a private plan can be approved. Neither mode can select the
 * other 82 candidates. Keep credentials and reports outside this repository.
 */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { configFromEnvironment, runAudit, writeReportFile } from './audit-ineligible-mumble.mjs'
import {
	apiJson,
	assertPrivateOutputPath,
	inspectCandidate,
	readPrivateJson,
} from './delete-audited-mumble.mjs'
import { validatePreviewSource } from './preview-new-mumble-candidates.mjs'

const SOURCE_SHA256 = '3ae6c37927f358ce0d266e52f418ada30adb90788dd8f55a5bc50ed4654369e6'
const PREVIEW_SHA256 = 'ee4d936f5922fabe9fc2e48d4e40d42bdfdb81bd3021f3e164fb22652c953704'
const REVIEWED_REMOVED_CORP_ID = '98648795'
const MAX_PLAN_AGE_MS = 60 * 60 * 1000
const EXPECTED_SERVER_ID = 'srv-1'
const TARGET_COUNT = 2

function assert(condition, message) {
	if (!condition) throw new Error(message)
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sameIds(left, right) {
	return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

export function validateEvidence(
	source,
	preview,
	{ expectedSourceSha256 = SOURCE_SHA256, expectedPreviewSha256 = PREVIEW_SHA256 } = {}
) {
	validatePreviewSource(source, expectedSourceSha256)
	assert(preview && typeof preview === 'object', 'Two-account preview is malformed')
	assert(
		digest(preview) === expectedPreviewSha256,
		'Two-account preview differs from the reviewed file'
	)
	assert(
		preview.kind === 'mumble-candidate-preview' &&
			preview.version === 1 &&
			preview.previewOnly === true &&
			preview.serverId === EXPECTED_SERVER_ID &&
			preview.sourceAuditRunId === source.auditRunId &&
			preview.sourceSha256 === digest(source) &&
			preview.deferredCount === source.matches.length - TARGET_COUNT &&
			Array.isArray(preview.candidates) &&
			preview.candidates.length === TARGET_COUNT,
		'Two-account preview does not match the reviewed source'
	)
	for (let index = 0; index < TARGET_COUNT; index += 1) {
		const candidate = preview.candidates[index]
		const original = source.matches[index]
		assert(
			candidate?.userId === original.userId &&
				candidate.loginName === original.loginName &&
				candidate.displayName === original.displayName &&
				candidate.status === 'currently_ineligible_with_matching_account',
			'Two-account preview contains an unverified or changed candidate'
		)
	}
}

export async function makeTwoPlan(
	config,
	source,
	preview,
	{
		fetchImpl = fetch,
		now = Date.now,
		onProgress = async () => {},
		expectedSourceSha256 = SOURCE_SHA256,
		expectedPreviewSha256 = PREVIEW_SHA256,
	} = {}
) {
	validateEvidence(source, preview, { expectedSourceSha256, expectedPreviewSha256 })
	assert(config.serverId === EXPECTED_SERVER_ID, 'Plan names another Mumble server')
	assert(config.runId !== source.auditRunId, 'Start a new Services Audit for this deletion plan')
	await onProgress('Checking the new Services Audit and current Mumble account intersection')
	const fresh = await runAudit(config, { fetchImpl, now })
	const sourceCompletedAt = Date.parse(source.auditCompletedAt)
	const previewCheckedAt = Date.parse(preview.checkedAt)
	const freshCompletedAt = Date.parse(fresh.auditCompletedAt)
	assert(
		Number.isFinite(sourceCompletedAt) &&
			Number.isFinite(previewCheckedAt) &&
			Number.isFinite(freshCompletedAt) &&
			freshCompletedAt > sourceCompletedAt &&
			freshCompletedAt >= previewCheckedAt,
		'New Services Audit must have completed after the reviewed preview'
	)
	const sameBasis = sameIds(fresh.memberCorporationIds, source.memberCorporationIds)
	const sameBaseline =
		fresh.basisComparedToCount === 36 &&
		Array.isArray(fresh.basisRemovedCorporationIds) &&
		fresh.basisRemovedCorporationIds.length === 0
	const reviewedBaseline =
		fresh.basisComparedToCount === 37 &&
		Array.isArray(fresh.basisRemovedCorporationIds) &&
		sameIds(fresh.basisRemovedCorporationIds, [REVIEWED_REMOVED_CORP_ID])
	const warningCodes = fresh.auditWarnings.map((warning) => warning.code)
	assert(
		sameBasis &&
			fresh.memberCorpCount === source.memberCorpCount &&
			fresh.basisSuspect === false &&
			fresh.basisNote === null &&
			(sameBaseline || reviewedBaseline) &&
			warningCodes.every((code) => code === 'blast_radius' || code === 'member_corps_changed') &&
			(!sameBaseline || !warningCodes.includes('member_corps_changed')) &&
			(!reviewedBaseline || warningCodes.includes('member_corps_changed')),
		'New Services Audit has a changed or unreviewed member-corporation basis'
	)
	const freshMatches = new Map(fresh.matches.map((candidate) => [candidate.userId, candidate]))
	const candidates = []
	for (const [index, original] of source.matches.slice(0, TARGET_COUNT).entries()) {
		await onProgress(`Checking candidate ${index + 1}/${TARGET_COUNT}`)
		const current = freshMatches.get(original.userId)
		assert(
			current?.reason === original.reason &&
				current.loginName === original.loginName &&
				current.displayName === original.displayName,
			`Candidate ${index + 1} left the fresh ineligible Mumble intersection`
		)
		const status = await inspectCandidate(config, original, fresh.memberCorporationIds, fetchImpl)
		assert(status === 'ready', `Candidate ${index + 1} is no longer ready: ${status}`)
		candidates.push({
			userId: original.userId,
			mainCharacterName: original.mainCharacterName,
			loginName: original.loginName,
			displayName: original.displayName,
		})
	}
	return {
		kind: 'mumble-exact-two-deletion-plan',
		version: 1,
		createdAt: new Date(now()).toISOString(),
		serverId: EXPECTED_SERVER_ID,
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		previewSha256: digest(preview),
		freshAuditRunId: fresh.auditRunId,
		freshAuditCompletedAt: fresh.auditCompletedAt,
		memberCorporationIds: [...fresh.memberCorporationIds].sort(),
		freshAuditWarnings: fresh.auditWarnings,
		candidates,
		deferredCount: source.matches.length - TARGET_COUNT,
	}
}

export function twoPlanDigest(plan) {
	return digest(plan)
}

export async function applyTwoPlan(
	config,
	source,
	preview,
	plan,
	approvalSha256,
	{
		fetchImpl = fetch,
		now = Date.now,
		onResult = async () => {},
		kickFixDeployed = false,
		expectedSourceSha256 = SOURCE_SHA256,
		expectedPreviewSha256 = PREVIEW_SHA256,
	} = {}
) {
	validateEvidence(source, preview, { expectedSourceSha256, expectedPreviewSha256 })
	assert(kickFixDeployed === true, 'Control API kick/unregister deployment must be acknowledged')
	assert(/^[0-9a-f]{64}$/.test(approvalSha256), 'Plan SHA-256 approval is required')
	assert(digest(plan) === approvalSha256, 'Plan SHA-256 approval does not match')
	assert(
		plan?.kind === 'mumble-exact-two-deletion-plan' &&
			plan.version === 1 &&
			plan.serverId === EXPECTED_SERVER_ID &&
			plan.sourceSha256 === digest(source) &&
			plan.previewSha256 === digest(preview) &&
			plan.freshAuditRunId === config.runId &&
			plan.deferredCount === source.matches.length - TARGET_COUNT &&
			Array.isArray(plan.candidates) &&
			plan.candidates.length === TARGET_COUNT &&
			plan.candidates.every(
				(candidate, index) => candidate.userId === source.matches[index].userId
			),
		'Plan does not cover exactly the reviewed two candidates'
	)
	const createdAtMs = Date.parse(plan.createdAt)
	assert(
		Number.isFinite(createdAtMs) && createdAtMs <= now() && now() - createdAtMs <= MAX_PLAN_AGE_MS,
		'Plan is older than one hour; make a new plan'
	)
	const currentPlan = await makeTwoPlan(config, source, preview, {
		fetchImpl,
		now,
		expectedSourceSha256,
		expectedPreviewSha256,
	})
	assert(
		currentPlan.freshAuditCompletedAt === plan.freshAuditCompletedAt &&
			JSON.stringify(currentPlan.memberCorporationIds) ===
				JSON.stringify(plan.memberCorporationIds) &&
			JSON.stringify(currentPlan.candidates) === JSON.stringify(plan.candidates) &&
			JSON.stringify(currentPlan.freshAuditWarnings) === JSON.stringify(plan.freshAuditWarnings),
		'Plan changed during apply preflight; make and approve a new plan'
	)
	const controlHeaders = { Authorization: `Bearer ${config.controlToken}` }
	const results = []
	for (const candidate of plan.candidates) {
		const status = await inspectCandidate(config, candidate, plan.memberCorporationIds, fetchImpl)
		if (status !== 'ready') {
			await onResult({ userId: candidate.userId, status: `stopped_${status}` })
			throw new Error(`Candidate ${candidate.userId} changed before deletion: ${status}`)
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
				`Mumble delete ${candidate.userId} returned an unexpected result; inspect the server before resuming`
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
	}
	return results
}

async function main() {
	const mode = process.argv[2]
	assert(
		mode === 'plan' || mode === 'apply',
		'Usage: delete-two-new-mumble-candidates.mjs plan|apply'
	)
	const source = await readPrivateJson(process.env.MUMBLE_TWO_SOURCE_REPORT, 'Source report')
	const preview = await readPrivateJson(process.env.MUMBLE_TWO_PREVIEW_FILE, 'Two-account preview')
	const planFile = process.env.MUMBLE_TWO_PLAN_FILE
	assert(planFile, 'MUMBLE_TWO_PLAN_FILE is required')
	const plan = mode === 'apply' ? await readPrivateJson(planFile, 'Plan') : null
	const config = await configFromEnvironment({
		...process.env,
		AUTH_NEXT_AUDIT_RUN_ID: plan?.freshAuditRunId ?? process.env.AUTH_NEXT_AUDIT_RUN_ID,
		MUMBLE_AUDIT_OUTPUT_FILE: planFile,
	})
	if (mode === 'plan') {
		const newPlan = await makeTwoPlan(config, source, preview, {
			onProgress: async (message) => process.stderr.write(`${message}\n`),
		})
		await writeReportFile(newPlan, planFile)
		process.stdout.write(`Private two-account plan written to ${planFile}\n`)
		process.stdout.write(`Approval SHA-256: ${digest(newPlan)}\n`)
		return
	}
	const approval = process.env.MUMBLE_TWO_APPROVAL_SHA256
	const kickFixDeployed = process.env.MUMBLE_CONTROL_KICK_FIX_DEPLOYED === 'YES'
	assert(kickFixDeployed, 'Set MUMBLE_CONTROL_KICK_FIX_DEPLOYED=YES after verifying deployment')
	assert(/^[0-9a-f]{64}$/.test(approval), 'MUMBLE_TWO_APPROVAL_SHA256 must be a plan SHA-256')
	const resultsFile = process.env.MUMBLE_TWO_RESULT_FILE
	await assertPrivateOutputPath(resultsFile, 'MUMBLE_TWO_RESULT_FILE')
	const handle = await open(resultsFile, 'ax', 0o600)
	try {
		await handle.appendFile(`${JSON.stringify({ planSha256: digest(plan) })}\n`)
		await handle.sync()
		process.stdout.write(`Private result log: ${resultsFile}\n`)
		let attemptedDelete = false
		let results
		try {
			results = await applyTwoPlan(config, source, preview, plan, approval, {
				kickFixDeployed,
				onResult: async (result) => {
					if (result.status === 'attempting_delete') attemptedDelete = true
					await handle.appendFile(`${JSON.stringify(result)}\n`)
					await handle.sync()
					process.stdout.write(`${result.status}: ${result.userId}\n`)
				},
			})
		} catch (error) {
			if (!attemptedDelete) {
				await handle.appendFile(`${JSON.stringify({ status: 'preflight_rejected' })}\n`)
				await handle.sync()
			}
			throw error
		}
		process.stdout.write(`Finished ${results.length} reviewed candidates.\n`)
	} finally {
		await handle.close()
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		process.stderr.write(`Two-account cleanup failed: ${error.message}\n`)
		process.exitCode = 1
	})
}
