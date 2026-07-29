import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'

/**
 * Generic database client type (HTTP driver)
 */
export type DbClient<T extends Record<string, unknown> = Record<string, never>> =
	NeonHttpDatabase<T>

/**
 * Database client type using WebSocket driver
 */
export type DbClientWs<T extends Record<string, unknown> = Record<string, never>> = NeonDatabase<T>

/**
 * Common timestamp fields for database tables
 */
export interface TimestampFields {
	createdAt: Date
	updatedAt: Date
}

/**
 * Helper type for new entity creation (without id and timestamps)
 */
export type NewEntity<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>

/**
 * Helper type for entity updates (partial without id and timestamps)
 */
export type UpdateEntity<T> = Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>
