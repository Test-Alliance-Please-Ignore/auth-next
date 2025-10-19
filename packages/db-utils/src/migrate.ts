import { migrate as drizzleMigrate } from 'drizzle-orm/neon-http/migrator'

import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'

export interface MigrationConfig {
	migrationsFolder: string
	migrationsTable?: string
}

/**
 * Run database migrations
 * @param db - The Drizzle database instance
 * @param config - Migration configuration
 */
export async function migrate(db: NeonHttpDatabase<any>, config: MigrationConfig): Promise<void> {
	console.log(`Running migrations from ${config.migrationsFolder}...`)

	await drizzleMigrate(db, {
		migrationsFolder: config.migrationsFolder,
		migrationsTable: config.migrationsTable,
	})

	console.log('Migrations completed successfully')
}
