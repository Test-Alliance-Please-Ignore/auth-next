import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'

/**
 * Create a Drizzle database client with Neon serverless driver
 * @param databaseUrl - The Neon database connection URL
 * @param schema - The Drizzle schema object
 * @returns A configured Drizzle database instance
 */
export function createDbClient<TSchema extends Record<string, unknown>>(
	databaseUrl: string,
	schema: TSchema
): NeonHttpDatabase<TSchema> {
	const sql = neon(databaseUrl)
	return drizzle(sql, { schema })
}

/**
 * Create a Drizzle database client without schema (for raw SQL)
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database instance
 */
export function createDbClientRaw(databaseUrl: string) {
	const sql = neon(databaseUrl)
	return drizzle(sql)
}