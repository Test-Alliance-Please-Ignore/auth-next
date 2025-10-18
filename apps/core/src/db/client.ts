import { createDbClient } from '@repo/db-utils'
import * as schema from './schema'

export type CoreDbSchema = typeof schema
export type CoreDb = ReturnType<typeof createCoreDb>

/**
 * Create a database client for the Core app with its schema
 */
export function createCoreDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}