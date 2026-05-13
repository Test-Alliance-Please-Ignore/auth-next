import { boolean, index, inet, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

// Core-owned tables queried by legacy worker for trusted internal matching.
// These are read-only from legacy and already exist in the shared database.
export const coreUsers = pgTable('users', {
	id: uuid('id').primaryKey(),
	mainCharacterId: text('main_character_id'),
	discordUserId: text('discord_user_id'),
})

export const coreUserCharacters = pgTable('user_characters', {
	id: uuid('id').primaryKey(),
	userId: uuid('user_id').notNull(),
	characterId: text('character_id').notNull(),
	characterName: text('character_name'),
	isDeleted: boolean('deleted').notNull(),
})

export const legacyAuthCharacters = pgTable(
	'legacy_auth_characters',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyAuthUserId: text('legacy_auth_user_id').notNull(),
		characterId: text('character_id').notNull(),
		characterName: text('character_name').notNull(),
		source: text('source', { enum: ['legacy_primary', 'esi_owner', 'xml_account'] }).notNull(),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_characters_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_characters_character_id_idx').on(table.characterId),
		index('legacy_auth_characters_source_idx').on(table.source),
		unique('legacy_auth_characters_legacy_user_character_unique').on(table.legacyAuthUserId, table.characterId),
	]
)

export const legacyAuthUserIpAddresses = pgTable(
	'legacy_auth_user_ip_addresses',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyAuthUserId: text('legacy_auth_user_id').notNull(),
		ipAddress: inet('ip_address').notNull(),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_user_ips_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_user_ips_ip_address_idx').on(table.ipAddress),
		unique('legacy_auth_user_ips_legacy_user_ip_unique').on(table.legacyAuthUserId, table.ipAddress),
	]
)

export const legacyAuthDiscordAccounts = pgTable(
	'legacy_auth_discord_accounts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyAuthUserId: text('legacy_auth_user_id').notNull(),
		discordUserId: text('discord_user_id').notNull(),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_discord_accounts_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_discord_accounts_discord_user_idx').on(table.discordUserId),
		unique('legacy_auth_discord_accounts_legacy_user_discord_user_unique').on(
			table.legacyAuthUserId,
			table.discordUserId
		),
	]
)

export const legacyAuthNotes = pgTable(
	'legacy_auth_notes',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyNoteId: text('legacy_note_id').notNull().unique(),
		legacyAuthUserId: text('legacy_auth_user_id').notNull(),
		legacyCreatedByUserId: text('legacy_created_by_user_id'),
		note: text('note').notNull(),
		legacyDateCreated: timestamp('legacy_date_created', { withTimezone: true }),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_notes_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_notes_created_by_idx').on(table.legacyCreatedByUserId),
		index('legacy_auth_notes_legacy_created_idx').on(table.legacyDateCreated),
	]
)

export const legacyAuthApplications = pgTable(
	'legacy_auth_applications',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyApplicationId: text('legacy_application_id').notNull().unique(),
		legacyAuthUserId: text('legacy_auth_user_id'),
		characterId: text('character_id'),
		characterName: text('character_name'),
		corporationId: text('corporation_id'),
		corporationName: text('corporation_name'),
		status: text('status'),
		applicationDate: timestamp('application_date', { withTimezone: true }),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_applications_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_applications_character_id_idx').on(table.characterId),
		index('legacy_auth_applications_status_idx').on(table.status),
		index('legacy_auth_applications_date_idx').on(table.applicationDate),
	]
)

export const legacyAuthApplicationEvents = pgTable(
	'legacy_auth_application_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		legacyEventId: text('legacy_event_id').notNull().unique(),
		legacyApplicationId: text('legacy_application_id').notNull(),
		legacyAuthUserId: text('legacy_auth_user_id'),
		eventType: text('event_type').notNull(),
		eventCode: integer('event_code'),
		message: text('message'),
		legacyActorUserId: text('legacy_actor_user_id'),
		eventAt: timestamp('event_at', { withTimezone: true }),
		sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).defaultNow().notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_auth_application_events_app_idx').on(table.legacyApplicationId),
		index('legacy_auth_application_events_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_auth_application_events_event_at_idx').on(table.eventAt),
		index('legacy_auth_application_events_event_code_idx').on(table.eventCode),
	]
)

export const legacyMigrationQueue = pgTable(
	'legacy_migration_queue',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		modernUserId: text('modern_user_id').notNull(),
		legacyAuthUserId: text('legacy_auth_user_id').notNull(),
		status: text('status', {
			enum: ['pending', 'partially_applied', 'applied', 'dismissed', 'error'],
		})
			.notNull()
			.default('pending'),
		severity: text('severity', { enum: ['none', 'high', 'critical'] }).notNull().default('none'),
		candidateSnapshot: jsonb('candidate_snapshot')
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		conflicts: jsonb('conflicts').$type<Record<string, unknown>>().notNull().default({}),
		lastError: text('last_error'),
		lastMatchedAt: timestamp('last_matched_at', { withTimezone: true }).defaultNow().notNull(),
		lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_migration_queue_modern_user_idx').on(table.modernUserId),
		index('legacy_migration_queue_legacy_user_idx').on(table.legacyAuthUserId),
		index('legacy_migration_queue_status_idx').on(table.status),
		index('legacy_migration_queue_severity_idx').on(table.severity),
		unique('legacy_migration_queue_modern_user_legacy_user_unique').on(
			table.modernUserId,
			table.legacyAuthUserId
		),
	]
)

export const legacyMigrationActions = pgTable(
	'legacy_migration_actions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		queueId: uuid('queue_id')
			.notNull()
			.references(() => legacyMigrationQueue.id, { onDelete: 'cascade' }),
		action: text('action', { enum: ['create', 'update', 'recheck', 'apply', 'dismiss'] }).notNull(),
		performedByUserId: text('performed_by_user_id'),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('legacy_migration_actions_queue_idx').on(table.queueId),
		index('legacy_migration_actions_action_idx').on(table.action),
		index('legacy_migration_actions_performed_by_idx').on(table.performedByUserId),
	]
)

export const schema = {
	coreUsers,
	coreUserCharacters,
	legacyAuthCharacters,
	legacyAuthUserIpAddresses,
	legacyAuthDiscordAccounts,
	legacyAuthNotes,
	legacyAuthApplications,
	legacyAuthApplicationEvents,
	legacyMigrationQueue,
	legacyMigrationActions,
}
