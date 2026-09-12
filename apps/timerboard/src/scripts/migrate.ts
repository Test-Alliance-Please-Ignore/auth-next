import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDbClientRaw, migrate } from '@repo/db-utils'

const directory = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(directory, '../../../../.env') })

const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')

await migrate(createDbClientRaw(databaseUrl), {
	migrationsFolder: './.migrations',
	migrationsTable: 'timerboard_migrations',
})
