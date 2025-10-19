/**
 * Database migration script
 *
 * Run this script to apply pending migrations to your database:
 * pnpm db:migrate
 *
 * Ensure DATABASE_URL is set in your .dev.vars file
 */

import { createDbClientRaw, migrate } from '@repo/db-utils'

async function main() {
	const databaseUrl = process.env.DATABASE_URL

	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is required')
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
