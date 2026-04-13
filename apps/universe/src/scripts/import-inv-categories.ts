import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import { invCategories } from '../db/schema'
import { getEnglishName, prepareSdeDataDir, readSdeJsonlTable, toBoolean } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invCategories data from SDE
 */
const localizedNameSchema = z.record(z.string(), z.string())
const invCategorySchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedNameSchema]),
	iconID: z.number().nullable().optional(),
	published: z.union([z.number(), z.boolean()]),
})

const invCategoriesArraySchema = z.array(invCategorySchema)

type InvCategorySDE = z.input<typeof invCategorySchema>
type InvCategory = z.output<typeof invCategorySchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(category: InvCategory) {
	const categoryId = category._key.toString()
	return {
		categoryId,
		categoryName: getEnglishName(category.name, `Unknown Category (${categoryId})`),
		iconId: category.iconID?.toString() ?? null,
		published: toBoolean(category.published),
	}
}

/**
 * Fetch invCategories data from CCP JSONL SDE
 */
async function fetchInvCategories(): Promise<InvCategorySDE[]> {
	const sdeDataDir = await prepareSdeDataDir()
	console.log(`Reading invCategories from ${sdeDataDir}/categories.jsonl...`)
	return readSdeJsonlTable<InvCategorySDE>(sdeDataDir, 'categories.jsonl')
}

/**
 * Import invCategories data into the database
 */
async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting invCategories import...\n')

	// Fetch data from SDE
	const rawData = await fetchInvCategories()
	console.log(`Fetched ${rawData.length} invCategories entries\n`)

	// Validate and transform data
	console.log('Validating data...')
	const validatedData = invCategoriesArraySchema.parse(rawData)
	const transformedData = validatedData.map(transformToDbSchema)
	console.log(`Validated ${transformedData.length} entries\n`)

	// Create database client
	const db = createDb(databaseUrl)

	// Insert all data in one batch (only 47 entries)
	console.log('Importing to database...')

	await db
		.insert(invCategories)
		.values(transformedData)
		.onConflictDoUpdate({
			target: invCategories.categoryId,
			set: {
				categoryName: sql`excluded.category_name`,
				iconId: sql`excluded.icon_id`,
				published: sql`excluded.published`,
			},
		})

	console.log(`Progress: ${transformedData.length}/${transformedData.length} entries processed`)

	console.log('\n✓ Import completed successfully!')
	console.log(`Total entries processed: ${transformedData.length}`)
	process.exit(0)
}

main().catch((error) => {
	console.error('\n✗ Import failed:', error)
	process.exit(1)
})
