/**
 * Import SDE Inventory data into database
 *
 * This script reads the EVE Online Static Data Export (SDE) JSON files
 * and imports inventory-related data into the database.
 */

import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from 'dotenv'
import { eq, sql } from 'drizzle-orm'

import { createDbClient } from '@repo/db-utils'

import { invCategories, invGroups, invTypes, marketGroups, schema, sdeVersion } from '../db/schema'

// Load environment variables - try multiple locations
config({ path: join(process.cwd(), '.env') }) // Try current working directory
config({ path: join(process.cwd(), '../../.env') }) // Try repository root from app directory
config({ path: '/Users/ozzeh/src/tapi-workers/.env' }) // Try absolute path as fallback

// SDE data directory - absolute path
const SDE_DATA_DIR = '/Users/ozzeh/src/tapi-workers/tmp/sde-data'

interface SDECategory {
	categoryID: number
	categoryName: string
	iconID?: number | null
	published: number
}

interface SDEGroup {
	groupID: number
	categoryID: number
	groupName: string
	iconID?: number | null
	useBasePrice: number
	anchored: number
	anchorable: number
	fittableNonSingleton: number
	published: number
}

interface SDEType {
	typeID: number
	groupID: number
	typeName: string
	description?: string | null
	mass: number
	volume: number
	capacity?: number
	portionSize?: number
	raceID?: number | null
	basePrice?: number | null
	published: number
	marketGroupID?: number | null
	iconID?: number | null
	soundID?: number | null
	graphicID?: number | null
}

interface SDEMarketGroup {
	marketGroupID: number
	parentGroupID?: number | null
	marketGroupName: string
	description?: string | null
	iconID?: number | null
	hasTypes: number
}

async function readJSONFile<T>(filename: string): Promise<T> {
	const filepath = join(SDE_DATA_DIR, filename)
	const content = await fs.readFile(filepath, 'utf-8')
	return JSON.parse(content)
}

async function importCategories(db: any) {
	console.log('Importing inventory categories...')
	const categories = await readJSONFile<SDECategory[]>('invCategories.json')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < categories.length; i += batchSize) {
		const batch = categories.slice(i, i + batchSize).map((cat) => ({
			categoryId: cat.categoryID.toString(),
			categoryName: cat.categoryName,
			iconId: cat.iconID || null,
			published: cat.published === 1,
		}))
		batches.push(batch)
	}

	for (const batch of batches) {
		await db
			.insert(invCategories)
			.values(batch)
			.onConflictDoUpdate({
				target: invCategories.categoryId,
				set: {
					categoryName: sql`excluded.category_name`,
					iconId: sql`excluded.icon_id`,
					published: sql`excluded.published`,
				},
			})
		count += batch.length
	}

	console.log(`  Imported ${count} categories`)
}

async function importGroups(db: any) {
	console.log('Importing inventory groups...')
	const groups = await readJSONFile<SDEGroup[]>('invGroups.json')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < groups.length; i += batchSize) {
		const batch = groups.slice(i, i + batchSize).map((grp) => ({
			groupId: grp.groupID.toString(),
			categoryId: grp.categoryID.toString(),
			groupName: grp.groupName,
			iconId: grp.iconID || null,
			useBasePrice: grp.useBasePrice === 1,
			anchored: grp.anchored === 1,
			anchorable: grp.anchorable === 1,
			fittableNonSingleton: grp.fittableNonSingleton === 1,
			published: grp.published === 1,
		}))
		batches.push(batch)
	}

	for (const batch of batches) {
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
		count += batch.length
	}

	console.log(`  Imported ${count} groups`)
}

async function importMarketGroups(db: any) {
	console.log('Importing market groups...')
	const marketGroupsData = await readJSONFile<SDEMarketGroup[]>('invMarketGroups.json')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < marketGroupsData.length; i += batchSize) {
		const batch = marketGroupsData.slice(i, i + batchSize).map((mg) => ({
			marketGroupId: mg.marketGroupID.toString(),
			parentGroupId: mg.parentGroupID?.toString() || null,
			marketGroupName: mg.marketGroupName,
			description: mg.description || null,
			iconId: mg.iconID || null,
			hasTypes: mg.hasTypes === 1,
		}))
		batches.push(batch)
	}

	for (const batch of batches) {
		await db
			.insert(marketGroups)
			.values(batch)
			.onConflictDoUpdate({
				target: marketGroups.marketGroupId,
				set: {
					parentGroupId: sql`excluded.parent_group_id`,
					marketGroupName: sql`excluded.market_group_name`,
					description: sql`excluded.description`,
					iconId: sql`excluded.icon_id`,
					hasTypes: sql`excluded.has_types`,
				},
			})
		count += batch.length
	}

	console.log(`  Imported ${count} market groups`)
}

async function importTypes(db: any) {
	console.log('Importing inventory types...')
	const types = await readJSONFile<SDEType[]>('invTypes.json')

	let count = 0
	const batchSize = 100
	const batches = []

	// Filter to only import published types to reduce dataset size
	const publishedTypes = types.filter((t) => t.published === 1)

	for (let i = 0; i < publishedTypes.length; i += batchSize) {
		const batch = publishedTypes.slice(i, i + batchSize).map((type) => ({
			typeId: type.typeID.toString(),
			groupId: type.groupID.toString(),
			typeName: type.typeName,
			description: type.description || null,
			mass: type.mass || 0,
			volume: type.volume || 0,
			capacity: type.capacity || 0,
			portionSize: type.portionSize || 1,
			raceId: type.raceID || null,
			basePrice: type.basePrice ? type.basePrice.toString() : null,
			published: type.published === 1,
			marketGroupId: type.marketGroupID?.toString() || null,
			iconId: type.iconID || null,
			soundId: type.soundID || null,
			graphicId: type.graphicID || null,
		}))
		batches.push(batch)
	}

	for (const batch of batches) {
		try {
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
			count += batch.length

			// Show progress
			if (count % 1000 === 0) {
				console.log(`    Processed ${count}/${publishedTypes.length} types...`)
			}
		} catch (error) {
			console.error(`Error importing batch starting with type ID ${batch[0].typeId}:`, error)
			// Continue with next batch
		}
	}

	console.log(`  Imported ${count} types`)
}

async function updateSDEVersion(db: any, version: string) {
	console.log('Updating SDE version...')

	await db
		.insert(sdeVersion)
		.values({
			version: version,
			importedAt: new Date(),
			checksum: null, // Could calculate a checksum of the data if needed
		})
		.onConflictDoUpdate({
			target: sdeVersion.version,
			set: {
				importedAt: new Date(),
			},
		})

	console.log(`  SDE version set to: ${version}`)
}

async function main() {
	// Use DATABASE_URL_MIGRATIONS or DATABASE_URL
	const dbUrl = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL

	if (!dbUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS or DATABASE_URL environment variable is not set')
	}

	console.log('Starting SDE inventory data import...')
	console.log(`Reading from: ${SDE_DATA_DIR}`)

	// Create database client
	const db = createDbClient(dbUrl, schema)

	try {
		// Import data in dependency order
		await importCategories(db)
		await importGroups(db)
		await importMarketGroups(db)
		await importTypes(db)

		// Update SDE version
		await updateSDEVersion(db, 'fuzzwork-latest-2024')

		console.log('\n✅ SDE inventory data import completed successfully!')
	} catch (error) {
		console.error('❌ Error importing SDE data:', error)
		process.exit(1)
	}
}

// Run the import
main().catch(console.error)
