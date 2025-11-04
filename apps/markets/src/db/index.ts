import { createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClientWs } from '@repo/db-utils'

/**
 * Create a database client instance with WebSocket Pool
 * Use WebSocket client for Durable Objects to enable connection reuse
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database client with WebSocket Pool
 */
export function createDb(databaseUrl: string): DbClientWs<typeof schema> {
	return createDbClientWs(databaseUrl, schema)
}

export { schema }
export type { DbClientWs }
