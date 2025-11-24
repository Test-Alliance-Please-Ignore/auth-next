/**
 * Import SDE Dogma (attributes) data into database
 * Imports ALL categories and attribute types
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { eq, sql } from 'drizzle-orm'
import { createDbClient } from '@repo/db-utils'
import {
	dgmAttributeCategories,
	dgmAttributeTypes,
	dgmTypeAttributes,
	schema,
} from '../db/schema'

// Load environment variables
config({ path: join(process.cwd(), '.env') })
config({ path: join(process.cwd(), '../../.env') })

interface SDEAttributeCategory {
	categoryID: number
	categoryName: string
	categoryDescription: string
}

interface SDEAttributeType {
	attributeID: number
	attributeName?: string | null
	description: string
	iconID?: number | null
	defaultValue: number
	published: number
	displayName?: string | null
	unitID?: number | null
	stackable: number
	highIsGood: number
	categoryID?: number | null
}

interface SDETypeAttribute {
	typeID: number
	attributeID: number
	valueInt?: number | null
	valueFloat?: number | null
}

async function fetchJSONFromURL<T>(url: string): Promise<T> {
	console.log(`  Fetching from ${url}...`)
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
	}
	return response.json()
}

async function importAttributeCategories(db: any): Promise<void> {
	console.log('Importing dogma attribute categories...')
	const categories = await fetchJSONFromURL<SDEAttributeCategory[]>(
		'https://sde.zzeve.com/dgmAttributeCategories.json'
	)

	console.log(`  Processing ${categories.length} categories`)

	const batch = categories.map((cat) => ({
		categoryId: cat.categoryID.toString(),
		categoryName: cat.categoryName,
		categoryDescription: cat.categoryDescription,
	}))

	if (batch.length > 0) {
		await db
			.insert(dgmAttributeCategories)
			.values(batch)
			.onConflictDoUpdate({
				target: dgmAttributeCategories.categoryId,
				set: {
					categoryName: sql`excluded.category_name`,
					categoryDescription: sql`excluded.category_description`,
				},
			})
	}

	console.log(`  Imported ${batch.length} attribute categories`)
}

async function importAttributeTypes(db: any): Promise<Set<number>> {
	console.log('Importing dogma attribute types...')
	const types = await fetchJSONFromURL<SDEAttributeType[]>(
		'https://sde.zzeve.com/dgmAttributeTypes.json'
	)

	console.log(`  Processing ${types.length} attribute types`)

	// Track valid attribute IDs for later filtering
	const validAttributeIds = new Set<number>()
	types.forEach((type) => validAttributeIds.add(type.attributeID))

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < types.length; i += batchSize) {
		const batch = types.slice(i, i + batchSize).map((type) => ({
			attributeId: type.attributeID.toString(),
			attributeName: type.attributeName || null,
			description: type.description || null, // Handle empty strings
			iconId: type.iconID || null,
			defaultValue: type.defaultValue || 0,
			published: type.published === 1,
			displayName: type.displayName || null,
			unitId: type.unitID || null,
			stackable: type.stackable === 1,
			highIsGood: type.highIsGood === 1,
			categoryId: type.categoryID?.toString() || null,
		}))
		batches.push(batch)
	}

	for (const batch of batches) {
		try {
			await db
				.insert(dgmAttributeTypes)
				.values(batch)
				.onConflictDoUpdate({
					target: dgmAttributeTypes.attributeId,
					set: {
						attributeName: sql`excluded.attribute_name`,
						description: sql`excluded.description`,
						iconId: sql`excluded.icon_id`,
						defaultValue: sql`excluded.default_value`,
						published: sql`excluded.published`,
						displayName: sql`excluded.display_name`,
						unitId: sql`excluded.unit_id`,
						stackable: sql`excluded.stackable`,
						highIsGood: sql`excluded.high_is_good`,
						categoryId: sql`excluded.category_id`,
					},
				})
			count += batch.length
		} catch (error) {
			console.error('Error importing batch:', error)
			// Continue with next batch
		}
	}

	console.log(`  Imported ${count} attribute types`)
	return validAttributeIds
}

async function importTypeAttributes(db: any, validAttributeIds: Set<number>): Promise<void> {
	console.log('Importing dogma type attributes...')
	console.log('  This is a large file (41MB) and will take some time...')

	const attributes = await fetchJSONFromURL<SDETypeAttribute[]>(
		'https://sde.zzeve.com/dgmTypeAttributes.json'
	)

	console.log(`  Processing ${attributes.length} type attributes`)

	let count = 0
	let errorCount = 0
	const batchSize = 500 // Larger batch for better performance
	const totalBatches = Math.ceil(attributes.length / batchSize)

	for (let i = 0; i < attributes.length; i += batchSize) {
		const batch = attributes.slice(i, i + batchSize).map((attr) => ({
			typeId: attr.typeID.toString(),
			attributeId: attr.attributeID.toString(),
			valueInt: attr.valueInt || null,
			valueFloat: attr.valueFloat || null,
		}))

		try {
			await db
				.insert(dgmTypeAttributes)
				.values(batch)
				.onConflictDoUpdate({
					target: [dgmTypeAttributes.typeId, dgmTypeAttributes.attributeId],
					set: {
						valueInt: sql`excluded.value_int`,
						valueFloat: sql`excluded.value_float`,
					},
				})
			count += batch.length

			// Progress indicator
			const currentBatch = Math.floor(i / batchSize) + 1
			if (currentBatch % 10 === 0 || currentBatch === totalBatches) {
				console.log(
					`    Processed ${count}/${attributes.length} attributes (batch ${currentBatch}/${totalBatches})...`
				)
			}
		} catch (error) {
			errorCount += batch.length
			console.error(
				`Error importing batch starting with typeId ${batch[0].typeId}:`,
				error
			)
			// Continue with next batch
		}
	}

	console.log(`  Imported ${count} type attributes`)
	if (errorCount > 0) {
		console.log(`  Skipped ${errorCount} attributes due to errors (likely missing typeIds)`)
	}
}

async function main() {
	const dbUrl = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL

	if (!dbUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS or DATABASE_URL environment variable is not set')
	}

	console.log('Starting SDE dogma data import...')
	console.log('Fetching data from https://sde.zzeve.com/')
	console.log('Importing ALL categories and attribute types')

	const db = createDbClient(dbUrl, schema)

	try {
		// Import in dependency order
		await importAttributeCategories(db)
		const validAttributeIds = await importAttributeTypes(db)
		await importTypeAttributes(db, validAttributeIds)

		console.log('\n✅ SDE dogma data import completed successfully!')
	} catch (error) {
		console.error('❌ Error importing SDE dogma data:', error)
		process.exit(1)
	}
}

// Run the import
main().catch(console.error)