import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import { invFlags } from '../db/type-ids'
import { getEnglishName, prepareSdeDataDir, readSdeJsonlTable } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const localizedTextSchema = z.record(z.string(), z.string())
const dogmaEffectSchema = z.object({
	_key: z.number(),
	name: z.string().optional(),
	description: z.union([z.string(), localizedTextSchema]).optional(),
	displayName: z.union([z.string(), localizedTextSchema]).optional(),
})

type DogmaEffect = z.output<typeof dogmaEffectSchema>

type SeedFlag = {
	flagId: string
	flagName: string
	flagText: string
	orderId: number
}

type SeedFlagDefinition = {
	flagId: string
	sourceEffectId?: number
	fallbackName: string
	fallbackText: string
	orderId: number
}

const seedFlagDefinitions: SeedFlagDefinition[] = [
	{
		flagId: '5',
		fallbackName: 'Cargo',
		fallbackText: 'Cargo hold',
		orderId: 5,
	},
	{
		flagId: '11',
		sourceEffectId: 11,
		fallbackName: 'Low Slot',
		fallbackText: 'Requires a low power slot',
		orderId: 11,
	},
	{
		flagId: '19',
		sourceEffectId: 13,
		fallbackName: 'Mid Slot',
		fallbackText: 'Requires a medium power slot',
		orderId: 19,
	},
	{
		flagId: '27',
		sourceEffectId: 12,
		fallbackName: 'High Slot',
		fallbackText: 'Requires a high power slot',
		orderId: 27,
	},
	{
		flagId: '87',
		fallbackName: 'Drone Bay',
		fallbackText: 'Drone bay',
		orderId: 87,
	},
	{
		flagId: '89',
		fallbackName: 'Implant',
		fallbackText: 'Implant slot',
		orderId: 89,
	},
	{
		flagId: '92',
		sourceEffectId: 2663,
		fallbackName: 'Rig Slot',
		fallbackText: 'Must be installed into an open rig slot',
		orderId: 92,
	},
	{
		flagId: '125',
		sourceEffectId: 3772,
		fallbackName: 'Subsystem Slot',
		fallbackText: 'Must be installed into an available subsystem slot on a Tech III ship.',
		orderId: 125,
	},
	{
		flagId: '158',
		fallbackName: 'Fighter Bay',
		fallbackText: 'Fighter bay',
		orderId: 158,
	},
	{
		flagId: '164',
		sourceEffectId: 6306,
		fallbackName: 'Service Slot',
		fallbackText: 'Requires a service slot.',
		orderId: 164,
	},
]

function resolveSeedFlag(definition: SeedFlagDefinition, effectsById: Map<number, DogmaEffect>): SeedFlag {
	const effect = definition.sourceEffectId ? effectsById.get(definition.sourceEffectId) : undefined
	const resolvedName = getEnglishName(effect?.displayName, definition.fallbackName)
	const resolvedText = getEnglishName(effect?.description, definition.fallbackText)

	return {
		flagId: definition.flagId,
		flagName: resolvedName,
		flagText: resolvedText,
		orderId: definition.orderId,
	}
}

async function buildFlagsFromCcpSde(): Promise<SeedFlag[]> {
	const sdeDataDir = await prepareSdeDataDir()
	console.log(`Reading invFlags source data from ${sdeDataDir}/dogmaEffects.jsonl...`)

	const dogmaEffectsRaw = await readSdeJsonlTable<unknown>(sdeDataDir, 'dogmaEffects.jsonl')
	const dogmaEffects = dogmaEffectsRaw
		.map((row) => dogmaEffectSchema.safeParse(row))
		.filter((result) => result.success)
		.map((result) => result.data)
	const effectsById = new Map(dogmaEffects.map((effect) => [effect._key, effect]))

	return seedFlagDefinitions.map((definition) => resolveSeedFlag(definition, effectsById))
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

	// Build flag dataset from CCP SDE JSONL
	const transformedData = await buildFlagsFromCcpSde()
	console.log(`Prepared ${transformedData.length} invFlags entries\n`)

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
					flagName: sql`excluded.flag_name`,
					flagText: sql`excluded.flag_text`,
					orderId: sql`excluded.order_id`,
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
