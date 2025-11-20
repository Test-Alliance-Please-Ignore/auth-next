import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { logger } from '@repo/hono-helpers'
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

	logger.info('Running migrations for fulcrum worker')

	const db = createDb(databaseUrl)
	await migrate(db, { migrationsFolder: drizzleConfig.out! })

	logger.info('Migrations completed successfully')
	process.exit(0)
}

main().catch((error) => {
	logger.error('Migration failed', {
		error: error instanceof Error ? error.message : String(error),
		errorStack: error instanceof Error ? error.stack : undefined,
	})
	process.exit(1)
})
