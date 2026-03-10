import { createDbClient, createDbClientWs } from '@repo/db-utils'

import * as schema from './schema'

import type { DbClient, DbClientWs } from '@repo/db-utils'

/**
 * Create a database client instance.
 * Uses HTTP in local development to avoid workerd CONNECT tunnel issues.
 * Uses WebSocket pool in non-local environments for connection reuse.
 * @param databaseUrl - The Neon database connection URL
 * @param environment - Runtime environment string (e.g. development, local-dev, production)
 * @returns A configured Drizzle database client
 */
export function createDb(
	databaseUrl: string,
	environment?: string
): DbClient<typeof schema> | DbClientWs<typeof schema> {
	const env = (environment ?? '').toLowerCase()
	const useHttp =
		!env || env === 'development' || env === 'local-dev' || env === 'local' || env === 'vitest'

	if (useHttp) {
		return createDbClient(databaseUrl, schema)
	}

	return createDbClientWs(databaseUrl, schema)
}

export { schema }
export type { DbClient }
