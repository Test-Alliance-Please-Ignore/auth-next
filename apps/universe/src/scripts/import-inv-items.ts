import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invItems } from '../db/type-ids'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invItems data from SDE
 */
const invItemSchema = z.object({
	itemID: z.number(),
	typeID: z.number(),
	ownerID: z.number(),
	locationID: z.number(),
	flagID: z.number(),
	quantity: z.number(),
})

const invItemsArraySchema = z.array(invItemSchema)

type InvItemSDE = z.input<typeof invItemSchema>
type InvItemTransformed = z.output<typeof invItemSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(item: InvItemTransformed) {
	return {
		itemId: item.itemID.toString(),
		typeId: item.typeID.toString(),
		ownerId: item.ownerID.toString(),
		locationId: item.locationID.toString(),
		flagId: item.flagID.toString(),
		quantity: item.quantity.toString(),
	}
}

/**
 * Fetch invItems data from EVE SDE
 */
async function fetchInvItems(): Promise<InvItemSDE[]> {
	const url = 'https://sde.zzeve.com/invItems.json'
	console.log(`Fetching invItems from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invItems: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvItemSDE[]
}

/**
 * Import invItems data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invItems import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvItems()
	console.log(`Fetched ${rawData.length} invItems entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invItemsArraySchema.parse(rawData)
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
			.insert(invItems)
			.values(batch)
			.onConflictDoUpdate({
				target: invItems.itemId,
				set: {
					typeId: batch[0].typeId, // This will be overridden by SQL
					ownerId: batch[0].ownerId,
					locationId: batch[0].locationId,
					flagId: batch[0].flagId,
					quantity: batch[0].quantity,
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
