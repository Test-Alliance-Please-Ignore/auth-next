import { drizzle } from 'drizzle-orm/durable-sqlite'
import { migrate as drizzleMigrate } from 'drizzle-orm/durable-sqlite/migrator'
import { logger } from '@repo/hono-helpers/logger'

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

// DurableObjectState is available in the worker environment but not exported as a type
// We use a type parameter to accept it
type DurableObjectState = {
	storage: DurableObjectStorage
	blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}

// Migration config matches what drizzle-kit generates
// migrations is imported from the migrations folder (e.g., '../drizzle/migrations')
export type SqliteMigrationConfig = Parameters<typeof drizzleMigrate>[1]

/**
 * Create a Drizzle database client for Cloudflare Durable Objects SQLite storage
 * @param storage - The Durable Object storage instance (this.state.storage)
 * @param schema - The Drizzle schema object
 * @returns A configured Drizzle database instance for SQLite
 * @example
 * ```ts
 * import { createSqliteDbClient } from '@repo/do-utils'
 * import { sqliteSchema } from './db/sqlite-schema'
 *
 * export class MyDurableObject extends DurableObject {
 *   private sqliteDb: ReturnType<typeof createSqliteDbClient<typeof sqliteSchema>>
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.sqliteDb = createSqliteDbClient(this.state.storage, sqliteSchema)
 *   }
 * }
 * ```
 */
export function createSqliteDbClient<TSchema extends Record<string, unknown>>(
	storage: DurableObjectStorage,
	schema: TSchema
): DrizzleSqliteDODatabase<TSchema> {
	return drizzle(storage, { schema })
}

/**
 * Run SQLite migrations for a Durable Object
 * Wraps migration in blockConcurrencyWhile to ensure migrations complete before queries
 * @param db - The Drizzle SQLite database instance
 * @param migrations - Migration object imported from drizzle migrations folder (e.g., '../drizzle/migrations')
 * @param state - The Durable Object state (for blockConcurrencyWhile)
 * @example
 * ```ts
 * import { createSqliteDbClient, migrateSqlite } from '@repo/do-utils'
 * import { sqliteSchema } from './db/sqlite-schema'
 * import migrations from '../.migrations-sqlite'
 *
 * export class MyDurableObject extends DurableObject {
 *   private sqliteDb: ReturnType<typeof createSqliteDbClient<typeof sqliteSchema>>
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.sqliteDb = createSqliteDbClient(this.state.storage, sqliteSchema)
 *
 *     // Run migrations in blockConcurrencyWhile to ensure they complete
 *     state.blockConcurrencyWhile(async () => {
 *       await migrateSqlite(this.sqliteDb, migrations, state)
 *     })
 *   }
 * }
 * ```
 */
export async function migrateSqlite(
	db: DrizzleSqliteDODatabase<any>,
	migrations: SqliteMigrationConfig,
	state: DurableObjectState
): Promise<void> {
	// Use blockConcurrencyWhile to ensure migrations complete before any queries
	await state.blockConcurrencyWhile(async () => {
		logger.info('[SQLite Migration] Running migrations...')

		// Drizzle durable-sqlite migrator expects the migrations object directly
		// This matches the pattern from: https://orm.drizzle.team/docs/connect-cloudflare-do
		drizzleMigrate(db, migrations)

		logger.info('[SQLite Migration] Migrations completed successfully')
	})
}

// Export type for convenience
export type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
