import { neon, Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'

/**
 * Create a Drizzle database client with Neon HTTP driver
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

/**
 * Create a Drizzle database client with Neon WebSocket driver (Pool)
 * Use this for long-running contexts like Durable Objects where connection reuse is beneficial.
 * Benefits: Connection reuse, full transaction support, lower latency for multiple queries.
 * @param databaseUrl - The Neon database connection URL
 * @param schema - The Drizzle schema object
 * @returns A configured Drizzle database instance using WebSocket Pool
 */
export function createDbClientWs<TSchema extends Record<string, unknown>>(
	databaseUrl: string,
	schema: TSchema
): NeonDatabase<TSchema> {
	const pool = new Pool({ connectionString: databaseUrl })
	return drizzleWs(pool, { schema })
}

/**
 * Create a Drizzle database client without schema using WebSocket driver (for raw SQL)
 * @param databaseUrl - The Neon database connection URL
 * @returns A configured Drizzle database instance using WebSocket Pool
 */
export function createDbClientRawWs(databaseUrl: string) {
	const pool = new Pool({ connectionString: databaseUrl })
	return drizzleWs(pool)
}
