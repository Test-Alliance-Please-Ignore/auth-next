import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invGroups } from '../db/type-ids'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invGroups data from SDE
 */
const invGroupSchema = z.object({
	groupID: z.number(),
	categoryID: z.number(),
	groupName: z.string(),
	iconID: z.number().nullable(),
	useBasePrice: z.number().transform((val) => val === 1),
	anchored: z.number().transform((val) => val === 1),
	anchorable: z.number().transform((val) => val === 1),
	fittableNonSingleton: z.number().transform((val) => val === 1),
	published: z.number().transform((val) => val === 1),
})

const invGroupsArraySchema = z.array(invGroupSchema)

type InvGroupSDE = z.input<typeof invGroupSchema>
type InvGroupTransformed = z.output<typeof invGroupSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(group: InvGroupTransformed) {
	return {
		groupId: group.groupID.toString(),
		categoryId: group.categoryID.toString(),
		groupName: group.groupName,
		iconId: group.iconID?.toString() ?? null,
		useBasePrice: group.useBasePrice,
		anchored: group.anchored,
		anchorable: group.anchorable,
		fittableNonSingleton: group.fittableNonSingleton,
		published: group.published,
	}
}

/**
 * Fetch invGroups data from EVE SDE
 */
async function fetchInvGroups(): Promise<InvGroupSDE[]> {
	const url = 'https://sde.zzeve.com/invGroups.json'
	console.log(`Fetching invGroups from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invGroups: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvGroupSDE[]
}

/**
 * Import invGroups data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invGroups import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvGroups()
	console.log(`Fetched ${rawData.length} invGroups entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invGroupsArraySchema.parse(rawData)
	const transformedData = validatedData.map(transformToDbSchema)
	console.log(`Validated ${transformedData.length} entries\n`)

	// Create database client
	const db = createDb(databaseUrl)

	// Insert data in batches
	const BATCH_SIZE = 100
	let imported = 0
	let updated = 0

	console.log('Importing to database...')

	for (let i = 0; i < transformedData.length; i += BATCH_SIZE) {
		const batch = transformedData.slice(i, i + BATCH_SIZE)

		// Use onConflictDoUpdate to upsert
		await db
			.insert(invGroups)
			.values(batch)
			.onConflictDoUpdate({
				target: invGroups.groupId,
				set: {
					categoryId: batch[0].categoryId, // This will be overridden by SQL
					groupName: batch[0].groupName,
					iconId: batch[0].iconId,
					useBasePrice: batch[0].useBasePrice,
					anchored: batch[0].anchored,
					anchorable: batch[0].anchorable,
					fittableNonSingleton: batch[0].fittableNonSingleton,
					published: batch[0].published,
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
