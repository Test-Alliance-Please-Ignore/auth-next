import 'dotenv/config'
import { migrate } from '@repo/db-utils'

import { createDb } from '../db'
import drizzleConfig from '../../drizzle.config'

/**
 * Run database migrations
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL

	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is required')
	}

	console.log('Running migrations for {{ name }} worker...')

	const db = createDb(databaseUrl)
	await migrate(db, drizzleConfig)

	console.log('Migrations completed successfully!')
	process.exit(0)
}

main().catch((error) => {
	console.error('Migration failed:', error)
	process.exit(1)
})
