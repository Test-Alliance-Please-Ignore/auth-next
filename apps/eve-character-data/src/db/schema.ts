import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the eve-character-data worker
 */

/**
 * Character public information
 */
export const characterPublicInfo = pgTable('character_public_info', {
	characterId: integer('character_id').primaryKey(),
	name: text('name').notNull(),
	corporationId: integer('corporation_id').notNull(),
	allianceId: integer('alliance_id'),
	birthday: text('birthday').notNull(),
	raceId: integer('race_id').notNull(),
	bloodlineId: integer('bloodline_id').notNull(),
	securityStatus: integer('security_status'),
	description: text('description'),
	gender: text('gender').notNull().$type<'male' | 'female'>(),
	factionId: integer('faction_id'),
	title: text('title'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character portrait URLs
 */
export const characterPortraits = pgTable('character_portraits', {
	characterId: integer('character_id').primaryKey().references(() => characterPublicInfo.characterId),
	px64x64: text('px64x64'),
	px128x128: text('px128x128'),
	px256x256: text('px256x256'),
	px512x512: text('px512x512'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character corporation history
 */
export const characterCorporationHistory = pgTable(
	'character_corporation_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: integer('character_id')
			.notNull()
			.references(() => characterPublicInfo.characterId),
		recordId: integer('record_id').notNull(),
		corporationId: integer('corporation_id').notNull(),
		startDate: text('start_date').notNull(),
		isDeleted: boolean('is_deleted'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [unique().on(table.characterId, table.recordId)]
)

/**
 * Character skills
 */
export const characterSkills = pgTable('character_skills', {
	characterId: integer('character_id').primaryKey().references(() => characterPublicInfo.characterId),
	totalSp: integer('total_sp').notNull(),
	unallocatedSp: integer('unallocated_sp'),
	skills: jsonb('skills')
		.notNull()
		.$type<
			Array<{
				active_skill_level: number
				skill_id: number
				skillpoints_in_skill: number
				trained_skill_level: number
			}>
		>(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Character attributes
 */
export const characterAttributes = pgTable('character_attributes', {
	characterId: integer('character_id').primaryKey().references(() => characterPublicInfo.characterId),
	intelligence: integer('intelligence').notNull(),
	perception: integer('perception').notNull(),
	memory: integer('memory').notNull(),
	willpower: integer('willpower').notNull(),
	charisma: integer('charisma').notNull(),
	accruedRemapCooldownDate: text('accrued_remap_cooldown_date'),
	bonusRemaps: integer('bonus_remaps'),
	lastRemapDate: text('last_remap_date'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Schema export for Drizzle relations
 */
export const schema = {
	characterPublicInfo,
	characterPortraits,
	characterCorporationHistory,
	characterSkills,
	characterAttributes,
}
