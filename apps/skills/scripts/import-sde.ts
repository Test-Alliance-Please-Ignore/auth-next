import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { inArray } from '@repo/db-utils'

import { createDb, schema } from '../src/db'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../.env') })

/**
 * Import EVE skill catalog data.
 *
 * Note:
 * CCP reworked SDE distribution in September 2025. To keep the skill catalog
 * current and avoid depending on a stale third-party mirror format, this import
 * reads authoritative universe metadata from ESI:
 * - category 16 (Skills)
 * - skill groups
 * - skill type metadata + dogma attributes
 */

interface EsiCategory {
	category_id: number
	name: string
	published: boolean
	groups: number[]
}

interface EsiGroup {
	group_id: number
	category_id: number
	name: string
	published: boolean
	types?: number[]
}

interface EsiTypeDogmaAttribute {
	attribute_id: number
	value: number
}

interface EsiType {
	type_id: number
	group_id: number
	name: string
	description?: string
	published: boolean
	dogma_attributes?: EsiTypeDogmaAttribute[]
}

interface SdeCategory {
	categoryID: number
	categoryName: string
	published: number
}

interface SdeGroup {
	groupID: number
	categoryID: number
	groupName: string
	published: number
}

interface SdeType {
	typeID: number
	groupID: number
	typeName: string
	description: string
	published: number
}

interface SdeTypeAttribute {
	typeID: number
	attributeID: number
	valueFloat: number | null
	valueInt: number | null
}

const ESI_BASE_URL = 'https://esi.evetech.net/latest'
const SKILLS_CATEGORY_ID = 16

// Attribute IDs from EVE dogma
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

const requirementPairs: Array<[number, number]> = [
	[ATTRIBUTE_IDS.REQUIRED_SKILL_1, ATTRIBUTE_IDS.REQUIRED_SKILL_1_LEVEL],
	[ATTRIBUTE_IDS.REQUIRED_SKILL_2, ATTRIBUTE_IDS.REQUIRED_SKILL_2_LEVEL],
	[ATTRIBUTE_IDS.REQUIRED_SKILL_3, ATTRIBUTE_IDS.REQUIRED_SKILL_3_LEVEL],
	[ATTRIBUTE_IDS.REQUIRED_SKILL_4, ATTRIBUTE_IDS.REQUIRED_SKILL_4_LEVEL],
	[ATTRIBUTE_IDS.REQUIRED_SKILL_5, ATTRIBUTE_IDS.REQUIRED_SKILL_5_LEVEL],
	[ATTRIBUTE_IDS.REQUIRED_SKILL_6, ATTRIBUTE_IDS.REQUIRED_SKILL_6_LEVEL],
]

const REQUIRED_ATTRIBUTE_IDS = new Set<number>([
	ATTRIBUTE_IDS.PRIMARY_ATTRIBUTE,
	ATTRIBUTE_IDS.SECONDARY_ATTRIBUTE,
	ATTRIBUTE_IDS.SKILL_TIME_CONSTANT,
	ATTRIBUTE_IDS.CAN_NOT_BE_TRAINED,
	...requirementPairs.flat(),
])

function buildEsiUrl(path: string): string {
	const url = new URL(`${ESI_BASE_URL}${path}`)
	url.searchParams.set('datasource', 'tranquility')
	url.searchParams.set('language', 'en')
	return url.toString()
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolvePromise) => {
		setTimeout(resolvePromise, ms)
	})
}

async function fetchJsonWithRetry<T>(url: string, retries = 3): Promise<T> {
	let lastError: unknown

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(30000),
				headers: {
					Accept: 'application/json',
				},
			})

			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText}`)
			}

			return (await response.json()) as T
		} catch (error) {
			lastError = error

			if (attempt < retries) {
				await sleep(attempt * 500)
				continue
			}
		}
	}

	throw new Error(`Failed to fetch ${url}: ${String(lastError)}`)
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}

async function loadJsonFile<T>(path: string): Promise<T> {
	const content = await readFile(path, 'utf-8')
	return JSON.parse(content) as T
}

async function loadSkillDataFromSde(sdeDir: string): Promise<{
	category: EsiCategory
	groups: EsiGroup[]
	types: EsiType[]
}> {
	const invCategoriesPath = resolve(sdeDir, 'invCategories.json')
	const invGroupsPath = resolve(sdeDir, 'invGroups.json')
	const invTypesPath = resolve(sdeDir, 'invTypes.json')
	const dgmTypeAttributesPath = resolve(sdeDir, 'dgmTypeAttributes.json')

	const hasSdeFiles = await Promise.all([
		fileExists(invCategoriesPath),
		fileExists(invGroupsPath),
		fileExists(invTypesPath),
		fileExists(dgmTypeAttributesPath),
	])
	if (hasSdeFiles.some((exists) => !exists)) {
		throw new Error('required SDE files are missing')
	}

	const [categories, groups, types, typeAttributes] = await Promise.all([
		loadJsonFile<SdeCategory[]>(invCategoriesPath),
		loadJsonFile<SdeGroup[]>(invGroupsPath),
		loadJsonFile<SdeType[]>(invTypesPath),
		loadJsonFile<SdeTypeAttribute[]>(dgmTypeAttributesPath),
	])

	const skillCategory = categories.find((category) => category.categoryID === SKILLS_CATEGORY_ID)
	if (!skillCategory) {
		throw new Error(`Skill category ${SKILLS_CATEGORY_ID} not found in SDE`)
	}

	const skillGroups = groups.filter(
		(group) => group.categoryID === SKILLS_CATEGORY_ID && group.published === 1
	)
	const groupIdSet = new Set(skillGroups.map((group) => group.groupID))
	const skillTypes = types.filter((type) => type.published === 1 && groupIdSet.has(type.groupID))
	const skillTypeIdSet = new Set(skillTypes.map((type) => type.typeID))

	const attributesByTypeId = new Map<number, EsiTypeDogmaAttribute[]>()
	for (const attribute of typeAttributes) {
		if (!skillTypeIdSet.has(attribute.typeID) || !REQUIRED_ATTRIBUTE_IDS.has(attribute.attributeID)) {
			continue
		}
		const value = attribute.valueFloat ?? attribute.valueInt
		if (value == null) continue
		const existing = attributesByTypeId.get(attribute.typeID) ?? []
		existing.push({
			attribute_id: attribute.attributeID,
			value,
		})
		attributesByTypeId.set(attribute.typeID, existing)
	}

	const normalizedGroups: EsiGroup[] = skillGroups.map((group) => ({
		group_id: group.groupID,
		category_id: group.categoryID,
		name: group.groupName,
		published: true,
		types: skillTypes.filter((type) => type.groupID === group.groupID).map((type) => type.typeID),
	}))

	const normalizedTypes: EsiType[] = skillTypes.map((type) => ({
		type_id: type.typeID,
		group_id: type.groupID,
		name: type.typeName,
		description: type.description,
		published: true,
		dogma_attributes: attributesByTypeId.get(type.typeID) ?? [],
	}))

	return {
		category: {
			category_id: SKILLS_CATEGORY_ID,
			name: skillCategory.categoryName || 'Skills',
			published: skillCategory.published === 1,
			groups: normalizedGroups.map((group) => group.group_id),
		},
		groups: normalizedGroups,
		types: normalizedTypes,
	}
}

async function loadSkillDataFromEsi(): Promise<{
	category: EsiCategory
	groups: EsiGroup[]
	types: EsiType[]
}> {
	const category = await fetchJsonWithRetry<EsiCategory>(
		buildEsiUrl(`/universe/categories/${SKILLS_CATEGORY_ID}/`)
	)

	const groupResponses = await mapWithConcurrency(category.groups, 20, async (groupId) => {
		return fetchJsonWithRetry<EsiGroup>(buildEsiUrl(`/universe/groups/${groupId}/`))
	})
	const groups = groupResponses.filter(
		(group) => group.category_id === SKILLS_CATEGORY_ID && group.published
	)
	const skillTypeIds = [...new Set(groups.flatMap((group) => (group.types ?? []).map((typeId) => typeId)))]
	const types = await mapWithConcurrency(skillTypeIds, 25, async (typeId) => {
		return fetchJsonWithRetry<EsiType>(buildEsiUrl(`/universe/types/${typeId}/`))
	})

	return { category, groups, types }
}

function chunk<T>(values: T[], size: number): T[][] {
	const result: T[][] = []
	for (let i = 0; i < values.length; i += size) {
		result.push(values.slice(i, i + size))
	}
	return result
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>
): Promise<R[]> {
	const result: R[] = []

	for (const batch of chunk(items, concurrency)) {
		const batchResult = await Promise.all(batch.map((item) => mapper(item)))
		result.push(...batchResult)
	}

	return result
}

/**
 * Calculate skill points required for a specific level
 * Formula: 250 × rank × sqrt(32)^(level - 1)
 */
function calculateSkillPointsForLevel(rank: number, level: number): number {
	const sqrt32 = Math.sqrt(32)
	return Math.round(250 * rank * Math.pow(sqrt32, level - 1))
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS

	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting EVE skill catalog import...')
	const db = createDb(databaseUrl)

	const sdeDataDir = resolve(__dirname, '../../../tmp/sde-data')
	let category: EsiCategory
	let skillGroups: EsiGroup[]
	let typeResponses: EsiType[]
	try {
		;({ category, groups: skillGroups, types: typeResponses } = await loadSkillDataFromSde(sdeDataDir))
		console.log(`Using downloaded SDE files from ${sdeDataDir}`)
	} catch {
		console.log('Downloaded SDE files unavailable, falling back to ESI')
		;({ category, groups: skillGroups, types: typeResponses } = await loadSkillDataFromEsi())
	}

	await db
		.insert(schema.skillCategories)
		.values({
			id: String(category.category_id),
			name: category.name || 'Skills',
			description: 'Character Skills',
		})
		.onConflictDoUpdate({
			target: schema.skillCategories.id,
			set: {
				name: category.name || 'Skills',
				updatedAt: new Date(),
			},
		})

	console.log('✓ Imported skill category')

	// 2) Groups

	for (const group of skillGroups) {
		await db
			.insert(schema.skillGroups)
			.values({
				id: String(group.group_id),
				categoryId: String(group.category_id),
				name: group.name,
				published: group.published,
			})
			.onConflictDoUpdate({
				target: schema.skillGroups.id,
				set: {
					name: group.name,
					published: group.published,
					updatedAt: new Date(),
				},
			})
	}

	console.log(`✓ Imported ${skillGroups.length} skill groups`)

	// 3) Types/skills with dogma attributes

	const validGroupIds = new Set(skillGroups.map((group) => String(group.group_id)))
	const importedSkillIds: string[] = []
	const skillRequirementsToInsert: Array<{
		skillId: string
		requiredSkillId: string
		requiredLevel: string
	}> = []
	const skillAttributesToInsert: Array<{
		skillId: string
		attributeName: string
		attributeValue: string
	}> = []

	for (const type of typeResponses) {
		// Only keep published skill types from known skill groups.
		if (!type.published || !validGroupIds.has(String(type.group_id))) {
			continue
		}

		const attributeMap = new Map<number, number>()
		for (const attr of type.dogma_attributes ?? []) {
			attributeMap.set(attr.attribute_id, attr.value)
		}

		const primaryAttrId = attributeMap.get(ATTRIBUTE_IDS.PRIMARY_ATTRIBUTE)
		const secondaryAttrId = attributeMap.get(ATTRIBUTE_IDS.SECONDARY_ATTRIBUTE)
		const primaryAttribute = primaryAttrId ? ATTRIBUTE_NAMES[Math.round(primaryAttrId)] : null
		const secondaryAttribute = secondaryAttrId
			? ATTRIBUTE_NAMES[Math.round(secondaryAttrId)]
			: null

		const rankRaw = attributeMap.get(ATTRIBUTE_IDS.SKILL_TIME_CONSTANT) ?? 1
		const rank = Math.max(1, Math.round(rankRaw))
		const canNotBeTrained = (attributeMap.get(ATTRIBUTE_IDS.CAN_NOT_BE_TRAINED) ?? 0) >= 1

		await db
			.insert(schema.skills)
			.values({
				id: String(type.type_id),
				groupId: String(type.group_id),
				name: type.name,
				description: type.description ?? '',
				rank: String(rank),
				primaryAttribute,
				secondaryAttribute,
				published: type.published,
				canNotBeTrained,
			})
			.onConflictDoUpdate({
				target: schema.skills.id,
				set: {
					groupId: String(type.group_id),
					name: type.name,
					description: type.description ?? '',
					rank: String(rank),
					primaryAttribute,
					secondaryAttribute,
					published: type.published,
					canNotBeTrained,
					updatedAt: new Date(),
				},
			})

		importedSkillIds.push(String(type.type_id))

		// Skill points for each level (1-5)
		for (let level = 1; level <= 5; level++) {
			const skillPoints = calculateSkillPointsForLevel(rank, level)
			skillAttributesToInsert.push({
				skillId: String(type.type_id),
				attributeName: `skillPointsLevel${level}`,
				attributeValue: String(skillPoints),
			})
		}

		for (const [requiredSkillAttributeId, requiredLevelAttributeId] of requirementPairs) {
			const requiredSkillId = attributeMap.get(requiredSkillAttributeId)
			const requiredLevel = attributeMap.get(requiredLevelAttributeId)

			if (requiredSkillId == null || requiredLevel == null) {
				continue
			}

			skillRequirementsToInsert.push({
				skillId: String(type.type_id),
				requiredSkillId: String(Math.round(requiredSkillId)),
				requiredLevel: String(Math.round(requiredLevel)),
			})
		}
	}

	console.log(`✓ Imported ${importedSkillIds.length} skills`)

	// 4) Replace dependent rows for imported skills only to avoid stale requirements.
	if (importedSkillIds.length > 0) {
		await db
			.delete(schema.skillRequirements)
			.where(inArray(schema.skillRequirements.skillId, importedSkillIds))
		await db
			.delete(schema.skillAttributes)
			.where(inArray(schema.skillAttributes.skillId, importedSkillIds))
	}

	for (const req of skillRequirementsToInsert) {
		await db.insert(schema.skillRequirements).values(req).onConflictDoNothing()
	}
	console.log(`✓ Imported ${skillRequirementsToInsert.length} skill requirements`)

	for (const attr of skillAttributesToInsert) {
		await db.insert(schema.skillAttributes).values(attr).onConflictDoNothing()
	}
	console.log(`✓ Imported ${skillAttributesToInsert.length} skill attributes`)

	console.log('✅ Skill catalog import completed')
	process.exit(0)
}

main().catch((error) => {
	console.error('Skill import failed:', error)
	process.exit(1)
})
