/**
 * Import SDE Inventory data into database
 *
 * This script reads the EVE Online Static Data Export (SDE) JSON files
 * and imports inventory-related data into the database.
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { config } from 'dotenv'
import { eq, sql } from 'drizzle-orm'

import { createDbClient } from '@repo/db-utils'

import { invCategories, invGroups, invTypes, marketGroups, schema, sdeVersion } from '../db/schema'

// Load environment variables - try multiple locations
config({ path: join(process.cwd(), '.env') }) // Try current working directory
config({ path: join(process.cwd(), '../../.env') }) // Try repository root from app directory
config({ path: '/Users/ozzeh/src/tapi-workers/.env' }) // Try absolute path as fallback

const CCP_SDE_JSONL_URL =
	'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip'
const execFileAsync = promisify(execFile)

interface SDECategory {
	_key: number
	name: string | Record<string, string>
	iconID?: number | null
	published: boolean
}

interface SDEGroup {
	_key: number
	categoryID: number
	name: string | Record<string, string>
	iconID?: number | null
	useBasePrice: boolean
	anchored: boolean
	anchorable: boolean
	fittableNonSingleton: boolean
	published: boolean
}

interface SDEType {
	_key: number
	groupID: number
	name: string | Record<string, string>
	description?: string | Record<string, string> | null
	mass?: number
	volume?: number
	capacity?: number
	portionSize?: number
	raceID?: number | null
	basePrice?: number | null
	published: boolean
	marketGroupID?: number | null
	iconID?: number | null
	soundID?: number | null
	graphicID?: number | null
}

interface SDEMarketGroup {
	_key: number
	parentGroupID?: number | null
	name: string | Record<string, string>
	description?: string | Record<string, string> | null
	iconID?: number | null
	hasTypes: boolean
}

interface SDEMetadata {
	_key: string
	buildNumber?: number
	releaseDate?: string
}

function toBoolean(value: number | boolean | null | undefined): boolean {
	return value === true || value === 1
}

function getEnglishName(
	name: string | Record<string, string> | null | undefined,
	fallback = ''
): string {
	if (typeof name === 'string') {
		return name
	}
	if (name && typeof name === 'object') {
		return name.en ?? Object.values(name)[0] ?? fallback
	}
	return fallback
}

function getOptionalEnglishText(value: string | Record<string, string> | null | undefined): string | null {
	if (!value) {
		return null
	}
	return getEnglishName(value, '')
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.access(path)
		return true
	} catch {
		return false
	}
}

async function readSdeJsonlTable<T>(sdeDataDir: string, jsonlName: string): Promise<T[]> {
	const jsonlPath = join(sdeDataDir, jsonlName)
	if (!(await fileExists(jsonlPath))) {
		throw new Error(`Could not find required JSONL file ${jsonlName} in ${sdeDataDir}`)
	}

	const content = await fs.readFile(jsonlPath, 'utf-8')
	return content
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as T)
}

async function downloadFile(url: string, destinationPath: string): Promise<void> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
	}

	await fs.mkdir(dirname(destinationPath), { recursive: true })
	const fileBytes = Buffer.from(await response.arrayBuffer())
	await fs.writeFile(destinationPath, fileBytes)
}

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true })
	try {
		await execFileAsync('unzip', ['-o', zipPath, '-d', outputDir])
	} catch (error) {
		throw new Error(
			`Failed to unzip ${zipPath}. Ensure 'unzip' is installed. ` +
				`${error instanceof Error ? error.message : String(error)}`
		)
	}
}

async function findSdeDataDirectory(rootDir: string, maxDepth = 4): Promise<string | null> {
	const requiredFiles = ['_sde.jsonl', 'categories.jsonl', 'groups.jsonl', 'marketGroups.jsonl', 'types.jsonl']
	const hasRequiredFiles = await Promise.all(requiredFiles.map((name) => fileExists(join(rootDir, name))))
	if (hasRequiredFiles.every(Boolean)) {
		return rootDir
	}

	if (maxDepth <= 0) {
		return null
	}

	const entries = await fs.readdir(rootDir, { withFileTypes: true })
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue
		}
		const candidate = await findSdeDataDirectory(join(rootDir, entry.name), maxDepth - 1)
		if (candidate) {
			return candidate
		}
	}

	return null
}

async function prepareSdeDataDir(): Promise<string> {
	const configuredDir = process.env.SDE_DATA_DIR
	if (configuredDir) {
		return configuredDir
	}

	const tempRoot = join(tmpdir(), 'eve-sde-jsonl-latest')
	const zipPath = join(tempRoot, 'eve-online-static-data-latest-jsonl.zip')
	const extractRoot = join(tempRoot, 'extract')

	console.log(`SDE_DATA_DIR not set; downloading latest CCP JSONL SDE from ${CCP_SDE_JSONL_URL}`)
	await fs.mkdir(tempRoot, { recursive: true })
	await downloadFile(CCP_SDE_JSONL_URL, zipPath)

	await fs.rm(extractRoot, { recursive: true, force: true })
	await extractZip(zipPath, extractRoot)

	const detectedDir = await findSdeDataDirectory(extractRoot)
	if (!detectedDir) {
		throw new Error(
			`Unable to locate extracted SDE JSONL directory under ${extractRoot}. ` +
				`Expected files: _sde.jsonl, categories.jsonl, groups.jsonl, marketGroups.jsonl, types.jsonl`
		)
	}

	return detectedDir
}

async function resolveSdeVersionLabel(sdeDataDir: string): Promise<string> {
	const metadataPath = join(sdeDataDir, '_sde.jsonl')
	if (!(await fileExists(metadataPath))) {
		return 'sde-unknown-version'
	}

	const content = await fs.readFile(metadataPath, 'utf-8')
	const firstLine = content
		.split('\n')
		.map((line) => line.trim())
		.find((line) => line.length > 0)

	if (!firstLine) {
		return 'sde-unknown-version'
	}

	const metadata = JSON.parse(firstLine) as SDEMetadata
	const buildNumber = metadata.buildNumber ?? 'unknown-build'
	const releaseDate = metadata.releaseDate ? metadata.releaseDate.slice(0, 10) : 'unknown-date'
	return `ccp-sde-build-${buildNumber}-${releaseDate}`
}

async function importCategories(db: any, sdeDataDir: string) {
	console.log('Importing inventory categories...')
	const categories = await readSdeJsonlTable<SDECategory>(sdeDataDir, 'categories.jsonl')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < categories.length; i += batchSize) {
		const batch = categories.slice(i, i + batchSize).map((cat) => {
			const categoryId = String(cat._key)
			return {
				categoryId,
				categoryName: getEnglishName(cat.name, `Unknown Category (${categoryId})`),
				iconId: cat.iconID || null,
				published: toBoolean(cat.published),
			}
		})
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

async function importGroups(db: any, sdeDataDir: string) {
	console.log('Importing inventory groups...')
	const groups = await readSdeJsonlTable<SDEGroup>(sdeDataDir, 'groups.jsonl')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < groups.length; i += batchSize) {
		const batch = groups.slice(i, i + batchSize).map((grp) => {
			const groupId = String(grp._key)
			return {
				groupId,
				categoryId: String(grp.categoryID),
				groupName: getEnglishName(grp.name, `Unknown Group (${groupId})`),
				iconId: grp.iconID || null,
				useBasePrice: toBoolean(grp.useBasePrice),
				anchored: toBoolean(grp.anchored),
				anchorable: toBoolean(grp.anchorable),
				fittableNonSingleton: toBoolean(grp.fittableNonSingleton),
				published: toBoolean(grp.published),
			}
		})
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

async function importMarketGroups(db: any, sdeDataDir: string) {
	console.log('Importing market groups...')
	const marketGroupsData = await readSdeJsonlTable<SDEMarketGroup>(sdeDataDir, 'marketGroups.jsonl')

	let count = 0
	const batchSize = 100
	const batches = []

	for (let i = 0; i < marketGroupsData.length; i += batchSize) {
		const batch = marketGroupsData.slice(i, i + batchSize).map((mg) => {
			const marketGroupId = String(mg._key)
			return {
				marketGroupId,
				parentGroupId: mg.parentGroupID?.toString() || null,
				marketGroupName: getEnglishName(mg.name, `Unknown Market Group (${marketGroupId})`),
				description: getOptionalEnglishText(mg.description),
				iconId: mg.iconID || null,
				hasTypes: toBoolean(mg.hasTypes),
			}
		})
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

async function importTypes(db: any, sdeDataDir: string) {
	console.log('Importing inventory types...')
	const types = await readSdeJsonlTable<SDEType>(sdeDataDir, 'types.jsonl')

	let count = 0
	const batchSize = 100
	const batches = []

	// Filter to only import published types to reduce dataset size
	const publishedTypes = types.filter((t) => toBoolean(t.published))

	for (let i = 0; i < publishedTypes.length; i += batchSize) {
		const batch = publishedTypes.slice(i, i + batchSize).map((type) => {
			const typeId = String(type._key)
			return {
				typeId,
				groupId: String(type.groupID),
				typeName: getEnglishName(type.name, `Unknown Type (${typeId})`),
				description: getOptionalEnglishText(type.description),
				mass: type.mass || 0,
				volume: type.volume || 0,
				capacity: type.capacity || 0,
				portionSize: type.portionSize || 1,
				raceId: type.raceID || null,
				basePrice: type.basePrice ? type.basePrice.toString() : null,
				published: toBoolean(type.published),
				marketGroupId: type.marketGroupID?.toString() || null,
				iconId: type.iconID || null,
				soundId: type.soundID || null,
				graphicId: type.graphicID || null,
			}
		})
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

	// Create database client
	const db = createDbClient(dbUrl, schema)

	try {
		const sdeDataDir = await prepareSdeDataDir()
		console.log(`Reading SDE data from: ${sdeDataDir}`)
		const versionLabel = await resolveSdeVersionLabel(sdeDataDir)
		console.log(`Detected SDE version label: ${versionLabel}`)

		// Import data in dependency order
		await importCategories(db, sdeDataDir)
		await importGroups(db, sdeDataDir)
		await importMarketGroups(db, sdeDataDir)
		await importTypes(db, sdeDataDir)

		// Update SDE version
		await updateSDEVersion(db, versionLabel)

		console.log('\n✅ SDE inventory data import completed successfully!')
	} catch (error) {
		console.error('❌ Error importing SDE data:', error)
		process.exit(1)
	}
}

// Run the import
main().catch(console.error)
