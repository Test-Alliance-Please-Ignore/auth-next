import type { Migration } from './types'

/**
 * Calculate SHA-256 checksum of a string
 */
export async function calculateChecksum(content: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(content)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
	return hashHex
}

/**
 * Parse migration version and name from filename
 * Example: "001_initial_schema.sql" -> { version: 1, name: "001_initial_schema.sql" }
 */
export function parseMigrationFilename(filename: string): { version: number; name: string } | null {
	// Match pattern: 001_description.sql
	const match = filename.match(/^(\d{3,})_(.+)\.sql$/)
	if (!match) {
		return null
	}

	const version = parseInt(match[1], 10)
	if (isNaN(version) || version < 1) {
		return null
	}

	return {
		version,
		name: filename,
	}
}

/**
 * Sort migrations by version number
 */
export function sortMigrations(migrations: Migration[]): Migration[] {
	return [...migrations].sort((a, b) => a.version - b.version)
}

/**
 * Validate that migrations are sequential without gaps
 */
export function validateMigrationSequence(migrations: Migration[]): string | null {
	if (migrations.length === 0) {
		return null
	}

	const sorted = sortMigrations(migrations)
	for (let i = 0; i < sorted.length; i++) {
		const expectedVersion = i + 1
		if (sorted[i].version !== expectedVersion) {
			return `Missing migration version ${expectedVersion}. Found version ${sorted[i].version} instead.`
		}
	}

	return null
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toISOString()
}

/**
 * Format execution time for display
 */
export function formatExecutionTime(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`
	}
	return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Create a migration lock key for storage
 */
export function getMigrationLockKey(): string {
	return '_migration_lock'
}

/**
 * Check if a migration lock is expired
 */
export function isLockExpired(lockTimestamp: number, timeout: number): boolean {
	return Date.now() - lockTimestamp > timeout
}
