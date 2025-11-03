import { boolean, integer, numeric, pgTable, real, text, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Database schema for EVE Online static data
 * This stores skill metadata and inventory data from the Static Data Export (SDE)
 */

export const corporations = pgTable('corporations', {
	corporationId: text('corporation_id').primaryKey(),
	corporationName: text('corporation_name').notNull(),
	ticker: text('ticker').notNull(),
})

export const alliances = pgTable('alliances', {
	allianceId: text('alliance_id').primaryKey(),
	allianceName: text('alliance_name').notNull(),
	ticker: text('ticker').notNull(),
})

/**
 * SDE version tracking - Track which version of the SDE we've imported
 */
export const sdeVersion = pgTable('sde_version', {
	version: text('version').primaryKey(),
	importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
	checksum: text('checksum'),
})

/**
 * Skill Categories - Top-level categorization of skills
 */
export const skillCategories = pgTable('skill_categories', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skill Groups - Groups within skill categories
 */
export const skillGroups = pgTable('skill_groups', {
	id: text('id').primaryKey(),
	categoryId: text('category_id').notNull().references(() => skillCategories.id),
	name: text('name').notNull(),
	description: text('description'),
	published: boolean('published').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skills - Individual skills in EVE
 */
export const skills = pgTable('skills', {
	id: text('id').primaryKey(),
	groupId: text('group_id').notNull().references(() => skillGroups.id),
	name: text('name').notNull(),
	description: text('description'),
	rank: integer('rank').notNull(),
	primaryAttribute: text('primary_attribute'),
	secondaryAttribute: text('secondary_attribute'),
	published: boolean('published').notNull().default(true),
	canNotBeTrained: boolean('can_not_be_trained').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skill Attributes - Additional attributes for skills
 */
export const skillAttributes = pgTable('skill_attributes', {
	skillId: text('skill_id').notNull().references(() => skills.id),
	attributeName: text('attribute_name').notNull(),
	attributeValue: numeric('attribute_value').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
	pk: { columns: [table.skillId, table.attributeName] },
}))

/**
 * Skill Requirements - Prerequisites for skills
 */
export const skillRequirements = pgTable('skill_requirements', {
	skillId: text('skill_id').notNull().references(() => skills.id),
	requiredSkillId: text('required_skill_id').notNull().references(() => skills.id),
	requiredLevel: integer('required_level').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
	pk: { columns: [table.skillId, table.requiredSkillId] },
}))

/**
 * Inventory Categories - Top-level categorization of all items
 */
export const invCategories = pgTable('inv_categories', {
	categoryId: text('category_id').primaryKey(),
	categoryName: text('category_name').notNull(),
	iconId: integer('icon_id'),
	published: boolean('published').notNull().default(true),
})

/**
 * Inventory Groups - Groups within categories
 */
export const invGroups = pgTable('inv_groups', {
	groupId: text('group_id').primaryKey(),
	categoryId: text('category_id').notNull().references(() => invCategories.categoryId),
	groupName: text('group_name').notNull(),
	iconId: integer('icon_id'),
	useBasePrice: boolean('use_base_price').notNull().default(false),
	anchored: boolean('anchored').notNull().default(false),
	anchorable: boolean('anchorable').notNull().default(false),
	fittableNonSingleton: boolean('fittable_non_singleton').notNull().default(false),
	published: boolean('published').notNull().default(true),
}, (table) => ({
	categoryIdx: index('inv_groups_category_idx').on(table.categoryId),
}))

/**
 * Market Groups - Market categorization hierarchy
 */
export const marketGroups = pgTable('market_groups', {
	marketGroupId: text('market_group_id').primaryKey(),
	parentGroupId: text('parent_group_id'),
	marketGroupName: text('market_group_name').notNull(),
	description: text('description'),
	iconId: integer('icon_id'),
	hasTypes: boolean('has_types').notNull().default(false),
}, (table) => ({
	parentIdx: index('market_groups_parent_idx').on(table.parentGroupId),
}))

/**
 * Inventory Types - All items in EVE
 */
export const invTypes = pgTable('inv_types', {
	typeId: text('type_id').primaryKey(),
	groupId: text('group_id').notNull().references(() => invGroups.groupId),
	typeName: text('type_name').notNull(),
	description: text('description'),
	mass: real('mass').notNull(),
	volume: real('volume').notNull(),
	capacity: real('capacity').notNull().default(0),
	portionSize: integer('portion_size').notNull().default(1),
	raceId: integer('race_id'),
	basePrice: text('base_price'), // Store as text to avoid BigInt issues
	published: boolean('published').notNull().default(true),
	marketGroupId: text('market_group_id').references(() => marketGroups.marketGroupId),
	iconId: integer('icon_id'),
	soundId: integer('sound_id'),
	graphicId: integer('graphic_id'),
}, (table) => ({
	groupIdx: index('inv_types_group_idx').on(table.groupId),
	marketGroupIdx: index('inv_types_market_group_idx').on(table.marketGroupId),
	// Case-insensitive index for name lookups
	typeNameIdx: index('inv_types_name_idx').on(table.typeName),
}))

/**
 * Schema export for Drizzle relations
 */
export const schema = {
	alliances,
	corporations,

	sdeVersion,

	// Skill tables
	skillCategories,
	skillGroups,
	skills,
	skillAttributes,
	skillRequirements,

	// Inventory tables
	invCategories,
	invGroups,
	invTypes,
	marketGroups,
}
