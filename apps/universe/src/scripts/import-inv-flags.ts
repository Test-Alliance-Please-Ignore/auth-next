import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invFlags } from '../db/type-ids'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invFlags data from SDE
 */
const invFlagSchema = z.object({
	flagID: z.number(),
	flagName: z.string(),
	flagText: z.string(),
	orderID: z.number(),
})

const invFlagsArraySchema = z.array(invFlagSchema)

type InvFlagSDE = z.input<typeof invFlagSchema>
type InvFlagTransformed = z.output<typeof invFlagSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(flag: InvFlagTransformed) {
	return {
		flagId: flag.flagID.toString(),
		flagName: flag.flagName,
		flagText: flag.flagText,
		orderId: flag.orderID,
	}
}

/**
 * Fetch invFlags data from EVE SDE
 */
async function fetchInvFlags(): Promise<InvFlagSDE[]> {
	const url = 'https://sde.zzeve.com/invFlags.json'
	console.log(`Fetching invFlags from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invFlags: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvFlagSDE[]
}

/**
 * Import invFlags data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invFlags import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvFlags()
	console.log(`Fetched ${rawData.length} invFlags entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invFlagsArraySchema.parse(rawData)
	const transformedData = validatedData.map(transformToDbSchema)
	console.log(`Validated ${transformedData.length} entries\n`)

	// Create database client
	const db = createDb(databaseUrl)

	// Insert data in batches
	const BATCH_SIZE = 100
	let imported = 0

	console.log('Importing to database...')

	for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
		const batch = transformedData.slice(i, i + BATCH_SIZE)

		// Use onConflictDoUpdate to upsert
		await db
			.insert(invFlags)
			.values(batch)
			.onConflictDoUpdate({
				target: invFlags.flagId,
				set: {
					flagName: batch[0].flagName, // This will be overridden by SQL
					flagText: batch[0].flagText,
					orderId: batch[0].orderId,
				},
			})

		imported += batch.length
		if (imported % 100 === 0 || imported === transformedData.length) {
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
