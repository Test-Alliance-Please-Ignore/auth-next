import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import { invGroups } from '../db/type-ids'
import { getEnglishName, prepareSdeDataDir, readSdeJsonlTable, toBoolean } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invGroups data from SDE
 */
const localizedNameSchema = z.record(z.string(), z.string())
const invGroupSchema = z.object({
	_key: z.number(),
	categoryID: z.number(),
	name: z.union([z.string(), localizedNameSchema]),
	iconID: z.number().nullable().optional(),
	useBasePrice: z.union([z.number(), z.boolean()]),
	anchored: z.union([z.number(), z.boolean()]),
	anchorable: z.union([z.number(), z.boolean()]),
	fittableNonSingleton: z.union([z.number(), z.boolean()]),
	published: z.union([z.number(), z.boolean()]),
})

const invGroupsArraySchema = z.array(invGroupSchema)

type InvGroupSDE = z.input<typeof invGroupSchema>
type InvGroup = z.output<typeof invGroupSchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(group: InvGroup) {
	const groupId = group._key.toString()
	return {
		groupId,
		categoryId: group.categoryID.toString(),
		groupName: getEnglishName(group.name, `Unknown Group (${groupId})`),
		iconId: group.iconID?.toString() ?? null,
		useBasePrice: toBoolean(group.useBasePrice),
		anchored: toBoolean(group.anchored),
		anchorable: toBoolean(group.anchorable),
		fittableNonSingleton: toBoolean(group.fittableNonSingleton),
		published: toBoolean(group.published),
	}
}

/**
 * Fetch invGroups data from CCP JSONL SDE
 */
async function fetchInvGroups(): Promise<InvGroupSDE[]> {
	const sdeDataDir = await prepareSdeDataDir()
	console.log(`Reading invGroups from ${sdeDataDir}/groups.jsonl...`)
	return readSdeJsonlTable<InvGroupSDE>(sdeDataDir, 'groups.jsonl')
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
					categoryId: sql`excluded.category_id`,
					groupName: sql`excluded.group_name`,
					iconId: sql`excluded.icon_id`,
					useBasePrice: sql`excluded.use_base_price`,
					anchored: sql`excluded.anchored`,
					anchorable: sql`excluded.anchorable`,
					fittableNonSingleton: sql`excluded.fittable_non_singleton`,
					published: sql`excluded.published`,
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
