import { migrate as drizzleMigrateHttp } from 'drizzle-orm/neon-http/migrator'
import { migrate as drizzleMigrateWs } from 'drizzle-orm/neon-serverless/migrator'

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type { NeonDatabase } from 'drizzle-orm/neon-serverless'

export interface MigrationConfig {
	migrationsFolder: string
	migrationsTable?: string
}

/**
 * Run database migrations (HTTP client)
 * @param db - The Drizzle database instance
 * @param config - Migration configuration
 */
export async function migrate(db: NeonHttpDatabase<any>, config: MigrationConfig): Promise<void> {
	console.log(`Running migrations from ${config.migrationsFolder}...`)

	await drizzleMigrateHttp(db, {
		migrationsFolder: config.migrationsFolder,
		migrationsTable: config.migrationsTable,
	})

	console.log('Migrations completed successfully')
}

/**
 * Run database migrations (WebSocket client)
 * @param db - The Drizzle database instance
 * @param config - Migration configuration
 */
export async function migrateWs(db: NeonDatabase<any>, config: MigrationConfig): Promise<void> {
	console.log(`Running migrations from ${config.migrationsFolder}...`)

	await drizzleMigrateWs(db, {
		migrationsFolder: config.migrationsFolder,
		migrationsTable: config.migrationsTable,
	})

	console.log('Migrations completed successfully')
}
