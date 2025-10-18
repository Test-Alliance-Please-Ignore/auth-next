/**
 * Represents a migration file that can be applied to a Durable Object
 */
export interface Migration {
	/** Version number (e.g., 1, 2, 3) extracted from filename */
	version: number
	/** Full filename (e.g., "001_initial_schema.sql") */
	name: string
	/** SQL content to execute */
	sql: string
	/** SHA-256 checksum of the SQL content */
	checksum: string
}

/**
 * Record of an applied migration stored in the _migrations table
 */
export interface AppliedMigration {
	version: number
	name: string
	applied_at: number
	checksum: string
	execution_time_ms: number | null
}

/**
 * Options for configuring MigratableDurableObject
 */
export interface MigrationOptions {
	/**
	 * Directory name containing migrations, relative to apps/[worker]/migrations/
	 * Example: "SessionStore" for apps/core/migrations/SessionStore/
	 */
	migrationDir: string

	/**
	 * Whether to automatically run migrations on DO initialization
	 * Default: true
	 */
	autoMigrate?: boolean

	/**
	 * Whether to log migration execution details
	 * Default: true in development, false in production
	 */
	verbose?: boolean

	/**
	 * Maximum time to wait for migration lock (ms)
	 * Default: 30000 (30 seconds)
	 */
	lockTimeout?: number
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
	/** Total number of migrations applied */
	applied: number
	/** List of migration versions that were applied */
	versions: number[]
	/** Total execution time in milliseconds */
	totalTime: number
	/** Any errors encountered (if migrations partially failed) */
	errors?: Array<{ version: number; error: string }>
}

/**
 * Status of migrations for a Durable Object
 */
export interface MigrationStatus {
	/** Migrations that have been applied */
	applied: AppliedMigration[]
	/** Migrations that are pending */
	pending: Migration[]
	/** Current schema version (highest applied migration) */
	currentVersion: number
	/** Latest available migration version */
	latestVersion: number
	/** Whether all migrations are applied */
	upToDate: boolean
}
