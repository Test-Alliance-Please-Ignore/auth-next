#!/usr/bin/env bun
/**
 * Migration script to move existing single directors to the new multi-director system
 *
 * This script:
 * 1. Reads all corporations from managedCorporations table
 * 2. For each corporation with an assignedCharacterId:
 *    - Creates an entry in corporationDirectors table
 *    - Marks it as healthy with priority 100 (default)
 * 3. Creates corporation config entries if they don't exist
 *
 * Prerequisites:
 * - DATABASE_URL environment variable must be set
 *
 * Run with: pnpm -F core migrate:directors
 * Or directly: cd apps/core && bun run scripts/migrate-directors.ts
 */

import { createDbClient, eq } from '@repo/db-utils'
import { schema as coreSchema } from '../src/db/schema'
import { schema as corpSchema } from '../../eve-corporation-data/src/db/schema'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
	console.error('ERROR: DATABASE_URL environment variable is required')
	process.exit(1)
}

async function migrateSingleDirectorData() {
	console.log('Starting director migration...')

	// Connect to database with both schemas
	const coreDb = createDbClient(DATABASE_URL, coreSchema)
	const corpDb = createDbClient(DATABASE_URL, corpSchema)

	console.log('Connected to databases')

	// Get all managed corporations with assigned directors
	const corporations = await coreDb.query.managedCorporations.findMany()

	console.log(`Found ${corporations.length} managed corporations`)

	let migratedCount = 0
	let skippedCount = 0
	let errorCount = 0

	for (const corp of corporations) {
		if (!corp.assignedCharacterId || !corp.assignedCharacterName) {
			console.log(`Skipping corporation ${corp.corporationId} (${corp.name}) - no assigned director`)
			skippedCount++
			continue
		}

		try {
			console.log(
				`Migrating corporation ${corp.corporationId} (${corp.name}) - director: ${corp.assignedCharacterId} (${corp.assignedCharacterName})`
			)

			// Check if corporation config exists
			const existingConfig = await corpDb.query.corporationConfig.findFirst({
				where: eq(corpSchema.corporationConfig.corporationId, Number(corp.corporationId)),
			})

			if (!existingConfig) {
				// Create corporation config if it doesn't exist
				await corpDb.insert(corpSchema.corporationConfig).values({
					corporationId: Number(corp.corporationId),
					isVerified: corp.isVerified,
					lastVerified: corp.lastVerified,
					createdAt: corp.createdAt,
					updatedAt: new Date(),
				})
				console.log(`  Created corporation config for ${corp.corporationId}`)
			}

			// Check if director already exists
			const existingDirector = await corpDb.query.corporationDirectors.findFirst({
				where: eq(corpSchema.corporationDirectors.characterId, Number(corp.assignedCharacterId)),
			})

			if (existingDirector) {
				console.log(`  Director ${corp.assignedCharacterId} already exists, skipping`)
				skippedCount++
				continue
			}

			// Insert director
			await corpDb.insert(corpSchema.corporationDirectors).values({
				corporationId: Number(corp.corporationId),
				characterId: Number(corp.assignedCharacterId),
				characterName: corp.assignedCharacterName,
				priority: 100, // Default priority
				isHealthy: corp.isVerified, // Use verification status from managedCorporations
				lastHealthCheck: corp.lastVerified,
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				createdAt: corp.createdAt,
				updatedAt: new Date(),
			})

			console.log(`  ✓ Migrated director ${corp.assignedCharacterId} for corporation ${corp.corporationId}`)
			migratedCount++
		} catch (error) {
			console.error(
				`  ✗ Error migrating corporation ${corp.corporationId}:`,
				error instanceof Error ? error.message : String(error)
			)
			errorCount++
		}
	}

	console.log('\nMigration complete!')
	console.log(`  Migrated: ${migratedCount}`)
	console.log(`  Skipped: ${skippedCount}`)
	console.log(`  Errors: ${errorCount}`)

	if (migratedCount > 0) {
		console.log('\nNOTE: You should now verify all directors by calling the verify-all endpoint for each corporation.')
	}

	process.exit(errorCount > 0 ? 1 : 0)
}

// Run migration
migrateSingleDirectorData().catch((error) => {
	console.error('Fatal error during migration:', error)
	process.exit(1)
})
