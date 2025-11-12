import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

import { createDb } from '../db'
import { invCategories } from '../db/schema'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Zod schema for validating invCategories data from SDE
 */
const invCategorySchema = z.object({
	categoryID: z.number(),
	categoryName: z.string(),
	iconID: z.number().nullable(),
	published: z.number().transform((val) => val === 1),
})

const invCategoriesArraySchema = z.array(invCategorySchema)

type InvCategorySDE = z.input<typeof invCategorySchema>
type InvCategoryTransformed = z.output<typeof invCategorySchema>

/**
 * Transform SDE data to database schema
 */
function transformToDbSchema(category: InvCategoryTransformed) {
	return {
		categoryId: category.categoryID.toString(),
		categoryName: category.categoryName,
		iconId: category.iconID?.toString() ?? null,
		published: category.published,
	}
}

/**
 * Fetch invCategories data from EVE SDE
 */
async function fetchInvCategories(): Promise<InvCategorySDE[]> {
	const url = 'https://sde.zzeve.com/invCategories.json'
	console.log(`Fetching invCategories from ${url}...`)

	const response = await fetch(url)

	if (!response.ok) {
		throw new Error(`Failed to fetch invCategories: ${response.status} ${response.statusText}`)
	}

	const data = await response.json()
	return data as InvCategorySDE[]
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
				categoryName: transformedData[0].categoryName, // This will be overridden by SQL
				iconId: transformedData[0].iconId,
				published: transformedData[0].published,
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
