import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invTypes } from '../db/schema'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invTypes data from SDE
 */
const invTypeSchema = z.object({
	typeID: z.number(),
	groupID: z.number(),
	typeName: z.string(),
	description: z.string(),
	mass: z.number(),
	volume: z.number(),
	capacity: z.number(),
	portionSize: z.number(),
	raceID: z.number().nullable(),
	basePrice: z.number().nullable(),
	published: z.number().transform((val) => val === 1),
	marketGroupID: z.number().nullable(),
	iconID: z.number().nullable(),
	soundID: z.number().nullable(),
	graphicID: z.number(),
})

const invTypesArraySchema = z.array(invTypeSchema)

type InvTypeSDE = z.input<typeof invTypeSchema>
type InvTypeTransformed = z.output<typeof invTypeSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(type: InvTypeTransformed) {
	return {
		typeId: type.typeID.toString(),
		groupId: type.groupID.toString(),
		typeName: type.typeName,
		description: type.description,
		mass: type.mass.toString(),
		volume: type.volume.toString(),
		capacity: type.capacity.toString(),
		portionSize: type.portionSize,
		raceId: type.raceID?.toString() ?? null,
		basePrice: type.basePrice?.toString() ?? null,
		published: type.published,
		marketGroupId: type.marketGroupID?.toString() ?? null,
		iconId: type.iconID?.toString() ?? null,
		soundId: type.soundID?.toString() ?? null,
		graphicId: type.graphicID.toString(),
	}
}

/**
 * Fetch invTypes data from EVE SDE
 */
async function fetchInvTypes(): Promise<InvTypeSDE[]> {
	const url = 'https://sde.zzeve.com/invTypes.json'
	console.log(`Fetching invTypes from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invTypes: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvTypeSDE[]
}

/**
 * Import invTypes data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invTypes import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvTypes()
	console.log(`Fetched ${rawData.length} invTypes entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invTypesArraySchema.parse(rawData)
	const transformedData = validatedData.map(transformToDbSchema)
	console.log(`Validated ${transformedData.length} entries\n`)

	// Create database client
	const db = createDb(databaseUrl)

	// Insert data in batches
	const BATCH_SIZE = 500
	let imported = 0

	console.log('Importing to database...')

	for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
		const batch = transformedData.slice(i, i + BATCH_SIZE)

		// Use onConflictDoUpdate to upsert
		await db
			.insert(invTypes)
			.values(batch)
			.onConflictDoUpdate({
				target: invTypes.typeId,
				set: {
					groupId: batch[0].groupId, // This will be overridden by SQL
					typeName: batch[0].typeName,
					description: batch[0].description,
					mass: batch[0].mass,
					volume: batch[0].volume,
					capacity: batch[0].capacity,
					portionSize: batch[0].portionSize,
					raceId: batch[0].raceId,
					basePrice: batch[0].basePrice,
					published: batch[0].published,
					marketGroupId: batch[0].marketGroupId,
					iconId: batch[0].iconId,
					soundId: batch[0].soundId,
					graphicId: batch[0].graphicId,
				},
			})

		imported += batch.length
		if (imported % 5000 === 0 || imported === transformedData.length) {
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
