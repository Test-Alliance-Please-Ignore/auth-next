import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDbClientRaw, sql } from '@repo/db-utils'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const LEGACY_SDE_TABLES = [
	'skill_attributes',
	'skill_requirements',
	'skills',
	'skill_groups',
	'skill_categories',
	'dgm_type_attributes',
	'dgm_attribute_types',
	'dgm_attribute_categories',
	'inv_types',
	'inv_groups',
	'market_groups',
	'inv_categories',
	'corporations',
	'alliances',
] as const

function getDatabaseUrlFromEnv(): { databaseUrl: string; source: string } {
	const fromMigrations = process.env.DATABASE_URL_MIGRATIONS
	if (fromMigrations && fromMigrations.trim() !== '') {
		return { databaseUrl: fromMigrations, source: 'DATABASE_URL_MIGRATIONS' }
	}

	const fromDefault = process.env.DATABASE_URL
	if (fromDefault && fromDefault.trim() !== '') {
		return { databaseUrl: fromDefault, source: 'DATABASE_URL' }
	}

	throw new Error('Missing database URL. Set DATABASE_URL_MIGRATIONS or DATABASE_URL in root .env')
}

function redactDatabaseUrl(databaseUrl: string): string {
	try {
		const parsed = new URL(databaseUrl)
		const databaseName = parsed.pathname.replace(/^\//, '')
		return `${parsed.protocol}//${parsed.host}/${databaseName}`
	} catch {
		return '<unable to parse>'
	}
}

async function main() {
	const args = new Set(process.argv.slice(2))
	const hasYesFlag = args.has('--yes')
	const dryRun = args.has('--dry-run')

	const { databaseUrl, source } = getDatabaseUrlFromEnv()
	console.log(`Using ${source} from root .env: ${redactDatabaseUrl(databaseUrl)}`)

	if (!hasYesFlag) {
		throw new Error(
			'Refusing to run destructive operation without confirmation. Re-run with --yes (optionally with --dry-run).'
		)
	}

	const db = createDbClientRaw(databaseUrl)

	for (const tableName of LEGACY_SDE_TABLES) {
		console.log(`${dryRun ? '[dry-run] Would drop' : 'Dropping'} table: ${tableName}`)
		if (dryRun) continue

		await db.execute(sql.raw(`drop table if exists "${tableName}" cascade`))
	}

	console.log(
		dryRun
			? 'Dry-run complete. No database changes were made.'
			: 'Legacy SDE tables dropped successfully.'
	)
}

main().catch((error) => {
	console.error('Failed to drop legacy SDE tables:', error)
	process.exit(1)
})
