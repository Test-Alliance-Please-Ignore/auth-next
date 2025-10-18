import { createDbClient } from '@repo/db-utils'
import * as schema from './schema'

export type EvessoDbSchema = typeof schema
export type EvessoDb = ReturnType<typeof createEvessoDb>

/**
 * Create a database client for the EveSSO app with its schema
 */
export function createEvessoDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}