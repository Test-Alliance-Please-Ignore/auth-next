import { pgTable, varchar, integer, timestamp, text, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// Tags
// ============================================================================

export const tags = pgTable('tags_tags', {
	tagUrn: varchar('tag_urn', { length: 255 }).primaryKey(), // e.g., "urn:eve:corporation:98000001"
	tagType: varchar('tag_type', { length: 50 }).notNull(), // 'corporation', 'alliance'
	displayName: varchar('display_name', { length: 255 }).notNull(),
	eveId: integer('eve_id'),
	metadata: text('metadata'), // JSON with additional tag data
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	typeIdx: index('tags_tags_type_idx').on(table.tagType),
	eveIdIdx: index('tags_tags_eve_id_idx').on(table.eveId)
}))

// ============================================================================
// User Tag Assignments
// ============================================================================

export const userTags = pgTable('tags_user_tags', {
	assignmentId: uuid('assignment_id').defaultRandom().primaryKey(),
	rootUserId: uuid('root_user_id').notNull(),
	tagUrn: varchar('tag_urn', { length: 255 }).notNull(),
	sourceCharacterId: integer('source_character_id'), // Which character sourced this tag
	assignedAt: timestamp('assigned_at').defaultNow().notNull(),
	lastVerifiedAt: timestamp('last_verified_at').defaultNow().notNull()
}, (table) => ({
	userTagIdx: uniqueIndex('tags_user_tags_unique_idx').on(
		table.rootUserId,
		table.tagUrn,
		table.sourceCharacterId
	),
	userIdx: index('tags_user_tags_user_idx').on(table.rootUserId),
	tagIdx: index('tags_user_tags_tag_idx').on(table.tagUrn),
	sourceIdx: index('tags_user_tags_source_idx').on(table.sourceCharacterId)
}))

// ============================================================================
// Tag Evaluation Schedule
// ============================================================================

export const evaluationSchedule = pgTable('tags_evaluation_schedule', {
	rootUserId: uuid('root_user_id').primaryKey(),
	nextEvaluationAt: timestamp('next_evaluation_at').notNull(),
	lastEvaluatedAt: timestamp('last_evaluated_at').defaultNow().notNull()
}, (table) => ({
	nextEvalIdx: index('tags_eval_schedule_next_idx').on(table.nextEvaluationAt)
}))

// ============================================================================
// Relations
// ============================================================================

export const tagsRelations = relations(tags, ({ many }) => ({
	userTags: many(userTags)
}))

export const userTagsRelations = relations(userTags, ({ one }) => ({
	tag: one(tags, {
		fields: [userTags.tagUrn],
		references: [tags.tagUrn]
	})
}))