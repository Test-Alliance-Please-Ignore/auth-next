import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable(
	'users',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		mainCharacterId: text('main_character_id').notNull().unique(),
		discordUserId: varchar('discord_user_id', { length: 255 }).unique(),
		is_admin: boolean('is_admin').default(false).notNull(),
		lastDiscordRefresh: timestamp('last_discord_refresh', { withTimezone: true }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		legacyAuthUserId: text('legacy_auth_user_id').unique(),
		legacyAuthUserUsername: text('legacy_auth_user_username').unique(),
		legacyAuthUserEmailHash: text('legacy_auth_user_email_hash').unique(),
		lastRefreshWorkflow: timestamp('last_refresh_workflow', { withTimezone: true }),
		lastRefreshWorkflowAttempt: timestamp('last_refresh_workflow_attempt', { withTimezone: true }),
	},
	(table) => [
		index('users_main_character_id_idx').on(table.mainCharacterId),
		index('users_discord_user_id_idx').on(table.discordUserId),
	]
)

export const userCharacters = pgTable(
	'user_characters',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		characterOwnerHash: varchar('character_owner_hash', { length: 255 }).notNull(),
		characterId: text('character_id').notNull().unique(),
		characterName: varchar('character_name', { length: 255 }).notNull(),
		corporationId: text('corporation_id'),
		corporationName: varchar('corporation_name', { length: 255 }),
		allianceId: text('alliance_id'),
		allianceName: varchar('alliance_name', { length: 255 }),
		is_primary: boolean('is_primary').default(false).notNull(),
		hasValidToken: boolean('has_valid_token'),
		status: text('status', { enum: ['active', 'emeritus'] })
			.notNull()
			.default('active'),
		lastCharacterRefresh: timestamp('last_character_refresh', { withTimezone: true }),
		linkedAt: timestamp('linked_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		isDeleted: boolean('deleted').default(false).notNull(),
	},
	(table) => [index('user_characters_user_id_idx').on(table.userId)]
)

export const managedCorporations = pgTable(
	'managed_corporations',
	{
		corporationId: text('corporation_id').primaryKey(),
		name: varchar('name', { length: 255 }).notNull(),
		ticker: varchar('ticker', { length: 10 }).notNull(),
		assignedCharacterId: text('assigned_character_id'),
		assignedCharacterName: varchar('assigned_character_name', { length: 255 }),
		isActive: boolean('is_active').default(true).notNull(),
		includeInBackgroundRefresh: boolean('include_in_background_refresh').default(false).notNull(),
		includeInStructureAssetSync: boolean('include_in_structure_asset_sync').default(false).notNull(),
		lastSync: timestamp('last_sync', { withTimezone: true }),
		lastVerified: timestamp('last_verified', { withTimezone: true }),
		isVerified: boolean('is_verified').default(false).notNull(),
		healthyDirectorCount: integer('healthy_director_count').default(0).notNull(),
		configuredBy: uuid('configured_by').references(() => users.id, { onDelete: 'set null' }),
		isMemberCorporation: boolean('is_member_corporation').default(false).notNull(),
		isAltCorp: boolean('is_alt_corp').default(false).notNull(),
		isSpecialPurpose: boolean('is_special_purpose').default(false).notNull(),
		isRecruiting: boolean('is_recruiting').default(true).notNull(),
		shortDescription: varchar('short_description', { length: 250 }),
		fullDescription: text('full_description'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('managed_corporations_name_idx').on(table.name),
		index('managed_corporations_include_in_background_refresh_idx').on(
			table.includeInBackgroundRefresh
		),
		index('managed_corporations_include_in_structure_asset_sync_idx').on(
			table.includeInStructureAssetSync
		),
	]
)

export const discordServers = pgTable(
	'discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		guildId: text('guild_id').unique().notNull(),
		guildName: text('guild_name').notNull(),
		description: text('description'),
		isActive: boolean('is_active').default(true).notNull(),
		manageNicknames: boolean('manage_nicknames').default(false).notNull(),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_servers_guild_id_idx').on(table.guildId),
		index('discord_servers_active_idx').on(table.isActive).where(sql`${table.isActive} = true`),
	]
)

export const discordRoles = pgTable(
	'discord_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		roleId: text('role_id').notNull(),
		roleName: text('role_name').notNull(),
		description: text('description'),
		isActive: boolean('is_active').default(true).notNull(),
		autoApply: boolean('auto_apply').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('discord_roles_server_id_idx').on(table.discordServerId)]
)

/**
 * Shared Alert Destinations
 *
 * Reusable delivery definitions referenced by corporation and structure alert config tables.
 * Destinations are scoped by a logical owner type/id pair so multiple alert families can
 * share the same destination records without duplicating Discord channel/user/group routing.
 */
export const alertDestinations = pgTable(
	'alert_destinations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		scopeType: text('scope_type', { enum: ['corporation', 'structure_group'] }).notNull(),
		scopeId: text('scope_id').notNull(),
		alertType: text('alert_type').notNull(),
		destinationType: text('destination_type', {
			enum: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
		}).notNull(),
		discordServerId: uuid('discord_server_id').references(() => discordServers.id, {
			onDelete: 'cascade',
		}),
		channelId: text('channel_id'),
		coreUserId: uuid('core_user_id').references(() => users.id, { onDelete: 'cascade' }),
		groupId: text('group_id'),
		destinationConfig: jsonb('destination_config').$type<Record<string, unknown>>().notNull().default({}),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('alert_destinations_scope_idx').on(table.scopeType, table.scopeId),
		index('alert_destinations_alert_type_idx').on(table.alertType),
		index('alert_destinations_type_idx').on(table.destinationType),
		index('alert_destinations_enabled_idx').on(table.isEnabled),
	]
)

export const alertDestinationsRelations = relations(alertDestinations, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [alertDestinations.discordServerId],
		references: [discordServers.id],
	}),
	createdBy: one(users, {
		fields: [alertDestinations.createdBy],
		references: [users.id],
	}),
	updatedBy: one(users, {
		fields: [alertDestinations.updatedBy],
		references: [users.id],
	}),
}))

export const discordServersRelations = relations(discordServers, ({ many }) => ({
	roles: many(discordRoles),
}))

export const discordRolesRelations = relations(discordRoles, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [discordRoles.discordServerId],
		references: [discordServers.id],
	}),
}))

export const schema = {
	users,
	userCharacters,
	managedCorporations,
	discordServers,
	discordRoles,
	alertDestinations,
	discordServersRelations,
	discordRolesRelations,
	alertDestinationsRelations,
}
