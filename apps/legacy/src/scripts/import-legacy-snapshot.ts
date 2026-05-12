import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createPool } from 'mysql2/promise'
import { createHmac, createHash } from 'node:crypto'

import { createDb } from '../db'
import {
	legacyAuthApplicationEvents,
	legacyAuthApplications,
	legacyAuthCharacters,
	legacyAuthDiscordAccounts,
	legacyAuthNotes,
	legacyAuthUserIpAddresses,
} from '../db/schema'
import {
	chunkRows,
	isLikelyIp,
	mapLegacyEventCode,
	toDateOrNull,
} from './import-legacy-snapshot.helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

type Stage =
	| 'characters'
	| 'ip_addresses'
	| 'discord_accounts'
	| 'notes'
	| 'applications'
	| 'application_events'
	| 'blacklists'
	| 'all'

interface CliOptions {
	stage: Stage
	dryRun: boolean
}

interface StageResult {
	stage: Exclude<Stage, 'all'>
	skipped: boolean
	message: string
	processed?: number
}

interface StageContext {
	legacyDatabaseUrl: string
	legacyWorkerDatabaseUrl: string
	dryRun: boolean
}

interface LegacyCharacterRow {
	legacy_auth_user_id: number
	character_id: number
	character_name: string
	source: 'esi_owner' | 'xml_account'
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
	ip_hash: string | null
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

const STAGES: Array<Exclude<Stage, 'all'>> = [
	'characters',
	'ip_addresses',
	'discord_accounts',
	'notes',
	'applications',
	'application_events',
	'blacklists',
]

function parseArgs(argv: string[]): CliOptions {
	const getArgValue = (flag: string): string | undefined => {
		const idx = argv.findIndex((arg) => arg === flag)
		if (idx === -1) return undefined
		return argv[idx + 1]
	}

	const stageValue = getArgValue('--stage') ?? 'all'
	if (
		![
			'characters',
			'ip_addresses',
			'discord_accounts',
			'notes',
			'applications',
			'application_events',
			'blacklists',
			'all',
		].includes(stageValue)
	) {
		throw new Error(`Invalid --stage value "${stageValue}"`)
	}

	const dryRun = argv.includes('--dry-run')
	const apply = argv.includes('--apply')
	if (dryRun && apply) throw new Error('Choose either --dry-run or --apply, not both')

	return {
		stage: stageValue as Stage,
		dryRun: dryRun || !apply,
	}
}

function readRequiredEnv(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`${name} environment variable is required`)
	return value
}

async function runCharactersStage(ctx: StageContext): Promise<StageResult> {
	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})

	const [rowsRaw] = await mysql.query(`
		SELECT
			c.owner_id AS legacy_auth_user_id,
			c.id AS character_id,
			c.name AS character_name,
			'esi_owner' AS source
		FROM auth.eve_api_eveplayercharacter c
		WHERE c.owner_id IS NOT NULL
		UNION ALL
		SELECT
			ea.user_id AS legacy_auth_user_id,
			c.id AS character_id,
			c.name AS character_name,
			'xml_account' AS source
		FROM auth.eve_api_eveaccount ea
		INNER JOIN auth.eve_api_eveaccount_characters eac
			ON eac.eveaccount_id = ea.api_user_id
		INNER JOIN auth.eve_api_eveplayercharacter c
			ON c.id = eac.eveplayercharacter_id
		WHERE ea.user_id IS NOT NULL
		  AND ea.hidden = 0
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyCharacterRow[]

	if (ctx.dryRun) {
		return {
			stage: 'characters',
			skipped: false,
			message: `Dry run only; would upsert ${rows.length} character associations`,
			processed: rows.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0

	for (const chunk of chunkRows(rows, 500)) {
		await db
			.insert(legacyAuthCharacters)
			.values(
				chunk.map((row) => ({
					legacyAuthUserId: String(row.legacy_auth_user_id),
					characterId: String(row.character_id),
					characterName: row.character_name,
					source: row.source,
					sourceSnapshotAt: now,
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [
					legacyAuthCharacters.legacyAuthUserId,
					legacyAuthCharacters.characterId,
					legacyAuthCharacters.source,
				],
				set: {
					characterName: legacyAuthCharacters.characterName,
					sourceSnapshotAt: now,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'characters',
		skipped: false,
		message: `Upserted ${processed} character associations`,
		processed,
	}
}

async function runIpAddressesStage(ctx: StageContext): Promise<StageResult> {
	const legacyGdprSalt = readRequiredEnv('LEGACY_GDPR_SALT')
	const currentHashSecret = readRequiredEnv('IP_ADDRESS_HASH_SECRET')

	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})
	const [rowsRaw] = await mysql.query(`
		SELECT
			user_id AS legacy_auth_user_id,
			ip_address,
			ip_hash,
			first_seen,
			last_seen
		FROM auth.sso_ssouseripaddress
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyIpAddressRow[]

	const normalized = rows
		.map((row) => {
			const ip = row.ip_address?.trim()
			if (!ip || !isLikelyIp(ip)) return null

			const oldIpHash =
				row.ip_hash ??
				createHash('sha256')
					.update(`${legacyGdprSalt}$${ip}`, 'utf8')
					.digest('hex')
			const newIpHash = createHmac('sha256', currentHashSecret).update(ip, 'utf8').digest('hex')

			return {
				legacyAuthUserId: String(row.legacy_auth_user_id),
				ipAddress: ip,
				oldIpHash,
				newIpHash,
				firstSeenAt: toDateOrNull(row.first_seen),
				lastSeenAt: toDateOrNull(row.last_seen),
			}
		})
		.filter((row): row is NonNullable<typeof row> => row !== null)

	if (ctx.dryRun) {
		return {
			stage: 'ip_addresses',
			skipped: false,
			message: `Dry run only; would upsert ${normalized.length} IP associations`,
			processed: normalized.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0
	for (const chunk of chunkRows(normalized, 500)) {
		await db
			.insert(legacyAuthUserIpAddresses)
			.values(
				chunk.map((row) => ({
					...row,
					sourceSnapshotAt: now,
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [legacyAuthUserIpAddresses.legacyAuthUserId, legacyAuthUserIpAddresses.ipAddress],
				set: {
					oldIpHash: legacyAuthUserIpAddresses.oldIpHash,
					newIpHash: legacyAuthUserIpAddresses.newIpHash,
					firstSeenAt: legacyAuthUserIpAddresses.firstSeenAt,
					lastSeenAt: legacyAuthUserIpAddresses.lastSeenAt,
					sourceSnapshotAt: now,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'ip_addresses',
		skipped: false,
		message: `Upserted ${processed} IP associations`,
		processed,
	}
}

async function runDiscordAccountsStage(ctx: StageContext): Promise<StageResult> {
	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})
	const [rowsRaw] = await mysql.query(`
		SELECT
			sa.user_id AS legacy_auth_user_id,
			sa.service_uid AS discord_user_id
		FROM auth.sso_serviceaccount sa
		INNER JOIN auth.sso_service s
			ON s.id = sa.service_id
		WHERE s.api = 'sso.services.discord'
		  AND sa.service_uid IS NOT NULL
		  AND sa.service_uid != ''
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyDiscordAccountRow[]

	if (ctx.dryRun) {
		return {
			stage: 'discord_accounts',
			skipped: false,
			message: `Dry run only; would upsert ${rows.length} discord account associations`,
			processed: rows.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0
	for (const chunk of chunkRows(rows, 500)) {
		await db
			.insert(legacyAuthDiscordAccounts)
			.values(
				chunk.map((row) => ({
					legacyAuthUserId: String(row.legacy_auth_user_id),
					discordUserId: row.discord_user_id.trim(),
					sourceSnapshotAt: now,
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [
					legacyAuthDiscordAccounts.legacyAuthUserId,
					legacyAuthDiscordAccounts.discordUserId,
				],
				set: {
					sourceSnapshotAt: now,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'discord_accounts',
		skipped: false,
		message: `Upserted ${processed} discord account associations`,
		processed,
	}
}

async function runNotesStage(ctx: StageContext): Promise<StageResult> {
	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})
	const [rowsRaw] = await mysql.query(`
		SELECT
			n.id AS legacy_note_id,
			n.user_id AS legacy_auth_user_id,
			n.created_by_id AS legacy_created_by_user_id,
			n.note AS note,
			n.date_created AS legacy_date_created
		FROM auth.sso_ssousernote n
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyNoteRow[]

	if (ctx.dryRun) {
		return {
			stage: 'notes',
			skipped: false,
			message: `Dry run only; would upsert ${rows.length} notes`,
			processed: rows.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0
	for (const chunk of chunkRows(rows, 500)) {
		await db
			.insert(legacyAuthNotes)
			.values(
				chunk.map((row) => ({
					legacyNoteId: String(row.legacy_note_id),
					legacyAuthUserId: String(row.legacy_auth_user_id),
					legacyCreatedByUserId:
						row.legacy_created_by_user_id === null
							? null
							: String(row.legacy_created_by_user_id),
					note: row.note,
					legacyDateCreated: toDateOrNull(row.legacy_date_created),
					sourceSnapshotAt: now,
					metadata: {},
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [legacyAuthNotes.legacyNoteId],
				set: {
					legacyAuthUserId: legacyAuthNotes.legacyAuthUserId,
					legacyCreatedByUserId: legacyAuthNotes.legacyCreatedByUserId,
					note: legacyAuthNotes.note,
					legacyDateCreated: legacyAuthNotes.legacyDateCreated,
					sourceSnapshotAt: now,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'notes',
		skipped: false,
		message: `Upserted ${processed} notes`,
		processed,
	}
}

async function runApplicationsStage(ctx: StageContext): Promise<StageResult> {
	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})

	const [rowsRaw] = await mysql.query(`
		SELECT
			a.id AS legacy_application_id,
			a.user_id AS legacy_auth_user_id,
			a.character_id AS character_id,
			c.name AS character_name,
			a.corporation_id AS corporation_id,
			co.name AS corporation_name,
			a.status AS status,
			a.application_date AS application_date
		FROM auth.hr_application a
		LEFT JOIN auth.eve_api_eveplayercharacter c
			ON c.id = a.character_id
		LEFT JOIN auth.eve_api_eveplayercorporation co
			ON co.id = a.corporation_id
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyApplicationRow[]

	if (ctx.dryRun) {
		return {
			stage: 'applications',
			skipped: false,
			message: `Dry run only; would upsert ${rows.length} applications`,
			processed: rows.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0

	for (const chunk of chunkRows(rows, 500)) {
		await db
			.insert(legacyAuthApplications)
			.values(
				chunk.map((row) => ({
					legacyApplicationId: String(row.legacy_application_id),
					legacyAuthUserId:
						row.legacy_auth_user_id === null ? null : String(row.legacy_auth_user_id),
					characterId: row.character_id === null ? null : String(row.character_id),
					characterName: row.character_name,
					corporationId: row.corporation_id === null ? null : String(row.corporation_id),
					corporationName: row.corporation_name,
					status: String(row.status),
					applicationDate: toDateOrNull(row.application_date),
					sourceSnapshotAt: now,
					metadata: { legacyStatusCode: row.status },
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [legacyAuthApplications.legacyApplicationId],
				set: {
					legacyAuthUserId: legacyAuthApplications.legacyAuthUserId,
					characterId: legacyAuthApplications.characterId,
					characterName: legacyAuthApplications.characterName,
					corporationId: legacyAuthApplications.corporationId,
					corporationName: legacyAuthApplications.corporationName,
					status: legacyAuthApplications.status,
					applicationDate: legacyAuthApplications.applicationDate,
					sourceSnapshotAt: now,
					metadata: legacyAuthApplications.metadata,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'applications',
		skipped: false,
		message: `Upserted ${processed} applications`,
		processed,
	}
}

async function runApplicationEventsStage(ctx: StageContext): Promise<StageResult> {
	const mysql = createPool({
		uri: ctx.legacyDatabaseUrl,
		waitForConnections: true,
		connectionLimit: 4,
	})

	const [rowsRaw] = await mysql.query(`
		SELECT
			au.id AS legacy_event_id,
			au.application_id AS legacy_application_id,
			app.user_id AS legacy_auth_user_id,
			au.event AS event_code,
			au.text AS event_text,
			au.user_id AS legacy_actor_user_id,
			au.date AS event_date
		FROM auth.hr_audit au
		INNER JOIN auth.hr_application app
			ON app.id = au.application_id
	`)
	await mysql.end()
	const rows = rowsRaw as LegacyApplicationEventRow[]

	if (ctx.dryRun) {
		return {
			stage: 'application_events',
			skipped: false,
			message: `Dry run only; would upsert ${rows.length} application events`,
			processed: rows.length,
		}
	}

	const db = createDb(ctx.legacyWorkerDatabaseUrl)
	const now = new Date()
	let processed = 0

	for (const chunk of chunkRows(rows, 500)) {
		await db
			.insert(legacyAuthApplicationEvents)
			.values(
				chunk.map((row) => ({
					legacyEventId: String(row.legacy_event_id),
					legacyApplicationId: String(row.legacy_application_id),
					legacyAuthUserId:
						row.legacy_auth_user_id === null ? null : String(row.legacy_auth_user_id),
					eventType: mapLegacyEventCode(row.event_code),
					eventCode: row.event_code,
					message: row.event_text,
					legacyActorUserId:
						row.legacy_actor_user_id === null ? null : String(row.legacy_actor_user_id),
					eventAt: toDateOrNull(row.event_date),
					sourceSnapshotAt: now,
					metadata: { legacyEventCode: row.event_code },
					updatedAt: now,
				}))
			)
			.onConflictDoUpdate({
				target: [legacyAuthApplicationEvents.legacyEventId],
				set: {
					legacyApplicationId: legacyAuthApplicationEvents.legacyApplicationId,
					legacyAuthUserId: legacyAuthApplicationEvents.legacyAuthUserId,
					eventType: legacyAuthApplicationEvents.eventType,
					eventCode: legacyAuthApplicationEvents.eventCode,
					message: legacyAuthApplicationEvents.message,
					legacyActorUserId: legacyAuthApplicationEvents.legacyActorUserId,
					eventAt: legacyAuthApplicationEvents.eventAt,
					sourceSnapshotAt: now,
					metadata: legacyAuthApplicationEvents.metadata,
					updatedAt: now,
				},
			})
		processed += chunk.length
	}

	return {
		stage: 'application_events',
		skipped: false,
		message: `Upserted ${processed} application events`,
		processed,
	}
}

async function runBlacklistsStage(_ctx: StageContext): Promise<StageResult> {
	return { stage: 'blacklists', skipped: true, message: 'Not implemented yet (handled by HR import)' }
}

async function runStage(stage: Exclude<Stage, 'all'>, ctx: StageContext): Promise<StageResult> {
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
		case 'blacklists':
			return runBlacklistsStage(ctx)
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const stages = options.stage === 'all' ? STAGES : [options.stage]

	const ctx: StageContext = {
		legacyDatabaseUrl: readRequiredEnv('LEGACY_DATABASE_URL'),
		legacyWorkerDatabaseUrl: readRequiredEnv('DATABASE_URL_MIGRATIONS'),
		dryRun: options.dryRun,
	}

	console.log('[Legacy Snapshot Import] Starting', { mode: options.dryRun ? 'dry-run' : 'apply', stages })
	const results: StageResult[] = []

	for (const stage of stages) {
		const result = await runStage(stage, ctx)
		results.push(result)
		console.log(`[Legacy Snapshot Import] ${stage}`, result)
	}

	console.log('[Legacy Snapshot Import] Complete', { results })
}

void main().catch((error) => {
	console.error('[Legacy Snapshot Import] Failed', error)
	process.exit(1)
})
