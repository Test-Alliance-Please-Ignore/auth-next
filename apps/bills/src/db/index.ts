import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient } from '@repo/db-utils'

export interface CreateDbOptions {
	queryTimeoutMs?: number
}

/**
 * Create a database client instance
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database client
 */
export function createDb(
	databaseUrl: string,
	options: CreateDbOptions = {}
): DbClient<typeof schema> {
	return createDbClient(
		databaseUrl,
		schema,
		options.queryTimeoutMs === undefined
			? undefined
			: {
					// Neon HTTP requests otherwise have no application-level deadline. Keep a
					// stalled request from outliving the Workflow step that owns this client.
					fetchOptions: { signal: AbortSignal.timeout(options.queryTimeoutMs) },
				}
	)
}

export type BillsDb = ReturnType<typeof createDb>

export { schema }
export type { DbClient }
