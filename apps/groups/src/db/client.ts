import { createDbClient } from '@repo/db-utils'
import * as schema from './schema'

export type GroupsDbSchema = typeof schema
export type GroupsDb = ReturnType<typeof createGroupsDb>

/**
 * Create a database client for the Groups app with its schema
 */
export function createGroupsDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}