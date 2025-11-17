import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient as BaseDbClient } from '@repo/db-utils'

/**
 * Create a database client instance
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database client
 */
export type BeancounterDb = BaseDbClient<typeof schema>

export function createDb(databaseUrl: string): BeancounterDb {
	return createDbClient(databaseUrl, schema)
}

export { schema }
export type { BaseDbClient as DbClient }
