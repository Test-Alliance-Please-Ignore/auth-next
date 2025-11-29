import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient } from '@repo/db-utils'

/**
 * Create a database client instance using WebSocket driver
 * For Durable Objects - provides connection reuse and full transaction support
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database client with WebSocket Pool
 */
export function createDb(databaseUrl: string): DbClient<typeof schema> {
	return createDbClient(databaseUrl, schema)
}

export { schema }
export type { DbClient }
