import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'
import { createPool } from 'mysql2/promise'

import { and, eq, inArray } from '@repo/db-utils'

import { createDb } from '../db'
import { blacklistEntries } from '../db/schema'

import type { BlacklistTargetType } from '@repo/hr'
import type { QueryablePool, RowDataPacket } from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

type Mode = 'dry-run' | 'apply'
type LegacyType = 0 | 1 | 2 | 3 | 4 | 6

interface CliOptions {
	mode: Mode
	exportPath?: string
	fromNormalized?: string
	resume: boolean
	resetCursor: boolean
}

interface LegacyBlacklistRow extends RowDataPacket {
	legacy_blacklist_id: number
	legacy_type: number
	legacy_value: string
	legacy_level: string | number | null
	reason: string | null
	created_date: Date | string | null
	expiry_date: Date | string | null
	source_id: number | null
	source_name: string | null
}

interface LegacyCharacterRow extends RowDataPacket {
	character_id: number
	character_name: string
}

interface ExtractedSnapshot {
	rows: LegacyBlacklistRow[]
}

interface NormalizedEntry {
	targetType: BlacklistTargetType
	targetValue: string
	reason: string
	createdAt: string
	metadata: Record<string, unknown>
	legacyBlacklistId: number
}

interface ResolvedRowArtifact {
	legacyBlacklistId: number
	legacyType: number
	legacyValue: string
	entries: Array<Pick<NormalizedEntry, 'targetType' | 'targetValue'>>
	resolutionMethod: string
}

interface UnresolvedRowArtifact {
	legacyBlacklistId: number
	legacyType: number
	legacyValue: string
	reason: string
}

interface SkippedExistingArtifact {
	legacyBlacklistId: number
	targetType: BlacklistTargetType
	targetValue: string
}

interface TransformOutput {
	normalizedEntries: NormalizedEntry[]
	resolvedArtifacts: ResolvedRowArtifact[]
	unresolvedArtifacts: UnresolvedRowArtifact[]
}

interface Summary {
	scanned: number
	filteredByType: number
	filteredByLevel: number
	resolvedRows: number
	unresolvedRows: number
	normalizedEntries: number
	insertedEntries: number
	skippedExistingEntries: number
}

interface ImportCursorState {
	version: 1
	lastUpdatedAt: string
	mode: Mode
	phases: {
		extract: boolean
		transform: boolean
		load: boolean
	}
	paths: {
		raw: string
		normalized: string
		resolved: string
		unresolved: string
		skippedExisting: string
		summary: string
	}
}

function parseArgs(argv: string[]): CliOptions {
	const hasApply = argv.includes('--apply')
	const hasDryRun = argv.includes('--dry-run')
	if (hasApply && hasDryRun) throw new Error('Choose either --apply or --dry-run, not both')

	const exportIdx = argv.findIndex((arg) => arg === '--export')
	const exportPath = exportIdx >= 0 ? argv[exportIdx + 1] : undefined
	if (exportIdx >= 0 && !exportPath) throw new Error('--export requires a path')
	const fromNormalizedIdx = argv.findIndex((arg) => arg === '--from-normalized')
	const fromNormalized = fromNormalizedIdx >= 0 ? argv[fromNormalizedIdx + 1] : undefined
	if (fromNormalizedIdx >= 0 && !fromNormalized) throw new Error('--from-normalized requires a path')

	return {
		mode: hasApply ? 'apply' : 'dry-run',
		exportPath,
		fromNormalized,
		resume: argv.includes('--resume'),
		resetCursor: argv.includes('--reset-cursor'),
	}
}

function readRequiredEnv(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`${name} environment variable is required`)
	return value
}

function parseLegacyLevels(): Set<string> {
	const raw = process.env.LEGACY_BLACKLIST_LEVELS?.trim() || '0'
	return new Set(
		raw
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	)
}

function isSupportedLegacyType(value: number): value is LegacyType {
	return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 6
}

function normalizeCharacterName(name: string): string {
	return name.trim().toLowerCase()
}

function dedupeEntries(entries: NormalizedEntry[]): NormalizedEntry[] {
	const map = new Map<string, NormalizedEntry>()
	for (const entry of entries) map.set(`${entry.targetType}:${entry.targetValue}`, entry)
	return [...map.values()]
}

function toJsonl<T>(rows: T[]): string {
	return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

function toChunks<T>(rows: T[], size: number): T[][] {
	const result: T[][] = []
	for (let idx = 0; idx < rows.length; idx += size) result.push(rows.slice(idx, idx + size))
	return result
}

function cursorPath(outDir: string): string {
	return resolve(outDir, '.import-cursor.json')
}

function buildArtifactPaths(outDir: string) {
	return {
		raw: resolve(outDir, 'raw_blacklists.jsonl'),
		normalized: resolve(outDir, 'normalized_blacklists.jsonl'),
		resolved: resolve(outDir, 'resolved.jsonl'),
		unresolved: resolve(outDir, 'unresolved.jsonl'),
		skippedExisting: resolve(outDir, 'skipped_existing.jsonl'),
		summary: resolve(outDir, 'summary.json'),
	}
}

function freshCursor(mode: Mode, outDir: string): ImportCursorState {
	return {
		version: 1,
		lastUpdatedAt: new Date().toISOString(),
		mode,
		phases: {
			extract: false,
			transform: false,
			load: false,
		},
		paths: buildArtifactPaths(outDir),
	}
}

async function readCursor(outDir: string): Promise<ImportCursorState | null> {
	try {
		const raw = await readFile(cursorPath(outDir), 'utf8')
		const parsed = JSON.parse(raw) as ImportCursorState
		if (parsed.version !== 1) return null
		return parsed
	} catch {
		return null
	}
}

async function writeCursor(outDir: string, cursor: ImportCursorState): Promise<void> {
	cursor.lastUpdatedAt = new Date().toISOString()
	await writeFile(cursorPath(outDir), `${JSON.stringify(cursor, null, 2)}\n`, 'utf8')
}

async function resolveNameViaUniverseIds(name: string): Promise<{
	characterId?: string
	characterName?: string
	corporationId?: string
	corporationName?: string
	allianceId?: string
	allianceName?: string
}> {
	const response = await fetch('https://esi.evetech.net/latest/universe/ids/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([name]),
	})
	if (!response.ok) return {}
	const data = (await response.json()) as {
		characters?: Array<{ id: number; name: string }>
		corporations?: Array<{ id: number; name: string }>
		alliances?: Array<{ id: number; name: string }>
	}
	return {
		characterId: data.characters?.[0] ? String(data.characters[0].id) : undefined,
		characterName: data.characters?.[0]?.name,
		corporationId: data.corporations?.[0] ? String(data.corporations[0].id) : undefined,
		corporationName: data.corporations?.[0]?.name,
		allianceId: data.alliances?.[0] ? String(data.alliances[0].id) : undefined,
		allianceName: data.alliances?.[0]?.name,
	}
}

async function resolveLegacyAccountCharacters(
	mysql: QueryablePool,
	legacyType: LegacyType,
	legacyValue: string
): Promise<LegacyCharacterRow[]> {
	if (legacyType === 6) {
		const [rows] = await mysql.query<LegacyCharacterRow[]>(
			`
			SELECT DISTINCT c.id AS character_id, c.name AS character_name
			FROM auth.eve_api_eveaccount ea
			INNER JOIN auth.eve_api_eveaccount_characters eac ON eac.eveaccount_id = ea.api_user_id
			INNER JOIN auth.eve_api_eveplayercharacter c ON c.id = eac.eveplayercharacter_id
			WHERE ea.hidden = 0 AND (ea.api_user_id = ? OR ea.user_id = ?)
			`,
			[legacyValue, legacyValue]
		)
		return rows
	}

	if (legacyType === 0) {
		const [rows] = await mysql.query<LegacyCharacterRow[]>(
			`
			SELECT DISTINCT c.id AS character_id, c.name AS character_name
			FROM auth.auth_user au
			INNER JOIN auth.eve_api_eveaccount ea ON ea.user_id = au.id
			INNER JOIN auth.eve_api_eveaccount_characters eac ON eac.eveaccount_id = ea.api_user_id
			INNER JOIN auth.eve_api_eveplayercharacter c ON c.id = eac.eveplayercharacter_id
			WHERE ea.hidden = 0 AND au.username = ?
			`,
			[legacyValue]
		)
		return rows
	}

	if (legacyType === 4) {
		const [rows] = await mysql.query<LegacyCharacterRow[]>(
			`
			SELECT DISTINCT c.id AS character_id, c.name AS character_name
			FROM auth.auth_user au
			INNER JOIN auth.eve_api_eveaccount ea ON ea.user_id = au.id
			INNER JOIN auth.eve_api_eveaccount_characters eac ON eac.eveaccount_id = ea.api_user_id
			INNER JOIN auth.eve_api_eveplayercharacter c ON c.id = eac.eveplayercharacter_id
			WHERE ea.hidden = 0 AND au.email = ?
			`,
			[legacyValue]
		)
		return rows
	}

	return []
}

async function extractPhase(mysql: QueryablePool, outDir: string): Promise<ExtractedSnapshot> {
	console.log('[Legacy Blacklist Import] Phase 1/3: extract')
	const [rows] = await mysql.query<LegacyBlacklistRow[]>(`
		SELECT
			b.id AS legacy_blacklist_id,
			b.type AS legacy_type,
			b.value AS legacy_value,
			b.level AS legacy_level,
			b.reason AS reason,
			b.created_date AS created_date,
			b.expiry_date AS expiry_date,
			b.source_id AS source_id,
			s.name AS source_name
		FROM auth.hr_blacklist b
		LEFT JOIN auth.hr_blacklistsource s ON s.id = b.source_id
		WHERE b.expiry_date IS NULL OR b.expiry_date > NOW()
	`)
	console.log('[Legacy Blacklist Import] Extracted rows:', rows.length)
	const paths = buildArtifactPaths(outDir)
	await writeFile(paths.raw, toJsonl(rows), 'utf8')
	return { rows }
}

async function transformPhase(
	mysql: QueryablePool,
	snapshot: ExtractedSnapshot,
	levels: Set<string>,
	outDir: string
): Promise<{ output: TransformOutput; scanned: number; filteredByType: number; filteredByLevel: number }> {
	console.log('[Legacy Blacklist Import] Phase 2/3: transform')
	const resolvedArtifacts: ResolvedRowArtifact[] = []
	const unresolvedArtifacts: UnresolvedRowArtifact[] = []
	const normalizedEntries: NormalizedEntry[] = []

	let filteredByType = 0
	let filteredByLevel = 0

	let processed = 0
	for (const row of snapshot.rows) {
		processed += 1
		if (processed % 100 === 0) {
			console.log(`[Legacy Blacklist Import] Transform progress: ${processed}/${snapshot.rows.length}`)
		}

		if (!isSupportedLegacyType(row.legacy_type)) {
			filteredByType += 1
			continue
		}
		const level = String(row.legacy_level ?? '')
		if (!levels.has(level)) {
			filteredByLevel += 1
			continue
		}

		const legacyValue = row.legacy_value?.trim()
		if (!legacyValue) {
			unresolvedArtifacts.push({
				legacyBlacklistId: row.legacy_blacklist_id,
				legacyType: row.legacy_type,
				legacyValue: '',
				reason: 'Empty value',
			})
			continue
		}

		const reason = row.reason?.trim() || `Legacy blacklist #${row.legacy_blacklist_id}`
		const createdAt = new Date(row.created_date ?? new Date()).toISOString()
		const baseMetadata = {
			legacyBlacklistId: row.legacy_blacklist_id,
			legacyType: row.legacy_type,
			legacyValue,
			legacyLevel: row.legacy_level,
			legacySourceId: row.source_id,
			legacySourceName: row.source_name,
		}

		if (row.legacy_type === 1) {
			const resolved = await resolveNameViaUniverseIds(legacyValue)
			const entries: NormalizedEntry[] = [
				{
					targetType: 'character_name',
					targetValue: normalizeCharacterName(legacyValue),
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: { ...baseMetadata, resolutionMethod: 'legacy-name+esi-character-id' },
				},
			]
			if (resolved.characterId) {
				entries.push({
					targetType: 'character_id',
					targetValue: resolved.characterId,
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: { ...baseMetadata, resolutionMethod: 'legacy-name+esi-character-id' },
				})
			}
			normalizedEntries.push(...entries)
			resolvedArtifacts.push({
				legacyBlacklistId: row.legacy_blacklist_id,
				legacyType: row.legacy_type,
				legacyValue,
				entries: entries.map((entry) => ({ targetType: entry.targetType, targetValue: entry.targetValue })),
				resolutionMethod: resolved.characterId ? 'name+id' : 'name-only',
			})
			continue
		}

		if (row.legacy_type === 6 || row.legacy_type === 0 || row.legacy_type === 4) {
			const charRows = await resolveLegacyAccountCharacters(mysql, row.legacy_type, legacyValue)
			if (charRows.length === 0) {
				unresolvedArtifacts.push({
					legacyBlacklistId: row.legacy_blacklist_id,
					legacyType: row.legacy_type,
					legacyValue,
					reason:
						row.legacy_type === 6
							? 'No characters resolved for legacy API user id'
							: row.legacy_type === 0
								? 'No legacy account/characters resolved from username'
								: 'No legacy account/characters resolved from email',
				})
				continue
			}

			const entries: NormalizedEntry[] = []
			for (const charRow of charRows) {
				entries.push({
					targetType: 'character_id',
					targetValue: String(charRow.character_id),
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: {
						...baseMetadata,
						resolutionMethod: row.legacy_type === 6 ? 'legacy-api-user-join' : 'legacy-account-lookup',
					},
				})
				entries.push({
					targetType: 'character_name',
					targetValue: normalizeCharacterName(charRow.character_name),
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: {
						...baseMetadata,
						resolutionMethod: row.legacy_type === 6 ? 'legacy-api-user-join' : 'legacy-account-lookup',
					},
				})
			}
			normalizedEntries.push(...entries)
			resolvedArtifacts.push({
				legacyBlacklistId: row.legacy_blacklist_id,
				legacyType: row.legacy_type,
				legacyValue,
				entries: entries.map((entry) => ({ targetType: entry.targetType, targetValue: entry.targetValue })),
				resolutionMethod: row.legacy_type === 6 ? 'legacy-api-user-join' : 'legacy-account-lookup',
			})
			continue
		}

		if (row.legacy_type === 2 || row.legacy_type === 3) {
			const resolved = await resolveNameViaUniverseIds(legacyValue)
			const isCorp = row.legacy_type === 2
			const id = isCorp ? resolved.corporationId : resolved.allianceId
			const name = isCorp ? resolved.corporationName : resolved.allianceName
			if (!id || !name) {
				unresolvedArtifacts.push({
					legacyBlacklistId: row.legacy_blacklist_id,
					legacyType: row.legacy_type,
					legacyValue,
					reason: isCorp ? 'Corporation name unresolved via ESI' : 'Alliance name unresolved via ESI',
				})
				continue
			}
			const entries: NormalizedEntry[] = [
				{
					targetType: isCorp ? 'corporation_id' : 'alliance_id',
					targetValue: id,
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: { ...baseMetadata, resolutionMethod: 'esi-universe-ids' },
				},
				{
					targetType: isCorp ? 'corporation_name' : 'alliance_name',
					targetValue: name,
					reason,
					createdAt,
					legacyBlacklistId: row.legacy_blacklist_id,
					metadata: { ...baseMetadata, resolutionMethod: 'esi-universe-ids' },
				},
			]
			normalizedEntries.push(...entries)
			resolvedArtifacts.push({
				legacyBlacklistId: row.legacy_blacklist_id,
				legacyType: row.legacy_type,
				legacyValue,
				entries: entries.map((entry) => ({ targetType: entry.targetType, targetValue: entry.targetValue })),
				resolutionMethod: 'name+id',
			})
		}
	}

	const output: TransformOutput = {
		normalizedEntries: dedupeEntries(normalizedEntries),
		resolvedArtifacts,
		unresolvedArtifacts,
	}
	const paths = buildArtifactPaths(outDir)
	await writeFile(paths.normalized, toJsonl(output.normalizedEntries), 'utf8')
	await writeFile(paths.resolved, toJsonl(output.resolvedArtifacts), 'utf8')
	await writeFile(paths.unresolved, toJsonl(output.unresolvedArtifacts), 'utf8')
	console.log('[Legacy Blacklist Import] Transform complete:', {
		resolvedRows: output.resolvedArtifacts.length,
		unresolvedRows: output.unresolvedArtifacts.length,
		normalizedEntries: output.normalizedEntries.length,
	})
	return { output, scanned: snapshot.rows.length, filteredByType, filteredByLevel }
}

async function loadPhase(
	mode: Mode,
	dbUrl: string,
	actorUserId: string | null,
	output: TransformOutput,
	outDir: string
): Promise<{ insertedEntries: number; skippedExistingArtifacts: SkippedExistingArtifact[] }> {
	console.log('[Legacy Blacklist Import] Phase 3/3: load')
	const skippedExistingArtifacts: SkippedExistingArtifact[] = []
	if (output.normalizedEntries.length === 0) {
		const paths = buildArtifactPaths(outDir)
		await writeFile(paths.skippedExisting, '', 'utf8')
		return { insertedEntries: 0, skippedExistingArtifacts }
	}

	const db = createDb(dbUrl)
	const groupedByType = new Map<BlacklistTargetType, string[]>()
	for (const entry of output.normalizedEntries) {
		const bucket = groupedByType.get(entry.targetType) ?? []
		bucket.push(entry.targetValue)
		groupedByType.set(entry.targetType, bucket)
	}

	const existingSet = new Set<string>()
	for (const [targetType, values] of groupedByType.entries()) {
		for (const valuesChunk of toChunks(values, 500)) {
			const existing = await db
				.select({ targetType: blacklistEntries.targetType, targetValue: blacklistEntries.targetValue })
				.from(blacklistEntries)
				.where(and(eq(blacklistEntries.targetType, targetType), inArray(blacklistEntries.targetValue, valuesChunk)))
			for (const row of existing) existingSet.add(`${row.targetType}:${row.targetValue}`)
		}
	}

	const toInsert = output.normalizedEntries.filter((entry) => {
		const key = `${entry.targetType}:${entry.targetValue}`
		if (existingSet.has(key)) {
			skippedExistingArtifacts.push({
				legacyBlacklistId: entry.legacyBlacklistId,
				targetType: entry.targetType,
				targetValue: entry.targetValue,
			})
			return false
		}
		return true
	})
	const paths = buildArtifactPaths(outDir)
	await writeFile(paths.skippedExisting, toJsonl(skippedExistingArtifacts), 'utf8')

	if (mode === 'dry-run') {
		console.log('[Legacy Blacklist Import] Dry-run load summary:', {
			wouldInsert: toInsert.length,
			skippedExisting: skippedExistingArtifacts.length,
		})
		return { insertedEntries: 0, skippedExistingArtifacts }
	}

	let insertedEntries = 0
	const chunks = toChunks(toInsert, 250)
	for (let idx = 0; idx < chunks.length; idx += 1) {
		const rowsChunk = chunks[idx]
		await db.insert(blacklistEntries).values(
			rowsChunk.map((entry) => ({
				targetType: entry.targetType,
				targetValue: entry.targetValue,
				reason: entry.reason,
				blacklistedBy: actorUserId!,
				triggeredBy: null,
				isAutoBlacklist: false,
				metadata: entry.metadata,
				createdAt: new Date(entry.createdAt),
			}))
		)
		insertedEntries += rowsChunk.length
		console.log(`[Legacy Blacklist Import] Load progress: chunk ${idx + 1}/${chunks.length} (${insertedEntries} inserted)`)
	}
	return { insertedEntries, skippedExistingArtifacts }
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const levels = parseLegacyLevels()
	const databaseUrl = readRequiredEnv('DATABASE_URL_MIGRATIONS')
	const actorUserId = options.mode === 'apply' ? readRequiredEnv('LEGACY_IMPORT_ACTOR_USER_ID') : null
	const outDir = resolve(options.exportPath ?? './tmp/legacy-blacklist')
	await mkdir(outDir, { recursive: true })
	let cursor = options.resetCursor ? null : await readCursor(outDir)
	if (!cursor || options.resetCursor) {
		cursor = freshCursor(options.mode, outDir)
		await writeCursor(outDir, cursor)
	}
	const paths = buildArtifactPaths(outDir)

	if (options.fromNormalized) {
		const normalizedPath = resolve(options.fromNormalized)
		console.log('[Legacy Blacklist Import] Loading from normalized file', { normalizedPath })
		const raw = await readFile(normalizedPath, 'utf8')
		const normalizedEntries = raw
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as NormalizedEntry)
		const output: TransformOutput = {
			normalizedEntries,
			resolvedArtifacts: [],
			unresolvedArtifacts: [],
		}
		const loaded = await loadPhase(options.mode, databaseUrl, actorUserId, output, outDir)
		const summary: Summary = {
			scanned: 0,
			filteredByType: 0,
			filteredByLevel: 0,
			resolvedRows: 0,
			unresolvedRows: 0,
			normalizedEntries: output.normalizedEntries.length,
			insertedEntries: loaded.insertedEntries,
			skippedExistingEntries: loaded.skippedExistingArtifacts.length,
		}
		await writeFile(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
		cursor.phases.load = true
		await writeCursor(outDir, cursor)
		console.log('[Legacy Blacklist Import] Complete (from normalized)', {
			mode: options.mode,
			outDir,
			summary,
		})
		return
	}

	const legacyDatabaseUrl = readRequiredEnv('LEGACY_DATABASE_URL')
	const mysql = createPool({ uri: legacyDatabaseUrl, waitForConnections: true, connectionLimit: 4 })
	try {
		let extracted: ExtractedSnapshot
		if (options.resume && cursor.phases.extract) {
			console.log('[Legacy Blacklist Import] Resume: loading extracted snapshot from disk')
			const raw = await readFile(paths.raw, 'utf8')
			extracted = {
				rows: raw
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
					.map((line) => JSON.parse(line) as LegacyBlacklistRow),
			}
		} else {
			extracted = await extractPhase(mysql, outDir)
			cursor.phases.extract = true
			await writeCursor(outDir, cursor)
		}

		let transformed: Awaited<ReturnType<typeof transformPhase>>
		if (options.resume && cursor.phases.transform) {
			console.log('[Legacy Blacklist Import] Resume: loading normalized artifacts from disk')
			const normalizedRaw = await readFile(paths.normalized, 'utf8')
			const resolvedRaw = await readFile(paths.resolved, 'utf8')
			const unresolvedRaw = await readFile(paths.unresolved, 'utf8')
			const normalizedEntries = normalizedRaw
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as NormalizedEntry)
			const resolvedArtifacts = resolvedRaw
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as ResolvedRowArtifact)
			const unresolvedArtifacts = unresolvedRaw
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as UnresolvedRowArtifact)
			transformed = {
				output: { normalizedEntries, resolvedArtifacts, unresolvedArtifacts },
				scanned: extracted.rows.length,
				filteredByType: 0,
				filteredByLevel: 0,
			}
		} else {
			transformed = await transformPhase(mysql, extracted, levels, outDir)
			cursor.phases.transform = true
			await writeCursor(outDir, cursor)
		}

		const loaded = await loadPhase(options.mode, databaseUrl, actorUserId, transformed.output, outDir)
		cursor.phases.load = true
		await writeCursor(outDir, cursor)

		const summary: Summary = {
			scanned: transformed.scanned,
			filteredByType: transformed.filteredByType,
			filteredByLevel: transformed.filteredByLevel,
			resolvedRows: transformed.output.resolvedArtifacts.length,
			unresolvedRows: transformed.output.unresolvedArtifacts.length,
			normalizedEntries: transformed.output.normalizedEntries.length,
			insertedEntries: loaded.insertedEntries,
			skippedExistingEntries: loaded.skippedExistingArtifacts.length,
		}
		await writeFile(paths.summary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

		// Touch read path to ensure files exist and are readable before completion log.
		await readFile(paths.summary, 'utf8')
		console.log('[Legacy Blacklist Import] Complete', {
			mode: options.mode,
			outDir,
			summary,
			cursor: cursorPath(outDir),
		})
	} finally {
		await mysql.end()
	}
}

void main().catch((error) => {
	console.error('[Legacy Blacklist Import] Failed', error)
	process.exit(1)
})
