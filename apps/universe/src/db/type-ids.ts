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

export const typeIds = pgTable(
	'universe_eve_type_ids',
	{
		typeId: text('type_id').primaryKey(),
		typeName: text('type_name').notNull(),
	},
	(table) => [
		index('universe_eve_type_ids_type_id_idx').on(table.typeId),
		index('universe_eve_type_ids_type_name_idx').on(table.typeName),
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

export const invItems = pgTable(
	'universe_eve_inv_items',
	{
		itemId: text('item_id').primaryKey(),
		typeId: text('type_id').notNull(),
		ownerId: text('owner_id').notNull(),
		locationId: text('location_id').notNull(),
		flagId: text('flag_id').notNull(),
		quantity: text('quantity').notNull(), // Store as text to preserve large numbers
	},
	(table) => [
		index('universe_eve_inv_items_item_id_idx').on(table.itemId),
		index('universe_eve_inv_items_type_id_idx').on(table.typeId),
		index('universe_eve_inv_items_owner_id_idx').on(table.ownerId),
		index('universe_eve_inv_items_location_id_idx').on(table.locationId),
	]
)

export const invNames = pgTable(
	'universe_eve_inv_names',
	{
		itemId: text('item_id').primaryKey(),
		itemName: text('item_name').notNull(),
	},
	(table) => [
		index('universe_eve_inv_names_item_id_idx').on(table.itemId),
		index('universe_eve_inv_names_item_name_idx').on(table.itemName),
	]
)
