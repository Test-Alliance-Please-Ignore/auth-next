import { calculateChecksum, parseMigrationFilename } from './utils'

import type { Migration } from './types'

/**
 * Creates a migration loader function for a specific DO
 * This should be called at build time to embed migration SQL
 *
 * @param migrations - Object mapping filenames to SQL content
 * @returns Array of parsed migrations
 */
export async function loadMigrationsFromBuild(
	migrations: Record<string, string>
): Promise<Migration[]> {
	const result: Migration[] = []

	for (const [filename, sql] of Object.entries(migrations)) {
		const parsed = parseMigrationFilename(filename)
		if (!parsed) {
			console.warn(`[Migration] Skipping invalid migration filename: ${filename}`)
			continue
		}

		const checksum = await calculateChecksum(sql)
		result.push({
			version: parsed.version,
			name: parsed.name,
			sql,
			checksum,
		})
	}

	return result
}
