import { migrate } from '@repo/db-utils'
import { createCoreDb } from './client'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables from root
dotenv.config({ path: resolve(__dirname, '../../../../.env') })

async function runMigrations() {
	const databaseUrl = process.env.NEON_DATABASE_URL
	if (!databaseUrl) {
		throw new Error('NEON_DATABASE_URL is not set in environment variables')
	}

	const db = createCoreDb(databaseUrl)

	try {
		await migrate(db, {
			migrationsFolder: './src/db/migrations',
			migrationsTable: 'core_migrations'
		})
		console.log('Core app migrations completed successfully')
		process.exit(0)
	} catch (error) {
		console.error('Migration failed:', error)
		process.exit(1)
	}
}

runMigrations()