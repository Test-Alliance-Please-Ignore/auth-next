import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'

/**
 * Generic database client type
 */
export type DbClient<T extends Record<string, unknown> = Record<string, never>> =
	NeonHttpDatabase<T>

export type NeonTestEnv = {
	NEON_API_KEY: string
	NEON_PROJECT_ID: string
}

export type NeonTestClientFactory<
	TSchema extends Record<string, unknown>,
	Env extends NeonTestEnv,
> = (env: Env & NeonTestEnv) => DbClient<TSchema>

export type NeonTestClientFactoryRaw<Env extends NeonTestEnv> = (env: Env & NeonTestEnv) => DbClient

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
