import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDb } from '../db'
import { schema } from '../db/schema'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Import EVE Online skill data from ESI API
 *
 * This script fetches skill data from EVE's ESI API and populates the database.
 * We use the ESI API directly since it's more reliable than SDE dumps.
 */

interface SDESkillCategory {
	categoryID: number
	categoryName: string
	iconID: number | null
	published: number
}

interface SDESkillGroup {
	groupID: number
	categoryID: number
	groupName: string
	iconID: number | null
	useBasePrice: boolean
	anchored: boolean
	anchorable: boolean
	fittableNonSingleton: boolean
	published: number
}

interface SDESkill {
	typeID: number
	groupID: number
	typeName: string
	description: string
	mass: number
	volume: number
	capacity: number
	portionSize: number
	raceID: number | null
	basePrice: number | null
	published: number
	marketGroupID: number | null
	iconID: number | null
	soundID: number | null
	graphicID: number | null
}

interface SDEDogmaAttribute {
	typeID: number
	attributeID: number
	value: number
}

// Attribute IDs from EVE SDE
const ATTRIBUTE_IDS = {
	PRIMARY_ATTRIBUTE: 180,
	SECONDARY_ATTRIBUTE: 181,
	SKILL_TIME_CONSTANT: 275, // Rank/difficulty
	CAN_NOT_BE_TRAINED: 1047,
	REQUIRED_SKILL_1: 182,
	REQUIRED_SKILL_1_LEVEL: 277,
	REQUIRED_SKILL_2: 183,
	REQUIRED_SKILL_2_LEVEL: 278,
	REQUIRED_SKILL_3: 184,
	REQUIRED_SKILL_3_LEVEL: 279,
	REQUIRED_SKILL_4: 1285,
	REQUIRED_SKILL_4_LEVEL: 1286,
	REQUIRED_SKILL_5: 1289,
	REQUIRED_SKILL_5_LEVEL: 1287,
	REQUIRED_SKILL_6: 1290,
	REQUIRED_SKILL_6_LEVEL: 1288,
}

const ATTRIBUTE_NAMES: Record<number, string> = {
	164: 'charisma',
	165: 'intelligence',
	166: 'memory',
	167: 'perception',
	168: 'willpower',
}

async function fetchSDEData(url: string) {
	console.log(`Fetching SDE data from ${url}...`)
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(300000), // 5 minute timeout for large files
		})
		if (!response.ok) {
			throw new Error(
				`Failed to fetch SDE data from ${url}: ${response.status} ${response.statusText}`
			)
		}
		const contentLength = response.headers.get('content-length')
		if (contentLength) {
			console.log(`  Response size: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB`)
		}
		const text = await response.text()
		console.log(`  Downloaded ${(text.length / 1024 / 1024).toFixed(2)} MB, parsing JSON...`)
		return JSON.parse(text)
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Timeout fetching ${url} - file may be too large`)
		}
		throw error
	}
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting EVE SDE skill data import...')
	const db = createDb(databaseUrl)

	try {
		// Base URL for zzeve.com's SDE JSON dumps
		const baseUrl = 'https://sde.zzeve.com'

		// Fetch categories (we only care about category 16 - Skills)
		const categories: SDESkillCategory[] = await fetchSDEData(`${baseUrl}/invCategories.json`)
		const skillCategory = categories.find((cat) => cat.categoryID === 16)

		if (!skillCategory) {
			throw new Error('Skill category not found in SDE data')
		}

		// Insert skill category
		await db
			.insert(schema.skillCategories)
			.values({
				id: skillCategory.categoryID.toString(),
				name: skillCategory.categoryName || 'Skills',
				description: 'Character Skills',
			})
			.onConflictDoUpdate({
				target: schema.skillCategories.id,
				set: {
					name: skillCategory.categoryName || 'Skills',
					updatedAt: new Date(),
				},
			})

		console.log('✓ Imported skill category')

		// Fetch groups and filter for skill groups
		const groups: SDESkillGroup[] = await fetchSDEData(`${baseUrl}/invGroups.json`)
		const skillGroups = groups.filter((group) => group.categoryID === 16 && group.published === 1)

		// Insert skill groups
		for (const group of skillGroups) {
			await db
				.insert(schema.skillGroups)
				.values({
					id: group.groupID.toString(),
					categoryId: group.categoryID.toString(),
					name: group.groupName,
					published: group.published === 1,
				})
				.onConflictDoUpdate({
					target: schema.skillGroups.id,
					set: {
						name: group.groupName,
						published: group.published === 1,
						updatedAt: new Date(),
					},
				})
		}

		console.log(`✓ Imported ${skillGroups.length} skill groups`)

		// Fetch types (skills are types in certain groups)
		const types: SDESkill[] = await fetchSDEData(`${baseUrl}/invTypes.json`)
		const skillGroupIds = new Set(skillGroups.map((g) => g.groupID))
		const skills = types.filter((type) => skillGroupIds.has(type.groupID) && type.published === 1)

		// Fetch dogma attributes for skills
		const dogmaAttributes: SDEDogmaAttribute[] = await fetchSDEData(
			`${baseUrl}/dgmTypeAttributes.json`
		)

		// Create a map of typeID -> attributes for faster lookup
		const attributesByType = new Map<number, Map<number, number>>()
		for (const attr of dogmaAttributes) {
			if (!attributesByType.has(attr.typeID)) {
				attributesByType.set(attr.typeID, new Map())
			}
			attributesByType.get(attr.typeID)!.set(attr.attributeID, attr.value)
		}

		// Process and insert skills
		const skillRequirements: Array<{
			skillId: string
			requiredSkillId: string
			requiredLevel: string
		}> = []

		for (const skill of skills) {
			const attributeMap = attributesByType.get(skill.typeID) || new Map()

			// Extract primary and secondary attributes
			const primaryAttrId = attributeMap.get(ATTRIBUTE_IDS.PRIMARY_ATTRIBUTE)
			const secondaryAttrId = attributeMap.get(ATTRIBUTE_IDS.SECONDARY_ATTRIBUTE)
			const primaryAttribute = primaryAttrId ? ATTRIBUTE_NAMES[primaryAttrId] : null
			const secondaryAttribute = secondaryAttrId ? ATTRIBUTE_NAMES[secondaryAttrId] : null

			// Extract rank (training time multiplier)
			const rank = attributeMap.get(ATTRIBUTE_IDS.SKILL_TIME_CONSTANT) || 1

			// Check if skill can be trained
			const canNotBeTrained = attributeMap.get(ATTRIBUTE_IDS.CAN_NOT_BE_TRAINED) === 1

			// Insert skill
			await db
				.insert(schema.skills)
				.values({
					id: skill.typeID.toString(),
					groupId: skill.groupID.toString(),
					name: skill.typeName,
					description: skill.description || '',
					rank: Math.round(rank).toString(),
					primaryAttribute,
					secondaryAttribute,
					published: skill.published === 1,
					canNotBeTrained,
				})
				.onConflictDoUpdate({
					target: schema.skills.id,
					set: {
						name: skill.typeName,
						description: skill.description || '',
						rank: Math.round(rank).toString(),
						primaryAttribute,
						secondaryAttribute,
						published: skill.published === 1,
						canNotBeTrained,
						updatedAt: new Date(),
					},
				})

			// Extract skill requirements
			const requirementPairs = [
				[ATTRIBUTE_IDS.REQUIRED_SKILL_1, ATTRIBUTE_IDS.REQUIRED_SKILL_1_LEVEL],
				[ATTRIBUTE_IDS.REQUIRED_SKILL_2, ATTRIBUTE_IDS.REQUIRED_SKILL_2_LEVEL],
				[ATTRIBUTE_IDS.REQUIRED_SKILL_3, ATTRIBUTE_IDS.REQUIRED_SKILL_3_LEVEL],
				[ATTRIBUTE_IDS.REQUIRED_SKILL_4, ATTRIBUTE_IDS.REQUIRED_SKILL_4_LEVEL],
				[ATTRIBUTE_IDS.REQUIRED_SKILL_5, ATTRIBUTE_IDS.REQUIRED_SKILL_5_LEVEL],
				[ATTRIBUTE_IDS.REQUIRED_SKILL_6, ATTRIBUTE_IDS.REQUIRED_SKILL_6_LEVEL],
			]

			for (const [skillAttr, levelAttr] of requirementPairs) {
				const requiredSkillId = attributeMap.get(skillAttr)
				const requiredLevel = attributeMap.get(levelAttr)

				if (requiredSkillId && requiredLevel) {
					skillRequirements.push({
						skillId: skill.typeID.toString(),
						requiredSkillId: Math.round(requiredSkillId).toString(),
						requiredLevel: Math.round(requiredLevel).toString(),
					})
				}
			}
		}

		console.log(`✓ Imported ${skills.length} skills`)

		// Insert skill requirements
		for (const req of skillRequirements) {
			await db.insert(schema.skillRequirements).values(req).onConflictDoNothing()
		}

		console.log(`✓ Imported ${skillRequirements.length} skill requirements`)

		// Record SDE version
		const sdeVersion = new Date().toISOString().split('T')[0] // Use date as version
		const checksum = createHash('sha256')
			.update(JSON.stringify({ categories: 1, groups: skillGroups.length, skills: skills.length }))
			.digest('hex')

		await db
			.insert(schema.sdeVersion)
			.values({
				version: sdeVersion,
				checksum,
			})
			.onConflictDoUpdate({
				target: schema.sdeVersion.version,
				set: {
					importedAt: new Date(),
					checksum,
				},
			})

		console.log(`✓ SDE import completed successfully (version: ${sdeVersion})`)
	} catch (error) {
		console.error('SDE import failed:', error)
		process.exit(1)
	}

	process.exit(0)
}

main()
