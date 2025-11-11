import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invNames } from '../db/type-ids'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invNames data from SDE
 */
const invNameSchema = z.object({
	itemID: z.number(),
	itemName: z.string(),
})

const invNamesArraySchema = z.array(invNameSchema)

type InvNameSDE = z.input<typeof invNameSchema>
type InvNameTransformed = z.output<typeof invNameSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(name: InvNameTransformed) {
	return {
		itemId: name.itemID.toString(),
		itemName: name.itemName,
	}
}

/**
 * Fetch invNames data from EVE SDE
 */
async function fetchInvNames(): Promise<InvNameSDE[]> {
	const url = 'https://sde.zzeve.com/invNames.json'
	console.log(`Fetching invNames from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invNames: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvNameSDE[]
}

/**
 * Import invNames data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invNames import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvNames()
	console.log(`Fetched ${rawData.length} invNames entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invNamesArraySchema.parse(rawData)
	const transformedData = validatedData.map(transformToDbSchema)
	console.log(`Validated ${transformedData.length} entries\n`)

	// Create database client
	const db = createDb(databaseUrl)

	// Insert data in batches
	const BATCH_SIZE = 1000
	let imported = 0

	console.log('Importing to database...')

	for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
		const batch = transformedData.slice(i, i + BATCH_SIZE)

		// Use onConflictDoUpdate to upsert
		await db
			.insert(invNames)
			.values(batch)
			.onConflictDoUpdate({
				target: invNames.itemId,
				set: {
					itemName: batch[0].itemName, // This will be overridden by SQL
				},
			})

		imported += batch.length
		if (imported % 10000 === 0 || imported === transformedData.length) {
			console.log(`Progress: ${imported}/${transformedData.length} entries processed`)
		}
	}

	console.log('\n✓ Import completed successfully!')
	console.log(`Total entries processed: ${transformedData.length}`)
	process.exit(0)
}

main().catch((error) => {
	console.error('\n✗ Import failed:', error)
	process.exit(1)
})
