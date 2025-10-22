import { boolean, numeric, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

/**
 * Database schema for EVE Online static data
 * This stores skill metadata from the Static Data Export (SDE)
 */

/**
 * Skill categories - Top level grouping for skills
 * e.g., "Spaceship Command", "Gunnery", "Engineering", etc.
 */
export const skillCategories = pgTable('skill_categories', {
	id: text('id').primaryKey(), // From SDE categoryID
	name: text('name').notNull(),
	description: text('description'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skill groups - Groups within categories
 * e.g., "Spaceship Command" category contains "Frigates", "Destroyers", etc.
 */
export const skillGroups = pgTable('skill_groups', {
	id: text('id').primaryKey(), // From SDE groupID
	categoryId: text('category_id')
		.notNull()
		.references(() => skillCategories.id),
	name: text('name').notNull(),
	description: text('description'),
	published: boolean('published').default(true).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skills - Individual skills with their metadata
 */
export const skills = pgTable('skills', {
	id: text('id').primaryKey(), // From SDE typeID
	groupId: text('group_id')
		.notNull()
		.references(() => skillGroups.id),
	name: text('name').notNull(),
	description: text('description'),
	rank: numeric('rank').notNull(), // Training time multiplier (1-16)
	primaryAttribute: text('primary_attribute'), // e.g., "intelligence", "perception"
	secondaryAttribute: text('secondary_attribute'), // e.g., "memory", "willpower"
	published: boolean('published').default(true).notNull(),
	canNotBeTrained: boolean('can_not_be_trained').default(false).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skill requirements - Prerequisites for training skills
 */
export const skillRequirements = pgTable(
	'skill_requirements',
	{
		skillId: text('skill_id')
			.notNull()
			.references(() => skills.id),
		requiredSkillId: text('required_skill_id')
			.notNull()
			.references(() => skills.id),
		requiredLevel: numeric('required_level').notNull(), // 1-5
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.skillId, table.requiredSkillId)]
)

/**
 * Skill attributes - Additional attributes for skills
 * Stores things like training time per level, SP requirements, etc.
 */
export const skillAttributes = pgTable(
	'skill_attributes',
	{
		skillId: text('skill_id')
			.notNull()
			.references(() => skills.id),
		attributeName: text('attribute_name').notNull(),
		attributeValue: numeric('attribute_value').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.skillId, table.attributeName)]
)

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
 * Schema export for Drizzle relations
 */
export const schema = {
	alliances,
	corporations,
	skillCategories,
	skillGroups,
	skills,
	skillRequirements,
	skillAttributes,
	sdeVersion,
}
