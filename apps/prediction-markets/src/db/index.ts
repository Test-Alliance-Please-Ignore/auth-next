import { createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClientWs } from '@repo/db-utils'

/**
 * Create a database client instance backed by the Neon WebSocket Pool driver.
 * Built once in the Durable Object constructor so the pinned connection is
 * reused across requests and supports interactive `FOR UPDATE` transactions.
 */
export function createDb(databaseUrl: string): DbClientWs<typeof schema> {
	return createDbClientWs(databaseUrl, schema)
}

export { schema }
export type { DbClientWs as DbClient }
