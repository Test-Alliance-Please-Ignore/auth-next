import { drizzle } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'

import migrations from './.migrations/migrations.js'
import * as schema from './schema'

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

export type StructureMonitorDb = DrizzleSqliteDODatabase<typeof schema>

export function createStructureMonitorDb(storage: DurableObjectStorage): StructureMonitorDb {
	return drizzle(storage, { schema, logger: false })
}

export async function runStructureMonitorMigrations(db: StructureMonitorDb): Promise<void> {
	// TODO: Integrate drizzle-kit migrations for SQLite durable objects.
	migrate(db, migrations)
}
