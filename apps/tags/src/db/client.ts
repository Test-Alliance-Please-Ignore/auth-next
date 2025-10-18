import { createDbClient } from '@repo/db-utils'
import * as schema from './schema'

export type TagsDbSchema = typeof schema
export type TagsDb = ReturnType<typeof createTagsDb>

/**
 * Create a database client for the Tags app with its schema
 */
export function createTagsDb(databaseUrl: string) {
	return createDbClient(databaseUrl, schema)
}