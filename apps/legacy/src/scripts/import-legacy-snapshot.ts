import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createPool } from 'mysql2/promise'
import { sql } from '@repo/db-utils'

import { createDb } from '../db'
import {
	legacyAuthApplicationEvents,
	legacyAuthApplications,
	legacyAuthCharacters,
	legacyAuthDiscordAccounts,
	legacyAuthNotes,
	legacyAuthUserIpAddresses,
} from '../db/schema'
import { chunkRows, isLikelyIp, mapLegacyEventCode, toDateOrNullUtcCapped } from './import-legacy-snapshot.helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

type Stage = 'characters' | 'ip_addresses' | 'discord_accounts' | 'notes' | 'applications' | 'application_events' | 'all'
type ConcreteStage = Exclude<Stage, 'all'>

interface CliOptions {
	stage: Stage
	dryRun: boolean
	snapshotDir: string
	fromSnapshot: boolean
	extractOnly: boolean
	batchSize: number
	resume: boolean
	resetCursor: boolean
	pruneStale: boolean
}

interface StageResult {
	stage: ConcreteStage
	skipped: boolean
	message: string
	processed?: number
}

interface StageContext {
	legacyDatabaseUrl: string
	legacyWorkerDatabaseUrl: string
	dryRun: boolean
	snapshotDir: string
	fromSnapshot: boolean
	extractOnly: boolean
	batchSize: number
	runTimestamp: Date
	pruneStale: boolean
}

interface ImportCursorState {
	version: 1
	lastUpdatedAt: string
	runTimestamp: string
	completedStages: ConcreteStage[]
}

interface LegacyCharacterRow {
	legacy_auth_user_id: number
	character_id: number
	character_name: string
	source: 'legacy_primary' | 'esi_owner' | 'xml_account'
}
interface LegacyApplicationRow {
	legacy_application_id: number
	legacy_auth_user_id: number | null
	character_id: number | null
	character_name: string | null
	corporation_id: number | null
	corporation_name: string | null
	status: number
	application_date: Date | string | null
}
interface LegacyApplicationEventRow {
	legacy_event_id: number
	legacy_application_id: number
	legacy_auth_user_id: number | null
	event_code: number
	event_text: string
	legacy_actor_user_id: number | null
	event_date: Date | string | null
}
interface LegacyIpAddressRow {
	legacy_auth_user_id: number
	ip_address: string
	first_seen: Date | string | null
	last_seen: Date | string | null
}
interface LegacyDiscordAccountRow {
	legacy_auth_user_id: number
	discord_user_id: string
}
interface LegacyNoteRow {
	legacy_note_id: number
	legacy_auth_user_id: number
	legacy_created_by_user_id: number
	note: string
	legacy_date_created: Date | string | null
}


const CHARACTER_SOURCE_PRIORITY: Record<LegacyCharacterRow['source'], number> = {
	legacy_primary: 3,
	esi_owner: 2,
	xml_account: 1,
}

const STAGES: ConcreteStage[] = [
	'characters',
	'ip_addresses',
	'discord_accounts',
	'notes',
	'applications',
	'application_events',
]

function getArgValue(argv: string[], flag: string): string | undefined {
	const idx = argv.findIndex((arg) => arg === flag)
	if (idx === -1) return undefined
	return argv[idx + 1]
}

function parseArgs(argv: string[]): CliOptions {
	const rawStageValue = getArgValue(argv, '--stage') ?? 'all'
	const stageValue = rawStageValue.startsWith('stage=') ? rawStageValue.slice('stage='.length) : rawStageValue
	if (!['characters', 'ip_addresses', 'discord_accounts', 'notes', 'applications', 'application_events', 'all'].includes(stageValue)) {
		throw new Error(`Invalid --stage value "${rawStageValue}"`)
	}

	const dryRun = argv.includes('--dry-run')
	const apply = argv.includes('--apply')
	if (dryRun && apply) throw new Error('Choose either --dry-run or --apply, not both')
	const batchSizeRaw = getArgValue(argv, '--batch-size')
	const batchSize = batchSizeRaw ? Number(batchSizeRaw) : 100
	if (!Number.isInteger(batchSize) || batchSize <= 0) {
		throw new Error('Invalid --batch-size value. Must be a positive integer.')
	}

	return {
		stage: stageValue as Stage,
		dryRun: dryRun || !apply,
		snapshotDir: getArgValue(argv, '--snapshot-dir') ?? './tmp/legacy-snapshot',
		fromSnapshot: argv.includes('--from-snapshot'),
		extractOnly: argv.includes('--extract-only'),
		batchSize,
		resume: argv.includes('--resume'),
		resetCursor: argv.includes('--reset-cursor'),
		pruneStale: !argv.includes('--no-prune-stale'),
	}
}

function readRequiredEnv(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`${name} environment variable is required`)
	return value
}

function pathFor(ctx: StageContext, stage: ConcreteStage, kind: 'raw' | 'normalized'): string {
	return resolve(ctx.snapshotDir, `${kind}_${stage}.jsonl`)
}

function cursorPath(snapshotDir: string): string {
	return resolve(snapshotDir, '.import-cursor.json')
}

function toJsonl<T>(rows: T[]): string {
	return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

function dedupeBy<T>(rows: T[], makeKey: (row: T) => string): T[] {
	const deduped = new Map<string, T>()
	for (const row of rows) {
		deduped.set(makeKey(row), row)
	}
	return Array.from(deduped.values())
}

async function writeJsonl<T>(filePath: string, rows: T[]): Promise<void> {
	await writeFile(filePath, toJsonl(rows), 'utf8')
}

async function readImportCursor(snapshotDir: string): Promise<ImportCursorState | null> {
	try {
		const raw = await readFile(cursorPath(snapshotDir), 'utf8')
		const parsed = JSON.parse(raw) as ImportCursorState
		if (parsed.version !== 1) return null
		if (!Array.isArray(parsed.completedStages)) return null
		return parsed
	} catch {
		return null
	}
}

async function writeImportCursor(snapshotDir: string, state: ImportCursorState): Promise<void> {
	await writeFile(cursorPath(snapshotDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function createFreshCursor(runTimestamp: Date): ImportCursorState {
	return {
		version: 1,
		lastUpdatedAt: new Date().toISOString(),
		runTimestamp: runTimestamp.toISOString(),
		completedStages: [],
	}
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
	const raw = await readFile(filePath, 'utf8')
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T)
}

async function extractOrLoadRaw<T>(ctx: StageContext, stage: ConcreteStage, extract: () => Promise<T[]>): Promise<T[]> {
	const rawPath = pathFor(ctx, stage, 'raw')
	if (ctx.fromSnapshot) {
		const rows = await readJsonl<T>(rawPath)
		console.log(`[Legacy Snapshot Import][${stage}] Loaded raw snapshot rows: ${rows.length}`)
		return rows
	}
	const rows = await extract()
	await writeJsonl(rawPath, rows)
	console.log(`[Legacy Snapshot Import][${stage}] Extracted raw rows: ${rows.length}`)
	return rows
}

async function extractPrimaryCharacterRows(mysql: ReturnType<typeof createPool>): Promise<LegacyCharacterRow[]> {
	const [rowsPrimary] = await mysql.query(`
		SELECT
			ssouser.user_id AS legacy_auth_user_id,
			c.id AS character_id,
			c.name AS character_name,
			'legacy_primary' AS source
		FROM auth.sso_ssouser ssouser
		INNER JOIN auth.eve_api_eveplayercharacter c ON c.id = ssouser.primary_character_id
		WHERE ssouser.primary_character_id IS NOT NULL
	`)
	const primaryRows = rowsPrimary as LegacyCharacterRow[]
	console.log(
		`[Legacy Snapshot Import][characters] Primary character source resolved via auth.sso_ssouser.primary_character_id (${primaryRows.length} rows)`
	)
	return primaryRows
}

async function runCharactersStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][characters] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyCharacterRow>(ctx, 'characters', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const primaryRows = await extractPrimaryCharacterRows(mysql)

			const [rowsRaw] = await mysql.query(`
				SELECT c.owner_id AS legacy_auth_user_id, c.id AS character_id, c.name AS character_name, 'esi_owner' AS source
				FROM auth.eve_api_eveplayercharacter c
				WHERE c.owner_id IS NOT NULL
				UNION ALL
				SELECT ea.user_id AS legacy_auth_user_id, c.id AS character_id, c.name AS character_name, 'xml_account' AS source
				FROM auth.eve_api_eveaccount ea
				INNER JOIN auth.eve_api_eveaccount_characters eac ON eac.eveaccount_id = ea.api_user_id
				INNER JOIN auth.eve_api_eveplayercharacter c ON c.id = eac.eveplayercharacter_id
				WHERE ea.user_id IS NOT NULL AND ea.hidden = 0
			`)
			return [...primaryRows, ...(rowsRaw as LegacyCharacterRow[])]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][characters] Phase 2/3 transform')
	const normalized = rows.map((row) => ({
		legacyAuthUserId: String(row.legacy_auth_user_id),
		characterId: String(row.character_id),
		characterName: row.character_name,
		source: row.source,
	}))
	const dedupedByCharacter = new Map<string, (typeof normalized)[number]>()
	for (const row of normalized) {
		const key = `${row.legacyAuthUserId}:${row.characterId}`
		const existing = dedupedByCharacter.get(key)
		if (!existing) {
			dedupedByCharacter.set(key, row)
			continue
		}
		if (CHARACTER_SOURCE_PRIORITY[row.source] > CHARACTER_SOURCE_PRIORITY[existing.source]) {
			dedupedByCharacter.set(key, row)
		}
	}
	const deduped = [...dedupedByCharacter.values()]
	await writeJsonl(pathFor(ctx, 'characters', 'normalized'), normalized)
	console.log(
		`[Legacy Snapshot Import][characters] Normalized rows: ${normalized.length} (deduped: ${deduped.length})`
	)

	if (ctx.extractOnly)
		return { stage: 'characters', skipped: false, message: `Extracted+normalized ${deduped.length} rows` }
	if (ctx.dryRun)
		return { stage: 'characters', skipped: false, message: `Dry run; would upsert ${deduped.length}`, processed: deduped.length }

	console.log('[Legacy Snapshot Import][characters] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(deduped, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthCharacters).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthCharacters.legacyAuthUserId, legacyAuthCharacters.characterId],
			set: {
				source: sql`excluded.source`,
				characterName: sql`excluded.character_name`,
				sourceSnapshotAt: now,
				updatedAt: now,
			},
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][characters] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${deduped.length})`)
	}

	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthCharacters)
			.where(sql`${legacyAuthCharacters.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthCharacters.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][characters] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'characters', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runIpAddressesStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][ip_addresses] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyIpAddressRow>(ctx, 'ip_addresses', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const [rowsRaw] = await mysql.query(`
				SELECT user_id AS legacy_auth_user_id, ip_address, first_seen, last_seen
				FROM auth.sso_ssouseripaddress
			`)
			return rowsRaw as LegacyIpAddressRow[]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][ip_addresses] Phase 2/3 transform')
	const normalized = rows
		.map((row) => {
			const ip = row.ip_address?.trim()
			if (!ip || !isLikelyIp(ip)) return null
			const parsedFirstSeenAt = toDateOrNullUtcCapped(row.first_seen, ctx.runTimestamp)
			const parsedLastSeenAt = toDateOrNullUtcCapped(row.last_seen, ctx.runTimestamp)
			const firstSeenAt =
				parsedFirstSeenAt && parsedLastSeenAt
					? parsedFirstSeenAt.getTime() <= parsedLastSeenAt.getTime()
						? parsedFirstSeenAt
						: parsedLastSeenAt
					: (parsedFirstSeenAt ?? parsedLastSeenAt)
			const lastSeenAt =
				parsedFirstSeenAt && parsedLastSeenAt
					? parsedLastSeenAt.getTime() >= parsedFirstSeenAt.getTime()
						? parsedLastSeenAt
						: parsedFirstSeenAt
					: (parsedLastSeenAt ?? parsedFirstSeenAt)
			return {
				legacyAuthUserId: String(row.legacy_auth_user_id),
				ipAddress: ip,
				firstSeenAt,
				lastSeenAt,
			}
		})
		.filter((row): row is NonNullable<typeof row> => row !== null)

	// Aggregate duplicate legacy rows for a single user+ip pair while preserving
	// the broadest observed first/last seen window from source data.
	const aggregatedByUserIp = new Map<string, (typeof normalized)[number]>()
	for (const row of normalized) {
		const key = `${row.legacyAuthUserId}:${row.ipAddress}`
		const existing = aggregatedByUserIp.get(key)
		if (!existing) {
			aggregatedByUserIp.set(key, row)
			continue
		}

		const firstSeenAt =
			existing.firstSeenAt && row.firstSeenAt
				? existing.firstSeenAt < row.firstSeenAt
					? existing.firstSeenAt
					: row.firstSeenAt
				: existing.firstSeenAt ?? row.firstSeenAt
		const lastSeenAt =
			existing.lastSeenAt && row.lastSeenAt
				? existing.lastSeenAt > row.lastSeenAt
					? existing.lastSeenAt
					: row.lastSeenAt
				: existing.lastSeenAt ?? row.lastSeenAt

		aggregatedByUserIp.set(key, { ...existing, firstSeenAt, lastSeenAt })
	}
	const deduped = [...aggregatedByUserIp.values()]
	await writeJsonl(pathFor(ctx, 'ip_addresses', 'normalized'), normalized)
	console.log(
		`[Legacy Snapshot Import][ip_addresses] Normalized rows: ${normalized.length} (deduped: ${deduped.length})`
	)

	if (ctx.extractOnly)
		return { stage: 'ip_addresses', skipped: false, message: `Extracted+normalized ${deduped.length} rows` }
	if (ctx.dryRun)
		return { stage: 'ip_addresses', skipped: false, message: `Dry run; would upsert ${deduped.length}`, processed: deduped.length }

	console.log('[Legacy Snapshot Import][ip_addresses] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(deduped, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthUserIpAddresses).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthUserIpAddresses.legacyAuthUserId, legacyAuthUserIpAddresses.ipAddress],
			set: {
				firstSeenAt: sql`CASE
					WHEN excluded.first_seen_at IS NULL THEN ${legacyAuthUserIpAddresses.firstSeenAt}
					WHEN ${legacyAuthUserIpAddresses.firstSeenAt} IS NULL THEN excluded.first_seen_at
					ELSE LEAST(${legacyAuthUserIpAddresses.firstSeenAt}, excluded.first_seen_at)
				END`,
				lastSeenAt: sql`CASE
					WHEN excluded.last_seen_at IS NULL THEN ${legacyAuthUserIpAddresses.lastSeenAt}
					WHEN ${legacyAuthUserIpAddresses.lastSeenAt} IS NULL THEN excluded.last_seen_at
					ELSE GREATEST(${legacyAuthUserIpAddresses.lastSeenAt}, excluded.last_seen_at)
				END`,
				sourceSnapshotAt: now,
				updatedAt: now,
			},
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][ip_addresses] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${deduped.length})`)
	}
	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthUserIpAddresses)
			.where(sql`${legacyAuthUserIpAddresses.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthUserIpAddresses.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][ip_addresses] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'ip_addresses', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runDiscordAccountsStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][discord_accounts] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyDiscordAccountRow>(ctx, 'discord_accounts', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const [rowsRaw] = await mysql.query(`
				SELECT sa.user_id AS legacy_auth_user_id, sa.service_uid AS discord_user_id
				FROM auth.sso_serviceaccount sa
				INNER JOIN auth.sso_service s ON s.id = sa.service_id
				WHERE s.api = 'sso.services.discord'
				  AND sa.service_uid IS NOT NULL
				  AND sa.service_uid != ''
			`)
			return rowsRaw as LegacyDiscordAccountRow[]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][discord_accounts] Phase 2/3 transform')
	const normalized = rows.map((row) => ({
		legacyAuthUserId: String(row.legacy_auth_user_id),
		discordUserId: row.discord_user_id.trim(),
	}))
	const deduped = dedupeBy(normalized, (row) => `${row.legacyAuthUserId}:${row.discordUserId}`)
	await writeJsonl(pathFor(ctx, 'discord_accounts', 'normalized'), normalized)
	console.log(
		`[Legacy Snapshot Import][discord_accounts] Normalized rows: ${normalized.length} (deduped: ${deduped.length})`
	)

	if (ctx.extractOnly)
		return { stage: 'discord_accounts', skipped: false, message: `Extracted+normalized ${deduped.length} rows` }
	if (ctx.dryRun)
		return { stage: 'discord_accounts', skipped: false, message: `Dry run; would upsert ${deduped.length}`, processed: deduped.length }

	console.log('[Legacy Snapshot Import][discord_accounts] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(deduped, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthDiscordAccounts).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthDiscordAccounts.legacyAuthUserId, legacyAuthDiscordAccounts.discordUserId],
			set: { sourceSnapshotAt: now, updatedAt: now },
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][discord_accounts] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${deduped.length})`)
	}
	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthDiscordAccounts)
			.where(sql`${legacyAuthDiscordAccounts.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthDiscordAccounts.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][discord_accounts] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'discord_accounts', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runNotesStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][notes] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyNoteRow>(ctx, 'notes', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const [rowsRaw] = await mysql.query(`
				SELECT n.id AS legacy_note_id, n.user_id AS legacy_auth_user_id, n.created_by_id AS legacy_created_by_user_id, n.note AS note, n.date_created AS legacy_date_created
				FROM auth.sso_ssousernote n
			`)
			return rowsRaw as LegacyNoteRow[]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][notes] Phase 2/3 transform')
	const normalized = rows.map((row) => ({
		legacyNoteId: String(row.legacy_note_id),
		legacyAuthUserId: String(row.legacy_auth_user_id),
		legacyCreatedByUserId: row.legacy_created_by_user_id === null ? null : String(row.legacy_created_by_user_id),
		note: row.note,
		legacyDateCreated: toDateOrNullUtcCapped(row.legacy_date_created, ctx.runTimestamp),
		metadata: {},
	}))
	await writeJsonl(pathFor(ctx, 'notes', 'normalized'), normalized)
	console.log(`[Legacy Snapshot Import][notes] Normalized rows: ${normalized.length}`)

	if (ctx.extractOnly) return { stage: 'notes', skipped: false, message: `Extracted+normalized ${normalized.length} rows` }
	if (ctx.dryRun) return { stage: 'notes', skipped: false, message: `Dry run; would upsert ${normalized.length}`, processed: normalized.length }

	console.log('[Legacy Snapshot Import][notes] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(normalized, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthNotes).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthNotes.legacyNoteId],
			set: {
				legacyAuthUserId: sql`excluded.legacy_auth_user_id`,
				legacyCreatedByUserId: sql`excluded.legacy_created_by_user_id`,
				note: sql`excluded.note`,
				legacyDateCreated: sql`excluded.legacy_date_created`,
				sourceSnapshotAt: now,
				updatedAt: now,
			},
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][notes] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${normalized.length})`)
	}
	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthNotes)
			.where(sql`${legacyAuthNotes.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthNotes.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][notes] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'notes', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runApplicationsStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][applications] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyApplicationRow>(ctx, 'applications', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const [rowsRaw] = await mysql.query(`
				SELECT a.id AS legacy_application_id, a.user_id AS legacy_auth_user_id, a.character_id AS character_id, c.name AS character_name, a.corporation_id AS corporation_id, co.name AS corporation_name, a.status AS status, a.application_date AS application_date
				FROM auth.hr_application a
				LEFT JOIN auth.eve_api_eveplayercharacter c ON c.id = a.character_id
				LEFT JOIN auth.eve_api_eveplayercorporation co ON co.id = a.corporation_id
			`)
			return rowsRaw as LegacyApplicationRow[]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][applications] Phase 2/3 transform')
	const normalized = rows.map((row) => ({
		legacyApplicationId: String(row.legacy_application_id),
		legacyAuthUserId: row.legacy_auth_user_id === null ? null : String(row.legacy_auth_user_id),
		characterId: row.character_id === null ? null : String(row.character_id),
		characterName: row.character_name,
		corporationId: row.corporation_id === null ? null : String(row.corporation_id),
		corporationName: row.corporation_name,
		status: String(row.status),
		applicationDate: toDateOrNullUtcCapped(row.application_date, ctx.runTimestamp),
		metadata: { legacyStatusCode: row.status },
	}))
	await writeJsonl(pathFor(ctx, 'applications', 'normalized'), normalized)
	console.log(`[Legacy Snapshot Import][applications] Normalized rows: ${normalized.length}`)

	if (ctx.extractOnly) return { stage: 'applications', skipped: false, message: `Extracted+normalized ${normalized.length} rows` }
	if (ctx.dryRun) return { stage: 'applications', skipped: false, message: `Dry run; would upsert ${normalized.length}`, processed: normalized.length }

	console.log('[Legacy Snapshot Import][applications] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(normalized, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthApplications).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthApplications.legacyApplicationId],
			set: {
				legacyAuthUserId: sql`excluded.legacy_auth_user_id`,
				characterId: sql`excluded.character_id`,
				characterName: sql`excluded.character_name`,
				corporationId: sql`excluded.corporation_id`,
				corporationName: sql`excluded.corporation_name`,
				status: sql`excluded.status`,
				applicationDate: sql`excluded.application_date`,
				sourceSnapshotAt: now,
				metadata: sql`excluded.metadata`,
				updatedAt: now,
			},
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][applications] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${normalized.length})`)
	}
	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthApplications)
			.where(sql`${legacyAuthApplications.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthApplications.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][applications] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'applications', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runApplicationEventsStage(ctx: StageContext): Promise<StageResult> {
	console.log('[Legacy Snapshot Import][application_events] Phase 1/3 extract')
	const rows = await extractOrLoadRaw<LegacyApplicationEventRow>(ctx, 'application_events', async () => {
		const mysql = createPool({ uri: ctx.legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
		try {
			const [rowsRaw] = await mysql.query(`
				SELECT au.id AS legacy_event_id, au.application_id AS legacy_application_id, app.user_id AS legacy_auth_user_id, au.event AS event_code, au.text AS event_text, au.user_id AS legacy_actor_user_id, au.date AS event_date
				FROM auth.hr_audit au
				INNER JOIN auth.hr_application app ON app.id = au.application_id
			`)
			return rowsRaw as LegacyApplicationEventRow[]
		} finally {
			await mysql.end()
		}
	})

	console.log('[Legacy Snapshot Import][application_events] Phase 2/3 transform')
	const normalized = rows.map((row) => ({
		legacyEventId: String(row.legacy_event_id),
		legacyApplicationId: String(row.legacy_application_id),
		legacyAuthUserId: row.legacy_auth_user_id === null ? null : String(row.legacy_auth_user_id),
		eventType: mapLegacyEventCode(row.event_code),
		eventCode: row.event_code,
		message: row.event_text,
		legacyActorUserId: row.legacy_actor_user_id === null ? null : String(row.legacy_actor_user_id),
		eventAt: toDateOrNullUtcCapped(row.event_date, ctx.runTimestamp),
		metadata: { legacyEventCode: row.event_code },
	}))
	await writeJsonl(pathFor(ctx, 'application_events', 'normalized'), normalized)
	console.log(`[Legacy Snapshot Import][application_events] Normalized rows: ${normalized.length}`)

	if (ctx.extractOnly) return { stage: 'application_events', skipped: false, message: `Extracted+normalized ${normalized.length} rows` }
	if (ctx.dryRun) return { stage: 'application_events', skipped: false, message: `Dry run; would upsert ${normalized.length}`, processed: normalized.length }

	console.log('[Legacy Snapshot Import][application_events] Phase 3/3 load')
	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = ctx.runTimestamp
	let processed = 0
	const chunks = chunkRows(normalized, ctx.batchSize)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const chunk = chunks[idx]
		await db.insert(legacyAuthApplicationEvents).values(chunk.map((row) => ({ ...row, sourceSnapshotAt: now, updatedAt: now }))).onConflictDoUpdate({
			target: [legacyAuthApplicationEvents.legacyEventId],
			set: {
				legacyApplicationId: sql`excluded.legacy_application_id`,
				legacyAuthUserId: sql`excluded.legacy_auth_user_id`,
				eventType: sql`excluded.event_type`,
				eventCode: sql`excluded.event_code`,
				message: sql`excluded.message`,
				legacyActorUserId: sql`excluded.legacy_actor_user_id`,
				eventAt: sql`excluded.event_at`,
				sourceSnapshotAt: now,
				metadata: sql`excluded.metadata`,
				updatedAt: now,
			},
		})
		processed += chunk.length
		console.log(`[Legacy Snapshot Import][application_events] Load progress: chunk ${idx + 1}/${chunks.length} (${processed}/${normalized.length})`)
	}
	let pruned = 0
	if (ctx.pruneStale) {
		const stale = await db
			.delete(legacyAuthApplicationEvents)
			.where(sql`${legacyAuthApplicationEvents.sourceSnapshotAt} < ${now}`)
			.returning({ id: legacyAuthApplicationEvents.id })
		pruned = stale.length
		console.log(`[Legacy Snapshot Import][application_events] Pruned stale rows: ${pruned}`)
	}
	return { stage: 'application_events', skipped: false, message: `Upserted ${processed}; pruned stale ${pruned}`, processed }
}

async function runStage(stage: ConcreteStage, ctx: StageContext): Promise<StageResult> {
	switch (stage) {
		case 'characters':
			return runCharactersStage(ctx)
		case 'ip_addresses':
			return runIpAddressesStage(ctx)
		case 'discord_accounts':
			return runDiscordAccountsStage(ctx)
		case 'notes':
			return runNotesStage(ctx)
		case 'applications':
			return runApplicationsStage(ctx)
		case 'application_events':
			return runApplicationEventsStage(ctx)
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const requestedStages = options.stage === 'all' ? STAGES : [options.stage]

	const runTimestamp = new Date()
	const ctx: StageContext = {
		legacyDatabaseUrl: readRequiredEnv('LEGACY_DATABASE_URL'),
		legacyWorkerDatabaseUrl: readRequiredEnv('DATABASE_URL_MIGRATIONS'),
		dryRun: options.dryRun,
		snapshotDir: resolve(options.snapshotDir),
		fromSnapshot: options.fromSnapshot,
		extractOnly: options.extractOnly,
		batchSize: options.batchSize,
		runTimestamp,
		pruneStale: options.pruneStale,
	}

	await mkdir(ctx.snapshotDir, { recursive: true })
	let cursor = options.resetCursor ? null : await readImportCursor(ctx.snapshotDir)
	if (!cursor) cursor = createFreshCursor(runTimestamp)
	if (options.resetCursor) {
		await writeImportCursor(ctx.snapshotDir, cursor)
	}

	const stages = options.resume
		? requestedStages.filter((stage) => !cursor.completedStages.includes(stage))
		: requestedStages

	console.log('[Legacy Snapshot Import] Starting', {
		mode: options.dryRun ? 'dry-run' : 'apply',
		stagesRequested: requestedStages,
		stagesToRun: stages,
		snapshotDir: ctx.snapshotDir,
		fromSnapshot: ctx.fromSnapshot,
		extractOnly: ctx.extractOnly,
		batchSize: ctx.batchSize,
		resume: options.resume,
		resetCursor: options.resetCursor,
		pruneStale: ctx.pruneStale,
		cursorFile: cursorPath(ctx.snapshotDir),
	})
	const results: StageResult[] = []
	for (const stage of stages) {
		const result = await runStage(stage, ctx)
		results.push(result)
		console.log(`[Legacy Snapshot Import] ${stage}`, result)
		if (!ctx.dryRun && !ctx.extractOnly) {
			cursor.completedStages = [...new Set([...cursor.completedStages, stage])]
			cursor.lastUpdatedAt = new Date().toISOString()
			cursor.runTimestamp = ctx.runTimestamp.toISOString()
			await writeImportCursor(ctx.snapshotDir, cursor)
		}
	}
	console.log('[Legacy Snapshot Import] Complete', { results })
}

void main().catch((error) => {
	console.error('[Legacy Snapshot Import] Failed', error)
	process.exit(1)
})
