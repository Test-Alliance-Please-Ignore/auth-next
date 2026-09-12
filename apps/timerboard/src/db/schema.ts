import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

import {
	TIMERBOARD_ACTIVITY_ACTIONS,
	TIMERBOARD_CATEGORIES,
	TIMERBOARD_HOSTILITIES,
	TIMERBOARD_PRIORITIES,
	TIMERBOARD_STATES,
	TIMERBOARD_TYPES,
} from '@repo/core'
import { userCharacters, users } from '@repo/core-db-schema'

export { users, userCharacters }

const usersRelations = relations(users, ({ many }) => ({ characters: many(userCharacters) }))
const userCharactersRelations = relations(userCharacters, ({ one }) => ({
	user: one(users, { fields: [userCharacters.userId], references: [users.id] }),
}))

export const timerboardEntries = pgTable(
	'timerboard_entries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		category: text('category', { enum: TIMERBOARD_CATEGORIES }).notNull(),
		timerType: text('timer_type', { enum: TIMERBOARD_TYPES }).notNull().default('custom'),
		title: varchar('title', { length: 160 }).notNull(),
		priority: text('priority', { enum: TIMERBOARD_PRIORITIES }).notNull().default('normal'),
		hostility: text('hostility', { enum: TIMERBOARD_HOSTILITIES }).notNull().default('unknown'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		state: text('state', { enum: TIMERBOARD_STATES }).notNull().default('planned'),
		systemId: text('system_id'),
		systemName: varchar('system_name', { length: 120 }),
		regionId: text('region_id'),
		regionName: varchar('region_name', { length: 120 }),
		planetId: text('planet_id'),
		planetName: varchar('planet_name', { length: 120 }),
		moonId: text('moon_id'),
		moonName: varchar('moon_name', { length: 120 }),
		corporationId: text('corporation_id'),
		corporationName: varchar('corporation_name', { length: 160 }),
		allianceId: text('alliance_id'),
		allianceName: varchar('alliance_name', { length: 160 }),
		structureVisibilityEnforced: boolean('structure_visibility_enforced').notNull().default(false),
		sharingEnabled: boolean('sharing_enabled').notNull().default(false),
		shareDestinations: jsonb('share_destinations')
			.$type<
				Array<{ adapterKey: string; targetKey: string; selectionMeta?: Record<string, unknown> }>
			>()
			.notNull()
			.default([]),
		subjectId: text('subject_id'),
		subjectType: varchar('subject_type', { length: 80 }),
		subjectName: varchar('subject_name', { length: 160 }),
		assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
		assignedCharacterId: text('assigned_character_id'),
		assignedCharacterName: varchar('assigned_character_name', { length: 255 }),
		notes: varchar('notes', { length: 2000 }),
		sourceKind: text('source_kind', { enum: ['manual'] })
			.notNull()
			.default('manual'),
		sourceReference: text('source_reference'),
		createdByUserId: uuid('created_by_user_id')
			.notNull()
			.references(() => users.id),
		updatedByUserId: uuid('updated_by_user_id')
			.notNull()
			.references(() => users.id),
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('timerboard_entries_state_starts_at_idx').on(table.state, table.startsAt),
		index('timerboard_entries_updated_at_idx').on(table.updatedAt),
		index('timerboard_entries_assigned_user_id_idx').on(table.assignedUserId),
		index('timerboard_entries_structure_visibility_idx').on(table.structureVisibilityEnforced),
	]
)

export const timerboardEntryVisibilityGroups = pgTable(
	'timerboard_entry_visibility_groups',
	{
		entryId: uuid('entry_id')
			.notNull()
			.references(() => timerboardEntries.id, { onDelete: 'cascade' }),
		groupId: uuid('group_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.entryId, table.groupId] }),
		index('timerboard_visibility_groups_group_idx').on(table.groupId),
	]
)

export const timerboardEntryDestinationSync = pgTable(
	'timerboard_entry_destination_sync',
	{
		entryId: uuid('entry_id')
			.notNull()
			.references(() => timerboardEntries.id, { onDelete: 'cascade' }),
		adapterKey: varchar('adapter_key', { length: 80 }).notNull(),
		targetKey: varchar('target_key', { length: 255 }).notNull(),
		remoteId: varchar('remote_id', { length: 255 }),
		remoteVersion: varchar('remote_version', { length: 255 }),
		state: text('state').notNull().default('pending'),
		lastError: varchar('last_error', { length: 2000 }),
		retryCount: integer('retry_count').notNull().default(0),
		nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
		leaseUntil: timestamp('lease_until', { withTimezone: true }),
		idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.entryId, table.adapterKey, table.targetKey] }),
		index('timerboard_destination_sync_claim_idx').on(table.state, table.nextAttemptAt),
	]
)

export const timerboardSyncOutbox = pgTable(
	'timerboard_sync_outbox',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		entryId: uuid('entry_id')
			.notNull()
			.references(() => timerboardEntries.id, { onDelete: 'cascade' }),
		operation: text('operation').notNull(),
		version: integer('version').notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		attempts: integer('attempts').notNull().default(0),
		availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
		claimedUntil: timestamp('claimed_until', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		lastError: varchar('last_error', { length: 2000 }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('timerboard_sync_outbox_claim_idx').on(table.completedAt, table.availableAt)]
)

export const timerboardActivity = pgTable(
	'timerboard_activity',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		entryId: uuid('entry_id')
			.notNull()
			.references(() => timerboardEntries.id, { onDelete: 'cascade' }),
		actorUserId: uuid('actor_user_id')
			.notNull()
			.references(() => users.id),
		action: text('action', { enum: TIMERBOARD_ACTIVITY_ACTIONS }).notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('timerboard_activity_entry_created_at_idx').on(table.entryId, table.createdAt)]
)

export const timerboardEntriesRelations = relations(timerboardEntries, ({ one, many }) => ({
	assignedUser: one(users, {
		fields: [timerboardEntries.assignedUserId],
		references: [users.id],
		relationName: 'timerboardAssignedUser',
	}),
	activity: many(timerboardActivity),
	visibilityGroups: many(timerboardEntryVisibilityGroups),
	destinationSync: many(timerboardEntryDestinationSync),
	syncOutbox: many(timerboardSyncOutbox),
}))

export const timerboardActivityRelations = relations(timerboardActivity, ({ one }) => ({
	entry: one(timerboardEntries, {
		fields: [timerboardActivity.entryId],
		references: [timerboardEntries.id],
	}),
	actor: one(users, {
		fields: [timerboardActivity.actorUserId],
		references: [users.id],
		relationName: 'timerboardActivityActor',
	}),
}))

export const timerboardEntryVisibilityGroupsRelations = relations(
	timerboardEntryVisibilityGroups,
	({ one }) => ({
		entry: one(timerboardEntries, {
			fields: [timerboardEntryVisibilityGroups.entryId],
			references: [timerboardEntries.id],
		}),
	})
)

export const timerboardEntryDestinationSyncRelations = relations(
	timerboardEntryDestinationSync,
	({ one }) => ({
		entry: one(timerboardEntries, {
			fields: [timerboardEntryDestinationSync.entryId],
			references: [timerboardEntries.id],
		}),
	})
)

export const timerboardSyncOutboxRelations = relations(timerboardSyncOutbox, ({ one }) => ({
	entry: one(timerboardEntries, {
		fields: [timerboardSyncOutbox.entryId],
		references: [timerboardEntries.id],
	}),
}))

export const schema = {
	users,
	userCharacters,
	usersRelations,
	userCharactersRelations,
	timerboardEntries,
	timerboardActivity,
	timerboardEntriesRelations,
	timerboardActivityRelations,
	timerboardEntryVisibilityGroups,
	timerboardEntryVisibilityGroupsRelations,
	timerboardEntryDestinationSync,
	timerboardEntryDestinationSyncRelations,
	timerboardSyncOutbox,
	timerboardSyncOutboxRelations,
}
