import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import { invTypes } from '../db/schema'
import { getEnglishName, prepareSdeDataDir, readSdeJsonlTable, toBoolean } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invTypes data from SDE
 */
const localizedTextSchema = z.record(z.string(), z.string())
const invTypeSchema = z.object({
	_key: z.number(),
	groupID: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	description: z.union([z.string(), localizedTextSchema]).nullable().optional(),
	mass: z.number().optional(),
	volume: z.number().optional(),
	capacity: z.number().optional(),
	portionSize: z.number().optional(),
	raceID: z.number().nullable().optional(),
	basePrice: z.number().nullable().optional(),
	published: z.union([z.number(), z.boolean()]),
	marketGroupID: z.number().nullable().optional(),
	iconID: z.number().nullable().optional(),
	soundID: z.number().nullable().optional(),
	graphicID: z.number().nullable().optional(),
})

const invTypesArraySchema = z.array(invTypeSchema)

type InvTypeSDE = z.input<typeof invTypeSchema>
type InvType = z.output<typeof invTypeSchema>

function getOptionalEnglishText(
	value: string | Record<string, string> | null | undefined
): string {
	if (!value) {
		return ''
	}
	return getEnglishName(value, '')
}

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(type: InvType) {
	const typeId = type._key.toString()
	return {
		typeId,
		groupId: type.groupID.toString(),
		typeName: getEnglishName(type.name, `Unknown Type (${typeId})`),
		description: getOptionalEnglishText(type.description),
		mass: (type.mass ?? 0).toString(),
		volume: (type.volume ?? 0).toString(),
		capacity: (type.capacity ?? 0).toString(),
		portionSize: type.portionSize ?? 1,
		raceId: type.raceID?.toString() ?? null,
		basePrice: type.basePrice?.toString() ?? null,
		published: toBoolean(type.published),
		marketGroupId: type.marketGroupID?.toString() ?? null,
		iconId: type.iconID?.toString() ?? null,
		soundId: type.soundID?.toString() ?? null,
		graphicId: type.graphicID?.toString() ?? '0',
	}
}

/**
 * Fetch invTypes data from CCP JSONL SDE
 */
async function fetchInvTypes(): Promise<InvTypeSDE[]> {
	const sdeDataDir = await prepareSdeDataDir()
	console.log(`Reading invTypes from ${sdeDataDir}/types.jsonl...`)
	return readSdeJsonlTable<InvTypeSDE>(sdeDataDir, 'types.jsonl')
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
					groupId: sql`excluded.group_id`,
					typeName: sql`excluded.type_name`,
					description: sql`excluded.description`,
					mass: sql`excluded.mass`,
					volume: sql`excluded.volume`,
					capacity: sql`excluded.capacity`,
					portionSize: sql`excluded.portion_size`,
					raceId: sql`excluded.race_id`,
					basePrice: sql`excluded.base_price`,
					published: sql`excluded.published`,
					marketGroupId: sql`excluded.market_group_id`,
					iconId: sql`excluded.icon_id`,
					soundId: sql`excluded.sound_id`,
					graphicId: sql`excluded.graphic_id`,
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
