import { drizzle } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'

import migrations from './migrations/migrations.js'
import * as schema from './schema'

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

export type EsiDb = DrizzleSqliteDODatabase<typeof schema>

export function createEsiDb(storage: DurableObjectStorage): EsiDb {
	return drizzle(storage, { schema, logger: false })
}

export async function runEsiMigrations(db: EsiDb): Promise<void> {
	migrate(db, migrations)
}
