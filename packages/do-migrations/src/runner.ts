import {
	calculateChecksum,
	formatExecutionTime,
	getMigrationLockKey,
	isLockExpired,
	sortMigrations,
} from './utils'

import type { AppliedMigration, Migration, MigrationResult, MigrationStatus } from './types'

/**
 * Handles execution of migrations for a Durable Object
 *
 * Note: DurableObjectStorage is expected to be available as a global type
 * in the worker environment (from worker-configuration.d.ts)
 */
export class MigrationRunner {
	private storage: any // Will be DurableObjectStorage in the worker environment
	private migrations: Migration[]
	private verbose: boolean
	private lockTimeout: number

	constructor(
		storage: any, // Will be DurableObjectStorage in the worker environment
		migrations: Migration[],
		options: { verbose?: boolean; lockTimeout?: number } = {}
	) {
		this.storage = storage
		this.migrations = sortMigrations(migrations)
		this.verbose = options.verbose ?? false
		this.lockTimeout = options.lockTimeout ?? 30000
	}

	/**
	 * Initialize the migrations table if it doesn't exist
	 */
	private async initializeMigrationsTable(): Promise<void> {
		const sql = `
			CREATE TABLE IF NOT EXISTS _migrations (
				version INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at INTEGER NOT NULL,
				checksum TEXT NOT NULL,
				execution_time_ms INTEGER
			)
		`
		await this.storage.sql.exec(sql)
	}

	/**
	 * Get all applied migrations from the database
	 */
	private async getAppliedMigrations(): Promise<AppliedMigration[]> {
		interface MigrationRow extends Record<string, number | string | null> {
			version: number
			name: string
			applied_at: number
			checksum: string
			execution_time_ms: number | null
		}
		const cursor = this.storage.sql.exec(
			'SELECT version, name, applied_at, checksum, execution_time_ms FROM _migrations ORDER BY version'
		)
		const rows = cursor.toArray() as MigrationRow[]
		return rows.map((row: MigrationRow) => ({
			version: row.version,
			name: row.name as string,
			applied_at: row.applied_at,
			checksum: row.checksum as string,
			execution_time_ms: row.execution_time_ms,
		}))
	}

	/**
	 * Record that a migration has been applied
	 */
	private async recordMigration(migration: Migration, executionTime: number): Promise<void> {
		await this.storage.sql.exec(
			`INSERT INTO _migrations (version, name, applied_at, checksum, execution_time_ms)
			 VALUES (?, ?, ?, ?, ?)`,
			migration.version,
			migration.name,
			Date.now(),
			migration.checksum,
			executionTime
		)
	}

	/**
	 * Acquire a migration lock to prevent concurrent migrations
	 */
	private async acquireLock(): Promise<boolean> {
		const lockKey = getMigrationLockKey()
		const now = Date.now()

		// Try to get existing lock
		const existingLock = (await this.storage.get(lockKey)) as number | undefined
		if (existingLock && !isLockExpired(existingLock, this.lockTimeout)) {
			return false // Lock is held by another process
		}

		// Acquire the lock
		await this.storage.put(lockKey, now)
		return true
	}

	/**
	 * Release the migration lock
	 */
	private async releaseLock(): Promise<void> {
		const lockKey = getMigrationLockKey()
		await this.storage.delete(lockKey)
	}

	/**
	 * Apply a single migration
	 */
	private async applyMigration(migration: Migration): Promise<number> {
		const startTime = Date.now()

		if (this.verbose) {
			console.log(`[Migration] Applying ${migration.name}...`)
		}

		try {
			// Execute the migration SQL
			await this.storage.sql.exec(migration.sql)

			const executionTime = Date.now() - startTime

			// Record the migration
			await this.recordMigration(migration, executionTime)

			if (this.verbose) {
				console.log(
					`[Migration] Applied ${migration.name} in ${formatExecutionTime(executionTime)}`
				)
			}

			return executionTime
		} catch (error) {
			const executionTime = Date.now() - startTime
			console.error(
				`[Migration] Failed to apply ${migration.name} after ${formatExecutionTime(executionTime)}:`,
				error
			)
			throw error
		}
	}

	/**
	 * Validate that migration checksums haven't changed
	 */
	private validateChecksums(applied: AppliedMigration[]): void {
		for (const appliedMigration of applied) {
			const migration = this.migrations.find((m) => m.version === appliedMigration.version)
			if (!migration) {
				throw new Error(
					`Applied migration ${appliedMigration.name} (v${appliedMigration.version}) not found in current migrations`
				)
			}
			if (migration.checksum !== appliedMigration.checksum) {
				throw new Error(
					`Checksum mismatch for migration ${migration.name}. ` +
						`Applied checksum: ${appliedMigration.checksum}, ` +
						`Current checksum: ${migration.checksum}. ` +
						`Migrations cannot be modified after being applied.`
				)
			}
		}
	}

	/**
	 * Run all pending migrations
	 */
	async run(): Promise<MigrationResult> {
		// Acquire lock
		const lockAcquired = await this.acquireLock()
		if (!lockAcquired) {
			throw new Error('Failed to acquire migration lock. Another migration may be in progress.')
		}

		try {
			// Initialize migrations table
			await this.initializeMigrationsTable()

			// Get applied migrations
			const applied = await this.getAppliedMigrations()

			// Validate checksums
			this.validateChecksums(applied)

			// Find pending migrations
			const appliedVersions = new Set(applied.map((m) => m.version))
			const pending = this.migrations.filter((m) => !appliedVersions.has(m.version))

			if (pending.length === 0) {
				if (this.verbose) {
					console.log('[Migration] No pending migrations')
				}
				return {
					applied: 0,
					versions: [],
					totalTime: 0,
				}
			}

			// Apply pending migrations
			const result: MigrationResult = {
				applied: 0,
				versions: [],
				totalTime: 0,
				errors: [],
			}

			for (const migration of pending) {
				try {
					const executionTime = await this.applyMigration(migration)
					result.applied++
					result.versions.push(migration.version)
					result.totalTime += executionTime
				} catch (error) {
					result.errors = result.errors || []
					result.errors.push({
						version: migration.version,
						error: error instanceof Error ? error.message : String(error),
					})
					// Stop on first error
					break
				}
			}

			if (this.verbose && result.applied > 0) {
				console.log(
					`[Migration] Applied ${result.applied} migration(s) in ${formatExecutionTime(result.totalTime)}`
				)
			}

			return result
		} finally {
			// Always release lock
			await this.releaseLock()
		}
	}

	/**
	 * Get the current migration status
	 */
	async getStatus(): Promise<MigrationStatus> {
		await this.initializeMigrationsTable()
		const applied = await this.getAppliedMigrations()
		const appliedVersions = new Set(applied.map((m) => m.version))
		const pending = this.migrations.filter((m) => !appliedVersions.has(m.version))

		const currentVersion = applied.length > 0 ? Math.max(...applied.map((m) => m.version)) : 0
		const latestVersion =
			this.migrations.length > 0 ? Math.max(...this.migrations.map((m) => m.version)) : 0

		return {
			applied,
			pending,
			currentVersion,
			latestVersion,
			upToDate: pending.length === 0,
		}
	}
}
