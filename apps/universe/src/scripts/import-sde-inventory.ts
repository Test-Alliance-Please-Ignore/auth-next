import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
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
type TypeDogma = z.output<typeof typeDogmaSchema>

type SeedFlag = {
	flagId: string
	flagName: string
	flagText: string
	orderId: number
}

const PROGRESS_INTERVAL = 5000

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

function createProgressReporter(typeLabel: string, total: number): (processed: number) => void {
	let nextProgressAt = PROGRESS_INTERVAL
	return (processed: number) => {
		while (processed >= nextProgressAt && total > 0) {
			console.log(`  ... ${typeLabel}: ${Math.min(processed, total)}/${total}`)
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

async function importGroups(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing inventory groups...')
	const raw = await readSdeJsonlTable<z.input<typeof invGroupSchema>>(sdeDataDir, 'groups.jsonl')
	const data = z.array(invGroupSchema).parse(raw)
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

async function importTypes(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing inventory types...')
	const raw = await readSdeJsonlTable<z.input<typeof invTypeSchema>>(sdeDataDir, 'types.jsonl')
	const data = z.array(invTypeSchema).parse(raw)
	const rows = data.map((type: InvType) => {
		const typeId = type._key.toString()
		return {
			typeId,
			groupId: type.groupID.toString(),
			typeName: getEnglishName(type.name, `Unknown Type (${typeId})`),
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

	console.log(`  ✓ ${rows.length} types`)
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

async function importDogmaAttributes(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing dogma attributes...')
	const raw = await readSdeJsonlTable<z.input<typeof dogmaAttributeSchema>>(
		sdeDataDir,
		'dogmaAttributes.jsonl'
	)
	const data = z.array(dogmaAttributeSchema).parse(raw)
	const rows = data.map((attribute: DogmaAttribute) => {
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

async function importDogmaEffects(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing dogma effects and modifiers...')
	const raw = await readSdeJsonlTable<z.input<typeof dogmaEffectSchema>>(
		sdeDataDir,
		'dogmaEffects.jsonl'
	)
	const data = z.array(dogmaEffectSchema).parse(raw)
	const effectRows = data.map((effect: DogmaEffect) => ({
		effectId: effect._key.toString(),
		effectName: effect.name ?? `Unknown Effect (${effect._key})`,
		description: getOptionalEnglishText(effect.description),
		displayName: getEnglishName(effect.displayName, '') || null,
		effectCategoryId: effect.effectCategoryID ?? null,
		published: effect.published === undefined ? null : toBoolean(effect.published),
	}))
	const modifierRows = data.flatMap((effect: DogmaEffect) =>
		(effect.modifierInfo ?? []).map((modifier, modifierIndex) => ({
			effectId: effect._key.toString(),
			modifierIndex,
			domain: modifier.domain ?? null,
			func: modifier.func ?? null,
			groupId: modifier.groupID?.toString() ?? null,
			modifiedAttributeId: modifier.modifiedAttributeID?.toString() ?? null,
			modifyingAttributeId: modifier.modifyingAttributeID?.toString() ?? null,
			operation: modifier.operation ?? null,
			skillTypeId: modifier.skillTypeID?.toString() ?? null,
		}))
	)

	const BATCH_SIZE = 500
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
	}

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
	}

	console.log(`  ✓ ${effectRows.length} dogma effects and ${modifierRows.length} modifiers`)
}

async function importTypeDogma(db: ReturnType<typeof createDb>, sdeDataDir: string) {
	console.log('Importing type dogma attributes and effects...')
	const raw = await readSdeJsonlTable<z.input<typeof typeDogmaSchema>>(
		sdeDataDir,
		'typeDogma.jsonl'
	)
	const data = z.array(typeDogmaSchema).parse(raw)
	const attributeRows = data.flatMap((type: TypeDogma) =>
		(type.dogmaAttributes ?? []).map((attribute) => ({
			typeId: type._key.toString(),
			attributeId: attribute.attributeID.toString(),
			value: attribute.value.toString(),
		}))
	)
	const effectRows = data.flatMap((type: TypeDogma) =>
		(type.dogmaEffects ?? []).map((effect) => ({
			typeId: type._key.toString(),
			effectId: effect.effectID.toString(),
			isDefault: effect.isDefault,
		}))
	)

	const BATCH_SIZE = 500
	for (let i = 0; i < attributeRows.length; i += BATCH_SIZE) {
		const batch = attributeRows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeTypeDogmaAttributes)
			.values(batch)
			.onConflictDoUpdate({
				target: [universeTypeDogmaAttributes.typeId, universeTypeDogmaAttributes.attributeId],
				set: { value: sql`excluded.value` },
			})
	}

	for (let i = 0; i < effectRows.length; i += BATCH_SIZE) {
		const batch = effectRows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeTypeDogmaEffects)
			.values(batch)
			.onConflictDoUpdate({
				target: [universeTypeDogmaEffects.typeId, universeTypeDogmaEffects.effectId],
				set: { isDefault: sql`excluded.is_default` },
			})
	}

	console.log(`  ✓ ${attributeRows.length} type dogma attributes and ${effectRows.length} effects`)
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
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting SDE inventory data import...')
	const sdeDataDir = await prepareSdeDataDir()
	const sdeMetadata = await readSdeMetadata(sdeDataDir)
	console.log(`Reading from: ${sdeDataDir}`)

	const db = createDb(databaseUrl)

	await importCategories(db, sdeDataDir)
	await importGroups(db, sdeDataDir)
	await importMarketGroups(db, sdeDataDir)
	await importTypes(db, sdeDataDir)
	await importTypeMaterials(db, sdeDataDir)
	await importDogmaUnits(db, sdeDataDir)
	await importDogmaAttributes(db, sdeDataDir)
	await importDogmaEffects(db, sdeDataDir)
	await importTypeDogma(db, sdeDataDir)
	await importFlags(db, sdeDataDir)
	await storeSdeVersion(db, sdeMetadata)

	console.log('✓ SDE inventory import complete')
	process.exit(0)
}

main().catch((error) => {
	console.error('✗ Error importing SDE data:', error)
	process.exit(1)
})
