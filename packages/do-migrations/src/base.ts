import { DurableObject } from 'cloudflare:workers'

import { MigrationRunner } from './runner'
import { calculateChecksum, parseMigrationFilename, validateMigrationSequence } from './utils'

import type { Migration, MigrationOptions, MigrationResult, MigrationStatus } from './types'

/**
 * Base class for Durable Objects with automatic migration support
 *
 * Extends DurableObject to provide RPC support while adding automatic
 * SQLite migration capabilities
 */
export abstract class MigratableDurableObject extends DurableObject<any> {
	protected storage: any // Will be DurableObjectStorage in the worker environment
	private migrationOptions: Required<MigrationOptions>
	private migrationRunner?: MigrationRunner
	private migrationResult?: MigrationResult

	constructor(ctx: any, env: unknown, options: MigrationOptions) {
		super(ctx, env)
		this.storage = ctx.storage

		// Set defaults for options
		this.migrationOptions = {
			migrationDir: options.migrationDir,
			autoMigrate: options.autoMigrate ?? true,
			verbose: options.verbose ?? false,
			lockTimeout: options.lockTimeout ?? 30000,
		}

		// Initialize migrations if autoMigrate is enabled
		if (this.migrationOptions.autoMigrate) {
			// Run migrations in the background without blocking constructor
			this.ctx.blockConcurrencyWhile(async () => {
				await this.runMigrations()
			})
		}
	}

	/**
	 * Load migrations from the migration directory
	 * This method needs to be overridden by each worker to provide the actual migrations
	 */
	protected async loadMigrations(): Promise<Migration[]> {
		// This method should be overridden in the actual implementation
		// to load migration files from the build output
		console.warn(
			`[Migration] loadMigrations() not implemented for ${this.migrationOptions.migrationDir}. ` +
				`Override this method to load migration SQL files.`
		)
		return []
	}

	/**
	 * Run all pending migrations
	 */
	async runMigrations(): Promise<MigrationResult> {
		try {
			// Load migrations
			const migrations = await this.loadMigrations()

			if (migrations.length === 0) {
				if (this.migrationOptions.verbose) {
					console.log(`[Migration] No migrations found for ${this.migrationOptions.migrationDir}`)
				}
				return {
					applied: 0,
					versions: [],
					totalTime: 0,
				}
			}

			// Validate migration sequence
			const sequenceError = validateMigrationSequence(migrations)
			if (sequenceError) {
				throw new Error(`Invalid migration sequence: ${sequenceError}`)
			}

			// Create and run migration runner
			this.migrationRunner = new MigrationRunner(this.storage, migrations, {
				verbose: this.migrationOptions.verbose,
				lockTimeout: this.migrationOptions.lockTimeout,
			})

			const result = await this.migrationRunner.run()
			this.migrationResult = result

			// Log any errors
			if (result.errors && result.errors.length > 0) {
				console.error(
					`[Migration] Encountered ${result.errors.length} error(s) during migration:`,
					result.errors
				)
			}

			return result
		} catch (error) {
			console.error(`[Migration] Failed to run migrations:`, error)
			throw error
		}
	}

	/**
	 * Get the current migration status
	 */
	async getMigrationStatus(): Promise<MigrationStatus | null> {
		if (!this.migrationRunner) {
			// If migrations haven't been run yet, create a temporary runner
			const migrations = await this.loadMigrations()
			if (migrations.length === 0) {
				return null
			}
			this.migrationRunner = new MigrationRunner(this.storage, migrations, {
				verbose: this.migrationOptions.verbose,
				lockTimeout: this.migrationOptions.lockTimeout,
			})
		}
		return this.migrationRunner.getStatus()
	}

	/**
	 * Get the result of the last migration run
	 */
	getMigrationResult(): MigrationResult | undefined {
		return this.migrationResult
	}

	/**
	 * Helper method to parse and validate migration files
	 * This can be used by subclasses when implementing loadMigrations()
	 */
	protected async parseMigrationFile(filename: string, content: string): Promise<Migration | null> {
		const parsed = parseMigrationFilename(filename)
		if (!parsed) {
			console.warn(`[Migration] Invalid migration filename: ${filename}`)
			return null
		}

		const checksum = await calculateChecksum(content)

		return {
			version: parsed.version,
			name: parsed.name,
			sql: content,
			checksum,
		}
	}
}
