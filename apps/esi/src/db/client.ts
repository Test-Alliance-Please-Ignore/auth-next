import { createDbClient } from '@repo/db-utils'
import * as schema from './schema'

export type EsiDbSchema = typeof schema
export type EsiDb = ReturnType<typeof createEsiDb>

/**
 * Create a database client for the ESI app with its schema
 */
export function createEsiDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}