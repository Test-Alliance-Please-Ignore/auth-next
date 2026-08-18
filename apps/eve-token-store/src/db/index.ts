import { createDbClient, createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient, DbClientWs } from '@repo/db-utils'
import type { Env } from '../context'

type EveTokenStoreDbClient = DbClient<typeof schema> | DbClientWs<typeof schema>

/**
 * Create a database client instance.
 * Production uses the Neon WebSocket driver. Local Vite dev can opt into the
 * HTTP driver to avoid long-lived WebSocket pool behavior in local workerd.
 * @param databaseUrl - The Neon database connection URL
 * @param useWebSocket - Whether to use the Neon WebSocket driver
 * @returns A configured Drizzle database client
 */
export function createDb(
	ctx: Env,
	databaseUrl: string,
	useWebSocket = true
): EveTokenStoreDbClient {
	if (useWebSocket) {
		return createDbClientWs(databaseUrl, schema)
	}

	return createDbClient(databaseUrl, schema)
}

export { schema }
export type { EveTokenStoreDbClient as DbClient }
