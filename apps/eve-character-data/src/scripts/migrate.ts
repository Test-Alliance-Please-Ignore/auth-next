import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { migrate } from '@repo/db-utils'

import drizzleConfig from '../../drizzle.config'
import { createDb } from '../db'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Run database migrations
 *
 * This script loads DATABASE_URL_MIGRATIONS from the root .env file
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Running migrations for eve-character-data worker...')
	console.log(`Running migrations from ${drizzleConfig.out}...`)

	const db = createDb(databaseUrl)

	// Create migration config with explicit path
	const migrationConfig = {
		migrationsFolder: drizzleConfig.out || './.migrations',
	}

	await migrate(db, migrationConfig)

	console.log('Migrations completed successfully!')
	process.exit(0)
}

main().catch((error) => {
	console.error('Migration failed:', error)
	process.exit(1)
})
