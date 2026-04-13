import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core'

export const characterIds = pgTable(
	'universe_eve_character_ids',
	{
		characterId: text('character_id').primaryKey(),
		characterName: text('character_name').notNull(),
	},
	(table) => [
		index('universe_eve_character_ids_character_id_idx').on(table.characterId),
		index('universe_eve_character_ids_character_name_idx').on(table.characterName),
	]
)

export const corporationIds = pgTable(
	'universe_eve_corporation_ids',
	{
		corporationId: text('corporation_id').primaryKey(),
		corporationName: text('corporation_name').notNull(),
		ticker: text('ticker'),
	},
	(table) => [
		index('universe_eve_corporation_ids_corporation_id_idx').on(table.corporationId),
		index('universe_eve_corporation_ids_corporation_name_idx').on(table.corporationName),
		index('universe_eve_corporation_ids_ticker_idx').on(table.ticker),
	]
)

export const allianceIds = pgTable(
	'universe_eve_alliance_ids',
	{
		allianceId: text('alliance_id').primaryKey(),
		allianceName: text('alliance_name').notNull(),
		ticker: text('ticker'),
	},
	(table) => [
		index('universe_eve_alliance_ids_alliance_id_idx').on(table.allianceId),
		index('universe_eve_alliance_ids_alliance_name_idx').on(table.allianceName),
		index('universe_eve_alliance_ids_ticker_idx').on(table.ticker),
	]
)

export const invFlags = pgTable(
	'universe_eve_inv_flags',
	{
		flagId: text('flag_id').primaryKey(),
		flagName: text('flag_name').notNull(),
		flagText: text('flag_text').notNull(),
		orderId: integer('order_id').notNull(),
	},
	(table) => [
		index('universe_eve_inv_flags_flag_id_idx').on(table.flagId),
		index('universe_eve_inv_flags_flag_name_idx').on(table.flagName),
	]
)

export const invGroups = pgTable(
	'universe_eve_inv_groups',
	{
		groupId: text('group_id').primaryKey(),
		categoryId: text('category_id').notNull(),
		groupName: text('group_name').notNull(),
		iconId: text('icon_id'),
		useBasePrice: boolean('use_base_price').notNull().default(false),
		anchored: boolean('anchored').notNull().default(false),
		anchorable: boolean('anchorable').notNull().default(false),
		fittableNonSingleton: boolean('fittable_non_singleton').notNull().default(false),
		published: boolean('published').notNull().default(true),
	},
	(table) => [
		index('universe_eve_inv_groups_group_id_idx').on(table.groupId),
		index('universe_eve_inv_groups_category_id_idx').on(table.categoryId),
		index('universe_eve_inv_groups_group_name_idx').on(table.groupName),
		index('universe_eve_inv_groups_published_idx').on(table.published),
		index('universe_eve_inv_groups_icon_id_idx').on(table.iconId),
	]
)

export const invCategories = pgTable(
	'universe_eve_inv_categories',
	{
		categoryId: text('category_id').primaryKey(),
		categoryName: text('category_name').notNull(),
		iconId: text('icon_id'),
		published: boolean('published').notNull().default(false),
	},
	(table) => [
		index('universe_eve_inv_categories_category_id_idx').on(table.categoryId),
		index('universe_eve_inv_categories_category_name_idx').on(table.categoryName),
		index('universe_eve_inv_categories_published_idx').on(table.published),
	]
)

export const invMarketGroups = pgTable(
	'universe_eve_market_groups',
	{
		marketGroupId: text('market_group_id').primaryKey(),
		parentGroupId: text('parent_group_id'),
		marketGroupName: text('market_group_name').notNull(),
		description: text('description'),
		iconId: text('icon_id'),
		hasTypes: boolean('has_types').notNull().default(false),
	},
	(table) => [
		index('universe_eve_market_groups_market_group_id_idx').on(table.marketGroupId),
		index('universe_eve_market_groups_parent_group_id_idx').on(table.parentGroupId),
		index('universe_eve_market_groups_market_group_name_idx').on(table.marketGroupName),
		index('universe_eve_market_groups_has_types_idx').on(table.hasTypes),
	]
)

export const invTypes = pgTable(
	'universe_eve_inv_types',
	{
		typeId: text('type_id').primaryKey(),
		groupId: text('group_id').notNull(),
		typeName: text('type_name').notNull(),
		description: text('description').notNull(),
		mass: text('mass').notNull(), // Store as text to preserve large numbers
		volume: text('volume').notNull(),
		capacity: text('capacity').notNull(),
		portionSize: integer('portion_size').notNull(),
		raceId: text('race_id'),
		basePrice: text('base_price'),
		published: boolean('published').notNull().default(false),
		marketGroupId: text('market_group_id'),
		iconId: text('icon_id'),
		soundId: text('sound_id'),
		graphicId: text('graphic_id').notNull(),
	},
	(table) => [
		index('universe_eve_inv_types_type_id_idx').on(table.typeId),
		index('universe_eve_inv_types_group_id_idx').on(table.groupId),
		index('universe_eve_inv_types_type_name_idx').on(table.typeName),
		index('universe_eve_inv_types_published_idx').on(table.published),
		index('universe_eve_inv_types_market_group_id_idx').on(table.marketGroupId),
	]
)
