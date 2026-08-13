import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { notInArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import {
	invCategories,
	invFlags,
	invGroups,
	invMarketGroups,
	invTypes,
	typeMaterials,
	universeDogmaAttributes,
	universeDogmaEffectModifiers,
	universeDogmaEffects,
	universeDogmaUnits,
	universeTypeDogmaAttributes,
	universeTypeDogmaEffects,
} from '../db/schema'
import {
	isFuelDogmaAttribute,
	isFuelModifier,
	selectStructureDogmaTypeIds,
	STRUCTURE_CATEGORY_ID,
	STRUCTURE_DOGMA_ATTRIBUTE_IDS,
	STRUCTURE_MODULE_CATEGORY_ID,
} from './sde-fuel-selection'
import {
	forEachSdeJsonlRow,
	getEnglishName,
	prepareSdeDataDir,
	readSdeJsonlTable,
	readSdeMetadata,
	toBoolean,
} from './sde-jsonl'

import type { SdeMetadata } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const localizedTextSchema = z.record(z.string(), z.string())

const invCategorySchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	iconID: z.number().nullable().optional(),
	published: z.union([z.number(), z.boolean()]),
})

const invGroupSchema = z.object({
	_key: z.number(),
	categoryID: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	iconID: z.number().nullable().optional(),
	useBasePrice: z.union([z.number(), z.boolean()]),
	anchored: z.union([z.number(), z.boolean()]),
	anchorable: z.union([z.number(), z.boolean()]),
	fittableNonSingleton: z.union([z.number(), z.boolean()]),
	published: z.union([z.number(), z.boolean()]),
})

const invMarketGroupSchema = z.object({
	_key: z.number(),
	parentGroupID: z.number().nullable().optional(),
	name: z.union([z.string(), localizedTextSchema]),
	description: z.union([z.string(), localizedTextSchema]).nullable().optional(),
	iconID: z.number().nullable().optional(),
	hasTypes: z.union([z.number(), z.boolean()]),
})

const invTypeSchema = z.object({
	_key: z.number(),
	groupID: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	description: z.union([z.string(), localizedTextSchema]).nullable().optional(),
	mass: z.number().optional(),
	volume: z.number().optional(),
	capacity: z.number().optional(),
	portionSize: z.number().optional(),
	raceID: z.number().nullable().optional(),
	basePrice: z.number().nullable().optional(),
	published: z.union([z.number(), z.boolean()]),
	marketGroupID: z.number().nullable().optional(),
	iconID: z.number().nullable().optional(),
	soundID: z.number().nullable().optional(),
	graphicID: z.number().nullable().optional(),
})

const typeMaterialSchema = z.object({
	_key: z.number(),
	materials: z
		.array(
			z.object({
				materialTypeID: z.number(),
				quantity: z.number(),
			})
		)
		.optional(),
})

const dogmaEffectSchema = z.object({
	_key: z.number(),
	name: z.string().optional(),
	description: z.union([z.string(), localizedTextSchema]).optional(),
	displayName: z.union([z.string(), localizedTextSchema]).optional(),
	effectCategoryID: z.number().nullable().optional(),
	published: z.union([z.number(), z.boolean()]).optional(),
	modifierInfo: z
		.array(
			z.object({
				domain: z.string().optional(),
				func: z.string().optional(),
				groupID: z.number().nullable().optional(),
				modifiedAttributeID: z.number().nullable().optional(),
				modifyingAttributeID: z.number().nullable().optional(),
				operation: z.number().nullable().optional(),
				skillTypeID: z.number().nullable().optional(),
			})
		)
		.optional(),
})

const dogmaUnitSchema = z.object({
	_key: z.number(),
	name: z.string(),
	description: z.union([z.string(), localizedTextSchema]).optional(),
	displayName: z.union([z.string(), localizedTextSchema]).optional(),
})

const dogmaAttributeSchema = z.object({
	_key: z.number(),
	attributeCategoryID: z.number().nullable().optional(),
	dataType: z.number().nullable().optional(),
	defaultValue: z.number().nullable().optional(),
	description: z.union([z.string(), localizedTextSchema]).optional(),
	displayName: z.union([z.string(), localizedTextSchema]).optional(),
	displayWhenZero: z.boolean().nullable().optional(),
	highIsGood: z.boolean().nullable().optional(),
	name: z.string(),
	published: z.boolean().nullable().optional(),
	stackable: z.boolean().nullable().optional(),
	unitID: z.number().nullable().optional(),
})

const typeDogmaSchema = z.object({
	_key: z.number(),
	dogmaAttributes: z
		.array(
			z.object({
				attributeID: z.number(),
				value: z.number(),
			})
		)
		.optional(),
	dogmaEffects: z
		.array(
			z.object({
				effectID: z.number(),
				isDefault: z.boolean(),
			})
		)
		.optional(),
})

type InvCategory = z.output<typeof invCategorySchema>
type InvGroup = z.output<typeof invGroupSchema>
type InvMarketGroup = z.output<typeof invMarketGroupSchema>
type InvType = z.output<typeof invTypeSchema>
type DogmaEffect = z.output<typeof dogmaEffectSchema>
type DogmaUnit = z.output<typeof dogmaUnitSchema>
type DogmaAttribute = z.output<typeof dogmaAttributeSchema>
type SeedFlag = {
	flagId: string
	flagName: string
	flagText: string
	orderId: number
}

const PROGRESS_INTERVAL = 5000
const ALL_DOGMA_FLAG = '--all-dogma'

type SeedFlagDefinition = {
	flagId: string
	sourceEffectId?: number
	fallbackName: string
	fallbackText: string
	orderId: number
}

const seedFlagDefinitions: SeedFlagDefinition[] = [
	{ flagId: '5', fallbackName: 'Cargo', fallbackText: 'Cargo hold', orderId: 5 },
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
	{ flagId: '87', fallbackName: 'Drone Bay', fallbackText: 'Drone bay', orderId: 87 },
	{ flagId: '89', fallbackName: 'Implant', fallbackText: 'Implant slot', orderId: 89 },
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
	{ flagId: '158', fallbackName: 'Fighter Bay', fallbackText: 'Fighter bay', orderId: 158 },
	{
		flagId: '164',
		sourceEffectId: 6306,
		fallbackName: 'Service Slot',
		fallbackText: 'Requires a service slot.',
		orderId: 164,
	},
]

function getOptionalEnglishText(
	value: string | Record<string, string> | null | undefined
): string | null {
	if (!value) {
		return null
	}
	return getEnglishName(value, '')
}

function createProgressReporter(typeLabel: string, total?: number): (processed: number) => void {
	let nextProgressAt = PROGRESS_INTERVAL
	return (processed: number) => {
		while (processed >= nextProgressAt && (total === undefined || total > 0)) {
			const progress =
				total === undefined ? `${processed}` : `${Math.min(processed, total)}/${total}`
			console.log(`  ... ${typeLabel}: ${progress}`)
			nextProgressAt += PROGRESS_INTERVAL
		}
	}
}

async function importCategories(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing inventory categories...')
	const raw = await readSdeJsonlTable<z.input<typeof invCategorySchema>>(
		sdeDataDir,
		'categories.jsonl'
	)
	const data = z.array(invCategorySchema).parse(raw)
	const rows = data.map((category: InvCategory) => {
		const categoryId = category._key.toString()
		return {
			categoryId,
			categoryName: getEnglishName(category.name, `Unknown Category (${categoryId})`),
			iconId: category.iconID?.toString() ?? null,
			published: toBoolean(category.published),
		}
	})

	const reportProgress = createProgressReporter('categories', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
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
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} categories`)
}

async function importGroups(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string
): Promise<Map<string, number>> {
	console.log('Importing inventory groups...')
	const raw = await readSdeJsonlTable<z.input<typeof invGroupSchema>>(sdeDataDir, 'groups.jsonl')
	const data = z.array(invGroupSchema).parse(raw)
	const structureGroupCategories = new Map(
		data
			.filter(
				(group) =>
					group.categoryID === STRUCTURE_CATEGORY_ID ||
					group.categoryID === STRUCTURE_MODULE_CATEGORY_ID
			)
			.map((group) => [group._key.toString(), group.categoryID] as const)
	)
	const rows = data.map((group: InvGroup) => {
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
	})

	const reportProgress = createProgressReporter('groups', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
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
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} groups`)
	return structureGroupCategories
}

async function importMarketGroups(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing market groups...')
	const raw = await readSdeJsonlTable<z.input<typeof invMarketGroupSchema>>(
		sdeDataDir,
		'marketGroups.jsonl'
	)
	const data = z.array(invMarketGroupSchema).parse(raw)
	const rows = data.map((marketGroup: InvMarketGroup) => {
		const marketGroupId = marketGroup._key.toString()
		return {
			marketGroupId,
			parentGroupId: marketGroup.parentGroupID?.toString() ?? null,
			marketGroupName: getEnglishName(marketGroup.name, `Unknown Market Group (${marketGroupId})`),
			description: getOptionalEnglishText(marketGroup.description),
			iconId: marketGroup.iconID?.toString() ?? null,
			hasTypes: toBoolean(marketGroup.hasTypes),
		}
	})

	const reportProgress = createProgressReporter('market groups', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(invMarketGroups)
			.values(batch)
			.onConflictDoUpdate({
				target: invMarketGroups.marketGroupId,
				set: {
					parentGroupId: sql`excluded.parent_group_id`,
					marketGroupName: sql`excluded.market_group_name`,
					description: sql`excluded.description`,
					iconId: sql`excluded.icon_id`,
					hasTypes: sql`excluded.has_types`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} market groups`)
}

async function importTypes(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	structureGroupCategories: Map<string, number>
) {
	console.log('Importing inventory types...')
	const raw = await readSdeJsonlTable<z.input<typeof invTypeSchema>>(sdeDataDir, 'types.jsonl')
	const data = z.array(invTypeSchema).parse(raw)
	const rows = data.map((type: InvType) => {
		return {
			typeId: type._key.toString(),
			groupId: type.groupID.toString(),
			typeName: getEnglishName(type.name, `Unknown Type (${type._key})`),
			description: getOptionalEnglishText(type.description) ?? '',
			mass: (type.mass ?? 0).toString(),
			volume: (type.volume ?? 0).toString(),
			capacity: (type.capacity ?? 0).toString(),
			portionSize: type.portionSize ?? 1,
			raceId: type.raceID?.toString() ?? null,
			basePrice: type.basePrice?.toString() ?? null,
			published: toBoolean(type.published),
			marketGroupId: type.marketGroupID?.toString() ?? null,
			iconId: type.iconID?.toString() ?? null,
			soundId: type.soundID?.toString() ?? null,
			graphicId: type.graphicID?.toString() ?? '0',
		}
	})
	const structureDogmaTypeIds = selectStructureDogmaTypeIds(
		structureGroupCategories,
		data.map((type) => ({ typeId: type._key.toString(), groupId: type.groupID.toString() }))
	)

	const reportProgress = createProgressReporter('types', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
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
		processed += batch.length
		reportProgress(processed)
	}

	console.log(
		`  ... fuel dogma candidates: ${structureDogmaTypeIds.structureTypeIds.size} structures, ${structureDogmaTypeIds.dogmaTypeIds.size - structureDogmaTypeIds.structureTypeIds.size} structure modules`
	)
	console.log(`  ✓ ${rows.length} types`)
	return structureDogmaTypeIds
}

async function importDogmaUnits(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing dogma units...')
	const raw = await readSdeJsonlTable<z.input<typeof dogmaUnitSchema>>(
		sdeDataDir,
		'dogmaUnits.jsonl'
	)
	const data = z.array(dogmaUnitSchema).parse(raw)
	const rows = data.map((unit: DogmaUnit) => {
		const unitId = unit._key.toString()
		return {
			unitId,
			unitName: unit.name,
			displayName: getEnglishName(unit.displayName, '') || null,
			description: getOptionalEnglishText(unit.description),
		}
	})

	const reportProgress = createProgressReporter('dogma units', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeDogmaUnits)
			.values(batch)
			.onConflictDoUpdate({
				target: universeDogmaUnits.unitId,
				set: {
					unitName: sql`excluded.unit_name`,
					displayName: sql`excluded.display_name`,
					description: sql`excluded.description`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} dogma units`)
}

async function importDogmaAttributes(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	allDogma: boolean
) {
	console.log('Importing dogma attributes...')
	const raw = await readSdeJsonlTable<z.input<typeof dogmaAttributeSchema>>(
		sdeDataDir,
		'dogmaAttributes.jsonl'
	)
	const data = z.array(dogmaAttributeSchema).parse(raw)
	const rows = data
		.filter((attribute) => isFuelDogmaAttribute(attribute._key.toString(), allDogma))
		.map((attribute: DogmaAttribute) => {
			const attributeId = attribute._key.toString()
			return {
				attributeId,
				attributeCategoryId: attribute.attributeCategoryID?.toString() ?? null,
				dataType: attribute.dataType ?? null,
				defaultValue: attribute.defaultValue?.toString() ?? null,
				attributeName: attribute.name,
				displayName: getEnglishName(attribute.displayName, '') || null,
				description: getOptionalEnglishText(attribute.description),
				displayWhenZero: attribute.displayWhenZero ?? null,
				highIsGood: attribute.highIsGood ?? null,
				published: attribute.published ?? null,
				stackable: attribute.stackable ?? null,
				unitId: attribute.unitID?.toString() ?? null,
			}
		})

	if (!allDogma) {
		await db
			.delete(universeDogmaAttributes)
			.where(notInArray(universeDogmaAttributes.attributeId, [...STRUCTURE_DOGMA_ATTRIBUTE_IDS]))
	}

	const reportProgress = createProgressReporter('dogma attributes', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeDogmaAttributes)
			.values(batch)
			.onConflictDoUpdate({
				target: universeDogmaAttributes.attributeId,
				set: {
					attributeCategoryId: sql`excluded.attribute_category_id`,
					dataType: sql`excluded.data_type`,
					defaultValue: sql`excluded.default_value`,
					attributeName: sql`excluded.attribute_name`,
					displayName: sql`excluded.display_name`,
					description: sql`excluded.description`,
					displayWhenZero: sql`excluded.display_when_zero`,
					highIsGood: sql`excluded.high_is_good`,
					published: sql`excluded.published`,
					stackable: sql`excluded.stackable`,
					unitId: sql`excluded.unit_id`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} dogma attributes`)
}

async function importDogmaEffects(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	allDogma: boolean
): Promise<Set<string>> {
	console.log('Importing dogma effects and modifiers...')
	const raw = await readSdeJsonlTable<z.input<typeof dogmaEffectSchema>>(
		sdeDataDir,
		'dogmaEffects.jsonl'
	)
	const data = z.array(dogmaEffectSchema).parse(raw)
	const fuelEffectIds = new Set(
		data
			.filter((effect) => allDogma || effect.modifierInfo?.some(isFuelModifier))
			.map((effect) => effect._key.toString())
	)
	if (!allDogma) {
		console.log(`  ... fuel dogma effects selected: ${fuelEffectIds.size}`)
	}
	const effectRows = data
		.filter((effect) => fuelEffectIds.has(effect._key.toString()))
		.map((effect: DogmaEffect) => ({
			effectId: effect._key.toString(),
			effectName: effect.name ?? `Unknown Effect (${effect._key})`,
			description: getOptionalEnglishText(effect.description),
			displayName: getEnglishName(effect.displayName, '') || null,
			effectCategoryId: effect.effectCategoryID ?? null,
			published: effect.published === undefined ? null : toBoolean(effect.published),
		}))
	const modifierRows = data.flatMap((effect: DogmaEffect) =>
		(effect.modifierInfo ?? []).flatMap((modifier, modifierIndex) =>
			allDogma || isFuelModifier(modifier)
				? [
						{
							effectId: effect._key.toString(),
							modifierIndex,
							domain: modifier.domain ?? null,
							func: modifier.func ?? null,
							groupId: modifier.groupID?.toString() ?? null,
							modifiedAttributeId: modifier.modifiedAttributeID?.toString() ?? null,
							modifyingAttributeId: modifier.modifyingAttributeID?.toString() ?? null,
							operation: modifier.operation ?? null,
							skillTypeId: modifier.skillTypeID?.toString() ?? null,
						},
					]
				: []
		)
	)

	if (!allDogma) {
		if (fuelEffectIds.size === 0) {
			await db.delete(universeDogmaEffects)
			await db.delete(universeDogmaEffectModifiers)
		} else {
			const effectIds = [...fuelEffectIds]
			await db
				.delete(universeDogmaEffects)
				.where(notInArray(universeDogmaEffects.effectId, effectIds))
			await db.delete(universeDogmaEffectModifiers)
		}
	}

	const BATCH_SIZE = 500
	const effectProgress = createProgressReporter('dogma effects', effectRows.length)
	let effectsProcessed = 0
	for (let i = 0; i < effectRows.length; i += BATCH_SIZE) {
		const batch = effectRows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeDogmaEffects)
			.values(batch)
			.onConflictDoUpdate({
				target: universeDogmaEffects.effectId,
				set: {
					effectName: sql`excluded.effect_name`,
					description: sql`excluded.description`,
					displayName: sql`excluded.display_name`,
					effectCategoryId: sql`excluded.effect_category_id`,
					published: sql`excluded.published`,
				},
			})
		effectsProcessed += batch.length
		effectProgress(effectsProcessed)
	}

	const modifierProgress = createProgressReporter('dogma modifiers', modifierRows.length)
	let modifiersProcessed = 0
	for (let i = 0; i < modifierRows.length; i += BATCH_SIZE) {
		const batch = modifierRows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeDogmaEffectModifiers)
			.values(batch)
			.onConflictDoUpdate({
				target: [universeDogmaEffectModifiers.effectId, universeDogmaEffectModifiers.modifierIndex],
				set: {
					domain: sql`excluded.domain`,
					func: sql`excluded.func`,
					groupId: sql`excluded.group_id`,
					modifiedAttributeId: sql`excluded.modified_attribute_id`,
					modifyingAttributeId: sql`excluded.modifying_attribute_id`,
					operation: sql`excluded.operation`,
					skillTypeId: sql`excluded.skill_type_id`,
				},
			})
		modifiersProcessed += batch.length
		modifierProgress(modifiersProcessed)
	}

	console.log(`  ✓ ${effectRows.length} dogma effects and ${modifierRows.length} modifiers`)
	return fuelEffectIds
}

async function importTypeDogma(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	allDogma: boolean,
	structureDogmaTypeIds: Set<string>,
	structureTypeIds: Set<string>,
	fuelEffectIds: Set<string>
) {
	console.log(
		`Importing type dogma attributes and effects (${allDogma ? 'all types' : 'structure fuel subset'})...`
	)

	if (!allDogma) {
		if (structureDogmaTypeIds.size === 0) {
			await db.delete(universeTypeDogmaAttributes)
		} else {
			await db
				.delete(universeTypeDogmaAttributes)
				.where(
					or(
						notInArray(universeTypeDogmaAttributes.typeId, [...structureDogmaTypeIds]),
						notInArray(universeTypeDogmaAttributes.attributeId, [...STRUCTURE_DOGMA_ATTRIBUTE_IDS])
					)
				)
		}

		if (structureTypeIds.size === 0 || fuelEffectIds.size === 0) {
			await db.delete(universeTypeDogmaEffects)
		} else {
			await db
				.delete(universeTypeDogmaEffects)
				.where(
					or(
						notInArray(universeTypeDogmaEffects.typeId, [...structureTypeIds]),
						notInArray(universeTypeDogmaEffects.effectId, [...fuelEffectIds])
					)
				)
		}
	}

	const BATCH_SIZE = 500
	const attributeRows: Array<{
		typeId: string
		attributeId: string
		value: string
	}> = []
	const effectRows: Array<{
		typeId: string
		effectId: string
		isDefault: boolean
	}> = []
	let attributeCount = 0
	let effectCount = 0
	let sourceRowCount = 0

	const attributeProgress = createProgressReporter('type dogma attributes')
	const effectProgress = createProgressReporter('type dogma effects')

	const flushAttributes = async () => {
		if (attributeRows.length === 0) return
		const batch = attributeRows.splice(0, attributeRows.length)
		await db
			.insert(universeTypeDogmaAttributes)
			.values(batch)
			.onConflictDoUpdate({
				target: [universeTypeDogmaAttributes.typeId, universeTypeDogmaAttributes.attributeId],
				set: { value: sql`excluded.value` },
			})
		attributeCount += batch.length
		attributeProgress(attributeCount)
	}

	const flushEffects = async () => {
		if (effectRows.length === 0) return
		const batch = effectRows.splice(0, effectRows.length)
		await db
			.insert(universeTypeDogmaEffects)
			.values(batch)
			.onConflictDoUpdate({
				target: [universeTypeDogmaEffects.typeId, universeTypeDogmaEffects.effectId],
				set: { isDefault: sql`excluded.is_default` },
			})
		effectCount += batch.length
		effectProgress(effectCount)
	}

	await forEachSdeJsonlRow<z.input<typeof typeDogmaSchema>>(
		sdeDataDir,
		'typeDogma.jsonl',
		async (raw, index) => {
			sourceRowCount = index + 1
			if (sourceRowCount % PROGRESS_INTERVAL === 0) {
				console.log(`  ... type dogma source rows: ${sourceRowCount}`)
			}

			const type = typeDogmaSchema.parse(raw)
			const typeId = type._key.toString()
			if (!allDogma && !structureDogmaTypeIds.has(typeId)) {
				return
			}

			for (const attribute of type.dogmaAttributes ?? []) {
				if (!isFuelDogmaAttribute(attribute.attributeID.toString(), allDogma)) {
					continue
				}
				attributeRows.push({
					typeId,
					attributeId: attribute.attributeID.toString(),
					value: attribute.value.toString(),
				})
				if (attributeRows.length >= BATCH_SIZE) {
					await flushAttributes()
				}
			}

			if (!allDogma && !structureTypeIds.has(typeId)) {
				return
			}
			for (const effect of type.dogmaEffects ?? []) {
				const effectId = effect.effectID.toString()
				if (!allDogma && !fuelEffectIds.has(effectId)) {
					continue
				}
				effectRows.push({ typeId, effectId, isDefault: effect.isDefault })
				if (effectRows.length >= BATCH_SIZE) {
					await flushEffects()
				}
			}
		}
	)

	await flushAttributes()
	await flushEffects()
	console.log(
		`  ✓ ${attributeCount} type dogma attributes and ${effectCount} effects from ${sourceRowCount} source rows`
	)
}

function resolveSeedFlag(
	definition: SeedFlagDefinition,
	effectsById: Map<number, DogmaEffect>
): SeedFlag {
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

async function importFlags(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing inventory flags...')
	const raw = await readSdeJsonlTable<unknown>(sdeDataDir, 'dogmaEffects.jsonl')
	const effects = raw
		.map((row) => dogmaEffectSchema.safeParse(row))
		.filter((result) => result.success)
		.map((result) => result.data)
	const effectsById = new Map(effects.map((effect) => [effect._key, effect]))
	const rows = seedFlagDefinitions.map((definition) => resolveSeedFlag(definition, effectsById))

	await db
		.insert(invFlags)
		.values(rows)
		.onConflictDoUpdate({
			target: invFlags.flagId,
			set: {
				flagName: sql`excluded.flag_name`,
				flagText: sql`excluded.flag_text`,
				orderId: sql`excluded.order_id`,
			},
		})

	console.log(`  ✓ ${rows.length} flags`)
}

async function importTypeMaterials(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing type materials...')
	const raw = await readSdeJsonlTable<z.input<typeof typeMaterialSchema>>(
		sdeDataDir,
		'typeMaterials.jsonl'
	)
	const data = z.array(typeMaterialSchema).parse(raw)

	const rows: Array<{ typeId: string; materialTypeId: string; quantity: number }> = []
	for (const entry of data) {
		if (!entry.materials) continue
		const typeId = entry._key.toString()
		for (const mat of entry.materials) {
			rows.push({ typeId, materialTypeId: mat.materialTypeID.toString(), quantity: mat.quantity })
		}
	}

	const reportProgress = createProgressReporter('type materials', rows.length)
	const BATCH_SIZE = 500
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(typeMaterials)
			.values(batch)
			.onConflictDoUpdate({
				target: [typeMaterials.typeId, typeMaterials.materialTypeId],
				set: { quantity: sql`excluded.quantity` },
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} type materials`)
}

async function storeSdeVersion(
	db: ReturnType<typeof createDb>,
	sdeMetadata: SdeMetadata | null
): Promise<void> {
	if (!sdeMetadata) {
		console.warn('  ! Skipping SDE version write: _sde.jsonl metadata missing build/release fields')
		return
	}

	await db.execute(
		sql.raw(`
		create table if not exists "sde_version" (
			"version" text primary key,
			"imported_at" timestamp with time zone not null default now(),
			"checksum" text
		)
	`)
	)
	await db.execute(
		sql.raw(`alter table "sde_version" add column if not exists "build_number" integer`)
	)
	await db.execute(
		sql.raw(
			`alter table "sde_version" add column if not exists "release_date" timestamp with time zone`
		)
	)

	await db.execute(sql`
		insert into "sde_version" ("version", "imported_at", "checksum", "build_number", "release_date")
		values (${sdeMetadata.version}, now(), null, ${sdeMetadata.buildNumber}, ${sdeMetadata.releaseDate})
		on conflict ("version") do update set
			"imported_at" = excluded."imported_at",
			"checksum" = excluded."checksum",
			"build_number" = excluded."build_number",
			"release_date" = excluded."release_date"
	`)

	console.log(
		`  ✓ SDE version recorded: ${sdeMetadata.version}${sdeMetadata.releaseDate ? ` (${sdeMetadata.releaseDate})` : ''}`
	)
}

async function main() {
	const args = new Set(process.argv.slice(2))
	if (args.has('--help')) {
		console.log(`Usage: pnpm run import:sde-inventory [${ALL_DOGMA_FLAG}]`)
		console.log('By default, only structure fuel dogma data is imported.')
		console.log(`${ALL_DOGMA_FLAG} imports all type dogma attributes and effects.`)
		return
	}
	const unknownArgs = [...args].filter((arg) => arg !== ALL_DOGMA_FLAG)
	if (unknownArgs.length > 0) {
		throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`)
	}
	const allDogma = args.has(ALL_DOGMA_FLAG)
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting SDE inventory data import...')
	console.log(`Dogma import mode: ${allDogma ? 'all data' : 'structure fuel subset'}`)
	const sdeDataDir = await prepareSdeDataDir()
	const sdeMetadata = await readSdeMetadata(sdeDataDir)
	console.log(`Reading from: ${sdeDataDir}`)

	const db = createDb(databaseUrl)

	await importCategories(db, sdeDataDir)
	const structureGroupCategories = await importGroups(db, sdeDataDir)
	await importMarketGroups(db, sdeDataDir)
	const structureDogmaTypeIds = await importTypes(db, sdeDataDir, structureGroupCategories)
	await importTypeMaterials(db, sdeDataDir)
	await importDogmaUnits(db, sdeDataDir)
	await importDogmaAttributes(db, sdeDataDir, allDogma)
	const fuelEffectIds = await importDogmaEffects(db, sdeDataDir, allDogma)
	await importTypeDogma(
		db,
		sdeDataDir,
		allDogma,
		structureDogmaTypeIds.dogmaTypeIds,
		structureDogmaTypeIds.structureTypeIds,
		fuelEffectIds
	)
	await importFlags(db, sdeDataDir)
	await storeSdeVersion(db, sdeMetadata)

	console.log('✓ SDE inventory import complete')
	process.exit(0)
}

main().catch((error) => {
	console.error('✗ Error importing SDE data:', error)
	process.exit(1)
})
