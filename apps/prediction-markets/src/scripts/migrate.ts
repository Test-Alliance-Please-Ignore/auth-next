import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDbClientRaw, migrate } from '@repo/db-utils'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Run database migrations
 *
 * This script loads DATABASE_URL_MIGRATIONS from the root .env file.
 *
 * Uses a dedicated `migrationsTable` so this app's migration journal is isolated
 * from the shared `drizzle.__drizzle_migrations` table (which all apps otherwise
 * share) — preventing this app's migrations from being skipped by timestamp
 * comparison against other apps' already-applied migrations.
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Running migrations for prediction-markets worker...')

	const db = createDbClientRaw(databaseUrl)
	await migrate(db, {
		migrationsFolder: './.migrations',
		migrationsTable: 'prediction_markets_migrations',
	})

	console.log('Migrations completed successfully!')
	process.exit(0)
}

main().catch((error) => {
	console.error('Migration failed:', error)
	process.exit(1)
})
