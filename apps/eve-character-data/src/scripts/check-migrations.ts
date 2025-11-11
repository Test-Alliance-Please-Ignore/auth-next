import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Check which migrations have been applied
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Checking applied migrations...')

	const sql = neon(databaseUrl)

	try {
		// Check if migrations table exists
		const tables = await sql`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = 'public'
			ORDER BY table_name
		`

		console.log('\nTables in database:')
		for (const table of tables) {
			console.log(`  - ${table.table_name}`)
		}

		// Check migrations in drizzle schema
		const migrations = await sql`
			SELECT * FROM drizzle.__drizzle_migrations
			ORDER BY created_at
		`

		console.log('\nApplied migrations:')
		for (const migration of migrations) {
			console.log(`  - ${migration.hash} (created: ${migration.created_at})`)
		}
	} catch (error) {
		console.error('Error checking migrations:', error)
	}

	process.exit(0)
}

main().catch((error) => {
	console.error('Failed:', error)
	process.exit(1)
})
