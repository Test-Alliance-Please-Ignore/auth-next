/**
 * Database migration script
 *
 * Run this script to apply pending migrations to your database:
 * pnpm db:migrate
 *
 * Ensure DATABASE_URL_MIGRATIONS is set in the root .env file
 */

import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDbClientRaw, migrate } from '@repo/db-utils'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Connecting to database...')
	const db = createDbClientRaw(databaseUrl)

	await migrate(db, {
		migrationsFolder: './.migrations',
	})

	console.log('Migration complete!')
	process.exit(0)
}

main().catch((error) => {
	console.error('Migration failed:', error)
	process.exit(1)
})
