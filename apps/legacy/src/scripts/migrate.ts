import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { migrate } from '@repo/db-utils'

import drizzleConfig from '../../drizzle.config'
import { createDb } from '../db'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')

	const db = createDb(databaseUrl)
	await migrate(db, { migrationsFolder: drizzleConfig.out! })

	console.log('Legacy migrations completed successfully')
	process.exit(0)
}

void main().catch((error) => {
	console.error('Legacy migrations failed:', error)
	process.exit(1)
})
