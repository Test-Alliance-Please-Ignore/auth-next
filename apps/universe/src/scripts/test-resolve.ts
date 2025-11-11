import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { inArray } from '@repo/db-utils'

import { createDb } from '../db'
import { invFlags, invGroups } from '../db/type-ids'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Test script to verify invFlags and invGroups are properly imported
 * and can be queried from the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Testing inventory data resolution...\n')

	const db = createDb(databaseUrl)

	// Test invFlags
	console.log('Testing invFlags resolution:')
	const testFlagIds = ['1', '87', '4', '999999'] // Last one doesn't exist

	const flagResults = await db
		.select()
		.from(invFlags)
		.where(inArray(invFlags.flagId, testFlagIds))

	console.log(`Requested IDs: ${testFlagIds.join(', ')}`)
	console.log(`Found ${flagResults.length} flags:`)
	for (const flag of flagResults) {
		console.log(`  - ${flag.flagId}: ${flag.flagName} (${flag.flagText})`)
	}
	console.log()

	// Test invGroups
	console.log('Testing invGroups resolution:')
	const testGroupIds = ['25', '450', '1', '999999'] // Last one doesn't exist

	const groupResults = await db
		.select()
		.from(invGroups)
		.where(inArray(invGroups.groupId, testGroupIds))

	console.log(`Requested IDs: ${testGroupIds.join(', ')}`)
	console.log(`Found ${groupResults.length} groups:`)
	for (const group of groupResults) {
		console.log(`  - ${group.groupId}: ${group.groupName} (category: ${group.categoryId})`)
	}
	console.log()

	console.log('✓ Database queries completed successfully!')
	console.log('\nNote: RPC methods in the Durable Object will cache these results in memory.')
	process.exit(0)
}

main().catch((error) => {
	console.error('\n✗ Test failed:', error)
	process.exit(1)
})
