import { relations } from 'drizzle-orm'
import { boolean, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the skills worker
 *
 * Add your table definitions here using Drizzle ORM.
 *
 */
/**
 * Skill categories - Top level grouping for skills
 * e.g., "Spaceship Command", "Gunnery", "Engineering", etc.
 */
export const skillCategories = pgTable('do_skill_categories', {
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
export const skillGroups = pgTable('do_skill_groups', {
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
export const skills = pgTable('do_skills', {
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
	'do_skill_requirements',
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
 * Stores things like skill points per level (skillPointsLevel1-5), SP requirements, etc.
 * Skill points are calculated using: 250 × rank × sqrt(32)^(level - 1)
 */
export const skillAttributes = pgTable(
	'do_skill_attributes',
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

/**
 * Skill Plans - Main table storing skill plan metadata
 * A skill plan is a curated list of skills with required and recommended levels
 */
export const skillPlans = pgTable(
	'do_skill_plans',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		description: text('description').notNull(),
		isPublished: boolean('is_published').notNull().default(false),
		maintainerId: text('maintainer_id'), // Optional maintainer name/identifier
		ownerCharacterId: text('owner_character_id'), // EVE character ID of creator
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('idx_skill_plans_published').on(table.isPublished),
		index('idx_skill_plans_maintainer').on(table.maintainerId),
		index('idx_skill_plans_owner').on(table.ownerCharacterId),
		index('idx_skill_plans_updated').on(table.updatedAt),
	]
)

/**
 * Skill Plan Skills - Skills required for each plan with level requirements
 * Links plans to skills with both required (minimum) and recommended levels
 */
export const skillPlanSkills = pgTable(
	'do_skill_plan_skills',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		planId: uuid('plan_id')
			.notNull()
			.references(() => skillPlans.id, { onDelete: 'cascade' }),
		skillId: text('skill_id')
			.notNull()
			.references(() => skills.id),
		requiredLevel: integer('required_level').notNull(), // Minimum level (0-5)
		recommendedLevel: integer('recommended_level').notNull(), // Recommended level (0-5)
		displayOrder: integer('display_order').notNull().default(0),
		notes: text('notes'), // Optional notes about why this skill is needed
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.planId, table.skillId),
		index('idx_skill_plan_skills_plan').on(table.planId),
	]
)

/**
 * Skill Plan Categories - Categories for organizing skill plans
 * e.g., "Combat", "Industry", "Mining", "Trading", "Exploration"
 */
export const skillPlanCategories = pgTable('do_skill_plan_categories', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: text('name').notNull().unique(),
	description: text('description'),
	icon: text('icon'), // Optional icon/emoji identifier
	displayOrder: integer('display_order').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Skill Plan Category Mappings - Many-to-many relationship between plans and categories
 * Allows a skill plan to belong to multiple categories
 */
export const skillPlanCategoryMappings = pgTable(
	'do_skill_plan_category_mappings',
	{
		planId: uuid('plan_id')
			.notNull()
			.references(() => skillPlans.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => skillPlanCategories.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique().on(table.planId, table.categoryId),
		index('idx_category_mappings_plan').on(table.planId),
		index('idx_category_mappings_category').on(table.categoryId),
	]
)

// ===== Relations =====

/**
 * Skill category relations
 */
export const skillCategoriesRelations = relations(skillCategories, ({ many }) => ({
	groups: many(skillGroups),
}))

/**
 * Skill group relations
 */
export const skillGroupsRelations = relations(skillGroups, ({ one, many }) => ({
	category: one(skillCategories, {
		fields: [skillGroups.categoryId],
		references: [skillCategories.id],
	}),
	skills: many(skills),
}))

/**
 * Skill relations
 */
export const skillsRelations = relations(skills, ({ one, many }) => ({
	group: one(skillGroups, {
		fields: [skills.groupId],
		references: [skillGroups.id],
	}),
	requirements: many(skillRequirements, {
		relationName: 'skill',
	}),
	requiredFor: many(skillRequirements, {
		relationName: 'requiredSkill',
	}),
	attributes: many(skillAttributes),
	planSkills: many(skillPlanSkills),
}))

/**
 * Skill requirements relations
 */
export const skillRequirementsRelations = relations(skillRequirements, ({ one }) => ({
	skill: one(skills, {
		fields: [skillRequirements.skillId],
		references: [skills.id],
		relationName: 'skill',
	}),
	requiredSkill: one(skills, {
		fields: [skillRequirements.requiredSkillId],
		references: [skills.id],
		relationName: 'requiredSkill',
	}),
}))

/**
 * Skill attributes relations
 */
export const skillAttributesRelations = relations(skillAttributes, ({ one }) => ({
	skill: one(skills, {
		fields: [skillAttributes.skillId],
		references: [skills.id],
	}),
}))

/**
 * Skill plan relations
 */
export const skillPlansRelations = relations(skillPlans, ({ many }) => ({
	skills: many(skillPlanSkills),
	categories: many(skillPlanCategoryMappings),
}))

/**
 * Skill plan skills relations
 */
export const skillPlanSkillsRelations = relations(skillPlanSkills, ({ one }) => ({
	plan: one(skillPlans, {
		fields: [skillPlanSkills.planId],
		references: [skillPlans.id],
	}),
	skill: one(skills, {
		fields: [skillPlanSkills.skillId],
		references: [skills.id],
	}),
}))

/**
 * Skill plan categories relations
 */
export const skillPlanCategoriesRelations = relations(skillPlanCategories, ({ many }) => ({
	plans: many(skillPlanCategoryMappings),
}))

/**
 * Skill plan category mappings relations
 */
export const skillPlanCategoryMappingsRelations = relations(skillPlanCategoryMappings, ({ one }) => ({
	plan: one(skillPlans, {
		fields: [skillPlanCategoryMappings.planId],
		references: [skillPlans.id],
	}),
	category: one(skillPlanCategories, {
		fields: [skillPlanCategoryMappings.categoryId],
		references: [skillPlanCategories.id],
	}),
}))

export const schema = {
	skillCategories,
	skillGroups,
	skills,
	skillRequirements,
	skillAttributes,
	skillPlans,
	skillPlanSkills,
	skillPlanCategories,
	skillPlanCategoryMappings,
	// Relations
	skillCategoriesRelations,
	skillGroupsRelations,
	skillsRelations,
	skillRequirementsRelations,
	skillAttributesRelations,
	skillPlansRelations,
	skillPlanSkillsRelations,
	skillPlanCategoriesRelations,
	skillPlanCategoryMappingsRelations,
}
