import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate as drizzleMigrateHttp } from 'drizzle-orm/neon-http/migrator'
import { migrate as drizzleMigrateWs } from 'drizzle-orm/neon-serverless/migrator'

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'

export interface MigrationConfig {
	migrationsFolder: string
	migrationsTable?: string
	migrationsSchema?: string
}

type JournalEntry = {
	tag: string
}

type MigrationPlanEntry = {
	tag: string
	hash: string
}

function validateSqlIdentifier(value: string, label: string): string {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
		throw new Error(`Invalid ${label}: ${value}`)
	}
	return value
}

async function readJournalEntries(migrationsFolder: string): Promise<JournalEntry[]> {
	const journalPath = resolve(migrationsFolder, 'meta', '_journal.json')
	const raw = await readFile(journalPath, 'utf8')
	const parsed = JSON.parse(raw) as { entries?: JournalEntry[] }
	return parsed.entries ?? []
}

async function buildMigrationPlanEntries(
	migrationsFolder: string,
	journal: JournalEntry[]
): Promise<MigrationPlanEntry[]> {
	const entries: MigrationPlanEntry[] = []

	for (const journalEntry of journal) {
		const migrationPath = resolve(migrationsFolder, `${journalEntry.tag}.sql`)
		const query = await readFile(migrationPath, 'utf8')
		const hash = createHash('sha256').update(query).digest('hex')
		entries.push({ tag: journalEntry.tag, hash })
	}

	return entries
}

async function readAppliedHashes(
	db: NeonHttpDatabase<any> | NeonDatabase<any>,
	migrationsSchema: string,
	migrationsTable: string
): Promise<Set<string>> {
	const schema = validateSqlIdentifier(migrationsSchema, 'migrations schema')
	const table = validateSqlIdentifier(migrationsTable, 'migrations table')

	try {
		const result = await db.execute(sql.raw(`select hash from "${schema}"."${table}"`))
		const rows = (result as { rows?: Array<{ hash?: unknown }> }).rows ?? []
		return new Set(
			rows
				.map((row) => row.hash)
				.filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
		)
	} catch (error) {
		const maybeCode = (error as { cause?: { code?: string }; code?: string })?.cause?.code
		const directCode = (error as { code?: string })?.code
		if (
			maybeCode === '42P01' ||
			directCode === '42P01' ||
			maybeCode === '3F000' ||
			directCode === '3F000'
		) {
			return new Set()
		}
		throw error
	}
}

async function logMigrationPlan(
	db: NeonHttpDatabase<any> | NeonDatabase<any>,
	config: MigrationConfig
): Promise<{
	beforeAppliedHashes: Set<string>
	migrationEntries: MigrationPlanEntry[]
	migrationsSchema: string
	migrationsTable: string
}> {
	const migrationsTable = config.migrationsTable ?? '__drizzle_migrations'
	const migrationsSchema = config.migrationsSchema ?? 'drizzle'
	const journal = await readJournalEntries(config.migrationsFolder)
	const migrationEntries = await buildMigrationPlanEntries(config.migrationsFolder, journal)
	const beforeAppliedHashes = await readAppliedHashes(db, migrationsSchema, migrationsTable)
	const pending = migrationEntries.filter((entry) => !beforeAppliedHashes.has(entry.hash))
	const alreadyApplied = migrationEntries.length - pending.length

	console.log(
		`[db:migrate] plan=${JSON.stringify({
			totalInJournal: migrationEntries.length,
			alreadyApplied,
			pending: pending.length,
			migrationsSchema,
			migrationsTable,
		})}`
	)

	if (pending.length > 0) {
		console.debug(`[db:migrate] pending tags: ${pending.map((entry) => entry.tag).join(', ')}`)
	} else {
		console.debug('[db:migrate] no pending migrations detected')
	}

	return {
		beforeAppliedHashes,
		migrationEntries,
		migrationsSchema,
		migrationsTable,
	}
}

async function logMigrationResult(
	db: NeonHttpDatabase<any> | NeonDatabase<any>,
	beforeAppliedHashes: Set<string>,
	migrationEntries: MigrationPlanEntry[],
	migrationsSchema: string,
	migrationsTable: string
): Promise<void> {
	const afterAppliedHashes = await readAppliedHashes(db, migrationsSchema, migrationsTable)
	const newlyAppliedEntries = migrationEntries.filter(
		(entry) => !beforeAppliedHashes.has(entry.hash) && afterAppliedHashes.has(entry.hash)
	)
	const newlyAppliedTags = newlyAppliedEntries.map((entry) => entry.tag)
	const totalApplied = migrationEntries.filter((entry) => afterAppliedHashes.has(entry.hash)).length

	console.log(
		`[db:migrate] result=${JSON.stringify({
			newlyApplied: newlyAppliedEntries.length,
			totalApplied,
			migrationsSchema,
			migrationsTable,
		})}`
	)

	if (newlyAppliedTags.length > 0) {
		console.debug(`[db:migrate] applied tags: ${newlyAppliedTags.join(', ')}`)
	}
}

/**
 * Run database migrations (HTTP client)
 * @param db - The Drizzle database instance
 * @param config - Migration configuration
 */
export async function migrate(db: NeonHttpDatabase<any>, config: MigrationConfig): Promise<void> {
	console.log(`Running migrations from ${config.migrationsFolder}...`)

	let plan: {
		beforeAppliedHashes: Set<string>
		migrationEntries: MigrationPlanEntry[]
		migrationsSchema: string
		migrationsTable: string
	} | null = null
	console.log(
		`[db:migrate] config=${JSON.stringify({
			migrationsFolder: config.migrationsFolder,
			migrationsSchema: config.migrationsSchema ?? 'drizzle',
			migrationsTable: config.migrationsTable ?? '__drizzle_migrations',
		})}`
	)
	plan = await logMigrationPlan(db, config)
	console.log('[db:migrate] starting drizzle migrate (http)')

	await drizzleMigrateHttp(db, {
		migrationsFolder: config.migrationsFolder,
		migrationsTable: config.migrationsTable,
	})

	if (plan) {
		await logMigrationResult(
			db,
			plan.beforeAppliedHashes,
			plan.migrationEntries,
			plan.migrationsSchema,
			plan.migrationsTable
		)
	}
	console.log('[db:migrate] drizzle migrate complete (http)')
}

/**
 * Run database migrations (WebSocket client)
 * @param db - The Drizzle database instance
 * @param config - Migration configuration
 */
export async function migrateWs(db: NeonDatabase<any>, config: MigrationConfig): Promise<void> {
	console.log(`Running migrations from ${config.migrationsFolder}...`)

	let plan: {
		beforeAppliedHashes: Set<string>
		migrationEntries: MigrationPlanEntry[]
		migrationsSchema: string
		migrationsTable: string
	} | null = null
	console.log(
		`[db:migrate] config=${JSON.stringify({
			migrationsFolder: config.migrationsFolder,
			migrationsSchema: config.migrationsSchema ?? 'drizzle',
			migrationsTable: config.migrationsTable ?? '__drizzle_migrations',
		})}`
	)
	plan = await logMigrationPlan(db, config)
	console.log('[db:migrate] starting drizzle migrate (ws)')

	await drizzleMigrateWs(db, {
		migrationsFolder: config.migrationsFolder,
		migrationsTable: config.migrationsTable,
	})

	if (plan) {
		await logMigrationResult(
			db,
			plan.beforeAppliedHashes,
			plan.migrationEntries,
			plan.migrationsSchema,
			plan.migrationsTable
		)
	}
	console.log('[db:migrate] drizzle migrate complete (ws)')

	console.log('Migrations completed successfully')
}
