import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

import * as schema from './schema'

export type StructureMonitorDb = DrizzleSqliteDODatabase<typeof schema>

export function createStructureMonitorDb(storage: DurableObjectStorage): StructureMonitorDb {
	return drizzle(storage, { schema, logger: false })
}

export async function runStructureMonitorMigrations(_db: StructureMonitorDb): Promise<void> {
	// TODO: Integrate drizzle-kit migrations for SQLite durable objects.
}

