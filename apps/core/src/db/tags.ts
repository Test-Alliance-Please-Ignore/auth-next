import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { users } from './schema'

export const userTags = pgTable(
	'core_user_tags',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		urn: text('urn').notNull(),
		name: text('name').notNull(),
		description: text('description'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('core_user_tags_urn_idx').on(table.urn),
		index('core_user_tags_name_idx').on(table.name),
		unique('core_user_tags_urn_unique').on(table.urn),
		unique('core_user_tags_name_unique').on(table.name),
	]
)

export const userTagAssignments = pgTable(
	'core_user_tag_assignments',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tagUrn: text('tag_urn')
			.notNull()
			.references(() => userTags.urn, { onDelete: 'cascade' }),
		assignedToEntityType: text('assigned_to_entity_type', {
			enum: ['character'],
		}),
		assignedToEntityId: text('assigned_to_entity_id'),
		assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
		assignedBy: text('assigned_by'),
	},
	(table) => [
		check(
			'core_user_tag_assignments_entity_type_required',
			sql`${table.assignedToEntityId} IS NULL OR ${table.assignedToEntityType} IS NOT NULL`
		),
		index('core_user_tag_assignments_user_id_idx').on(table.userId),
		index('core_user_tag_assignments_tag_urn_idx').on(table.tagUrn),
		index('core_user_tag_assignments_entity_idx').on(
			table.assignedToEntityType,
			table.assignedToEntityId
		),
	]
)
