#!/usr/bin/env node

/**
 * Inspect only the first two candidates in the reviewed 84-account report.
 * This command sends GET requests only and cannot delete Mumble accounts.
 * The auth-next admin user-detail GET may refresh token-validity metadata.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { configFromEnvironment, writeReportFile } from './audit-ineligible-mumble.mjs'
import { inspectCandidate } from './delete-audited-mumble.mjs'

const SOURCE_AUDIT_RUN_ID = 'fc5a6bb4-332d-4cd7-8c48-f8f33de6b7ca'
const SOURCE_SHA256 = '3ae6c37927f358ce0d266e52f418ada30adb90788dd8f55a5bc50ed4654369e6'
const EXPECTED_SERVER_ID = 'srv-1'
const EXPECTED_CANDIDATES = 84
const EXPECTED_MEMBER_CORPS = 36
const REVIEWED_REMOVED_CORP_ID = '98648795'
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assert(condition, message) {
	if (!condition) throw new Error(message)
}

function digest(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function validatePreviewSource(source, expectedSourceSha256 = SOURCE_SHA256) {
	assert(source && typeof source === 'object', 'Preview source is malformed')
	assert(digest(source) === expectedSourceSha256, 'Preview source differs from the reviewed report')
	assert(
		source.auditRunId === SOURCE_AUDIT_RUN_ID && source.serverId === EXPECTED_SERVER_ID,
		'Preview source names another audit run or Mumble server'
	)
	assert(
		source.memberCorpCount === EXPECTED_MEMBER_CORPS &&
			Array.isArray(source.memberCorporationIds) &&
			source.memberCorporationIds.length === EXPECTED_MEMBER_CORPS &&
			source.memberCorporationIds.every((id) => typeof id === 'string' && /^\d+$/.test(id)) &&
			new Set(source.memberCorporationIds).size === EXPECTED_MEMBER_CORPS &&
			!source.memberCorporationIds.includes(REVIEWED_REMOVED_CORP_ID) &&
			source.basisComparedToCount === EXPECTED_MEMBER_CORPS + 1 &&
			Array.isArray(source.basisRemovedCorporationIds) &&
			source.basisRemovedCorporationIds.length === 1 &&
			source.basisRemovedCorporationIds[0] === REVIEWED_REMOVED_CORP_ID &&
			source.basisSuspect === false &&
			source.basisNote === null,
		'Preview source has an unreviewed member-corporation basis'
	)
	assert(
		source.ineligibleWithEnabledMumbleAccount === EXPECTED_CANDIDATES &&
			Array.isArray(source.matches) &&
			source.matches.length === EXPECTED_CANDIDATES &&
			source.matches.every(
				(match) =>
					match &&
					UUID.test(match.userId) &&
					match.reason === 'unmanaged_corp' &&
					typeof match.loginName === 'string' &&
					match.loginName.length > 0 &&
					typeof match.displayName === 'string' &&
					match.displayName.length > 0
			) &&
			new Set(source.matches.map((match) => match.userId)).size === EXPECTED_CANDIDATES,
		'Preview source does not contain the reviewed 84 candidates'
	)
	assert(
		Array.isArray(source.auditWarnings) &&
			JSON.stringify(source.auditWarnings.map((warning) => warning.code).sort()) ===
				JSON.stringify(['blast_radius', 'member_corps_changed']) &&
			source.blastRadiusTripped === true,
		'Preview source warning flags differ from the reviewed report'
	)
}

async function readPrivateSource(path) {
	assert(
		typeof path === 'string' && isAbsolute(path),
		'MUMBLE_PREVIEW_SOURCE_REPORT needs an absolute path'
	)
	const metadata = await stat(path)
	assert(
		metadata.isFile() && (metadata.mode & 0o077) === 0 && metadata.size <= MAX_SOURCE_BYTES,
		'MUMBLE_PREVIEW_SOURCE_REPORT must be a private file no larger than 2 MiB'
	)
	return JSON.parse(await readFile(path, 'utf8'))
}

export async function previewFirstTwo(
	config,
	source,
	{ fetchImpl = fetch, now = Date.now, expectedSourceSha256 = SOURCE_SHA256 } = {}
) {
	validatePreviewSource(source, expectedSourceSha256)
	assert(config.serverId === EXPECTED_SERVER_ID, 'Preview config names another Mumble server')
	const getOnlyFetch = (url, request) => {
		assert(request?.method === 'GET', 'Preview attempted a non-GET request')
		return fetchImpl(url, request)
	}
	const candidates = []
	for (const candidate of source.matches.slice(0, 2)) {
		const status = await inspectCandidate(
			config,
			candidate,
			source.memberCorporationIds,
			getOnlyFetch
		)
		candidates.push({
			userId: candidate.userId,
			mainCharacterName: candidate.mainCharacterName,
			loginName: candidate.loginName,
			displayName: candidate.displayName,
			status: status === 'ready' ? 'currently_ineligible_with_matching_account' : status,
		})
	}
	return {
		kind: 'mumble-candidate-preview',
		version: 1,
		previewOnly: true,
		checkedAt: new Date(now()).toISOString(),
		serverId: EXPECTED_SERVER_ID,
		sourceAuditRunId: source.auditRunId,
		sourceSha256: digest(source),
		memberCorpCount: source.memberCorpCount,
		basisRemovedCorporationIds: source.basisRemovedCorporationIds,
		auditWarnings: source.auditWarnings,
		candidates,
		deferredCount: EXPECTED_CANDIDATES - candidates.length,
	}
}

async function main() {
	const source = await readPrivateSource(process.env.MUMBLE_PREVIEW_SOURCE_REPORT)
	validatePreviewSource(source)
	const config = await configFromEnvironment({
		...process.env,
		AUTH_NEXT_AUDIT_RUN_ID: SOURCE_AUDIT_RUN_ID,
		MUMBLE_AUDIT_OUTPUT_FILE: process.env.MUMBLE_PREVIEW_OUTPUT_FILE,
	})
	const preview = await previewFirstTwo(config, source)
	await writeReportFile(preview, config.outputFile)
	process.stdout.write(`Private preview written to ${config.outputFile}\n`)
	process.stdout.write('Checked 2 candidates; 82 deferred. No Mumble accounts were changed.\n')
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((error) => {
		process.stderr.write(`Preview failed: ${error.message}\n`)
		process.exitCode = 1
	})
}
