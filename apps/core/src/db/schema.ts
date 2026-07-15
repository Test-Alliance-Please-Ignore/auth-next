import { relations, sql } from 'drizzle-orm'
import {
	boolean,
	index,
	inet,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

import { alertDestinations } from '@repo/core-db-schema'

export { alertDestinations }

/**
 * Users table - Root user accounts
 *
 * Each user has one "main" character that they claimed when creating their account.
 * Additional characters can be linked manually.
 */
export const users = pgTable(
	'users',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** EVE character ID of the main character */
		mainCharacterId: text('main_character_id').notNull().unique(),
		/** Discord user ID (links to Discord worker's discordUsers table) */
		discordUserId: varchar('discord_user_id', { length: 255 }).unique(),
		/** Whether this user is an admin */
		is_admin: boolean('is_admin').default(false).notNull(),
		/** Whether this user is exempt from private-data access and Fulcrum targeting */
		immunitas: boolean('immunitas').default(false).notNull(),
		/** Last time Discord access was refreshed (tokens, roles, server membership) */
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
		index('users_last_discord_refresh_idx').on(table.lastDiscordRefresh),
		index('users_legacy_auth_user_id_idx').on(table.legacyAuthUserId),
		index('users_legacy_auth_user_username_idx').on(table.legacyAuthUserUsername),
		index('users_legacy_auth_user_email_hash_idx').on(table.legacyAuthUserEmailHash),
		index('users_last_refresh_workflow_idx').on(table.lastRefreshWorkflow),
		index('users_last_refresh_workflow_attempt_idx').on(table.lastRefreshWorkflowAttempt),
	]
)

export const userIpAddresses = pgTable(
	'user_ip_addresses',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		ipAddress: inet('addr').notNull(),
		ipAddressHash: text('ip_address_hash').notNull(),
		firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
	},
	(table) => [
		index('user_ip_addresses_user_id_idx').on(table.userId),
		index('user_ip_addresses_ip_address_idx').on(table.ipAddress),
		unique('user_ip_addresses_user_ip_unique').on(table.userId, table.ipAddress),
	]
)

export const userFingerprints = pgTable(
	'user_fingerprints',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
	},
	(table) => [
		index('user_fingerprints_user_id_idx').on(table.userId),
		index('user_fingerprints_fingerprint_idx').on(table.fingerprint),
		index('user_fingerprints_user_id_fingerprint_idx').on(table.userId, table.fingerprint),
	]
)

export const services = pgTable(
	'core_services',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		icon: text('icon'),
		description: text('description'),
		enabled: boolean('enabled').default(false).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('core_services_enabled_idx').on(table.enabled),
		index('core_services_name_idx').on(table.name),
		index('core_services_slug_idx').on(table.slug),
	]
)

export const userServices = pgTable(
	'core_user_services',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		serviceId: uuid('service_id')
			.notNull()
			.references(() => services.id, { onDelete: 'cascade' }),
		enabled: boolean('enabled').default(true).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('core_user_services_user_id_idx').on(table.userId),
		index('core_user_services_service_id_idx').on(table.serviceId),
		index('core_user_services_user_id_service_id_idx').on(table.userId, table.serviceId),
		unique('core_user_services_user_id_service_id_unique').on(table.userId, table.serviceId),
		index('core_user_services_enabled_idx').on(table.enabled),
	]
)

/**
 * User characters table - Linked characters for each user
 *
 * Users can have multiple characters linked to their account.
 * One character is always marked as primary (their main).
 */
export const userCharacters = pgTable(
	'user_characters',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Character owner hash (stored for transfer detection only) */
		characterOwnerHash: varchar('character_owner_hash', { length: 255 }).notNull(),
		/** EVE character ID (primary identifier) */
		characterId: text('character_id').notNull().unique(),
		/** EVE character name (cached from eve-token-store for convenience) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** EVE corporation ID */
		corporationId: text('corporation_id'),
		/** EVE corporation name */
		corporationName: varchar('corporation_name', { length: 255 }),
		/** EVE alliance ID */
		allianceId: text('alliance_id'),
		/** EVE alliance name */
		allianceName: varchar('alliance_name', { length: 255 }),
		/** Whether this is the user's primary character */
		is_primary: boolean('is_primary').default(false).notNull(),
		/** Cached token validity status (NULL = unknown, true = valid, false = invalid/expired) */
		hasValidToken: boolean('has_valid_token'),
		/** Character status: 'active' (default) or 'emeritus' (deceased player, excluded from statistics) */
		status: text('status', { enum: ['active', 'emeritus'] })
			.notNull()
			.default('active'),
		/** Last time character data was refreshed via background workflow */
		lastCharacterRefresh: timestamp('last_character_refresh', { withTimezone: true }),
		linkedAt: timestamp('linked_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
		isDeleted: boolean('deleted').default(false).notNull(),
	},
	(table) => [
		// Index for finding characters by user
		index('user_characters_user_id_idx').on(table.userId),
		// Index for finding user by characterId
		index('user_characters_character_id_idx').on(table.characterId),
		// Index for finding primary character (enforced in application logic: only one primary per user)
		index('user_characters_is_primary_idx').on(table.userId, table.is_primary),
		// Index for filtering by status (active vs emeritus)
		index('user_characters_status_idx').on(table.status),
		index('user_characters_deleted_idx').on(table.isDeleted),
		index('user_characters_corporation_id_idx').on(table.corporationId),
		index('user_characters_alliance_id_idx').on(table.allianceId),
		index('user_characters_corporation_name_idx').on(table.corporationName),
		index('user_characters_alliance_name_idx').on(table.allianceName),
	]
)

/**
 * User sessions table - Session management
 *
 * Sessions are stored in the database for revocation capability.
 * Each session has a unique token, expiration, and metadata.
 */
export const userSessions = pgTable(
	'user_sessions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Unique session token (UUID) */
		sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
		/** When the session expires */
		expiresAt: timestamp('expires_at').notNull(),
		/** Session metadata (IP, user agent, etc.) */
		metadata: jsonb('metadata').$type<{
			ip?: string
			userAgent?: string
			characterId?: string
		}>(),
		/** Last activity timestamp */
		lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('user_sessions_user_id_idx').on(table.userId),
		index('user_sessions_session_token_idx').on(table.sessionToken),
		index('user_sessions_expires_at_idx').on(table.expiresAt),
	]
)

/**
 * User preferences table - User settings
 *
 * Stores user preferences and UI settings.
 */
export const userPreferences = pgTable('user_preferences', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** JSONB preferences object */
	preferences: jsonb('preferences')
		.$type<{
			theme?: 'light' | 'dark' | 'auto'
			notifications?: {
				email?: boolean
				push?: boolean
			}
			[key: string]: unknown
		}>()
		.notNull()
		.default({}),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const sidebarExternalLinks = pgTable(
	'sidebar_external_links',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		displayName: text('display_name').notNull(),
		url: text('url').notNull(),
		iconName: text('icon_name').notNull(),
		sortOrder: integer('sort_order').default(0).notNull(),
		isEnabled: boolean('is_enabled').default(true).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [index('sidebar_external_links_sort_order_idx').on(table.sortOrder, table.displayName)]
)

/**
 * User activity log table - Audit trail
 *
 * Tracks important user actions for security and debugging.
 */
export const userActivityLog = pgTable(
	'user_activity_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		/** Action type (e.g., 'login', 'logout', 'character_linked', 'role_granted') */
		action: varchar('action', { length: 100 }).notNull(),
		/** Additional metadata about the action */
		metadata: jsonb('metadata').$type<{
			ip?: string
			userAgent?: string
			characterId?: string
			success?: boolean
			error?: string
			[key: string]: unknown
		}>(),
		timestamp: timestamp('timestamp').defaultNow().notNull(),
	},
	(table) => [
		index('user_activity_log_user_id_idx').on(table.userId),
		index('user_activity_log_action_idx').on(table.action),
		index('user_activity_log_timestamp_idx').on(table.timestamp),
	]
)

/**
 * OAuth states table - Track OAuth flow types
 *
 * Tracks OAuth state parameters to distinguish between login, character linking, and Discord linking flows.
 * States are short-lived and cleaned up after use or expiration.
 */
export const oauthStates = pgTable(
	'oauth_states',
	{
		/** OAuth state parameter (UUID) */
		state: varchar('state', { length: 255 }).primaryKey(),
		/** Flow type: 'login', 'character', or 'discord' */
		flowType: varchar('flow_type', { length: 50 }).notNull(),
		/** Optional user ID for character/discord linking (must be authenticated) */
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		/** Optional redirect URL after successful authentication */
		redirectUrl: varchar('redirect_url', { length: 500 }),
		/** Flow-specific context (e.g. mumble temp-op key/id for the guest SSO flow) */
		metadata: jsonb('metadata').$type<TempopOAuthMetadata | null>(),
		/** When this state was created */
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When this state expires (15 minutes from creation) */
		expiresAt: timestamp('expires_at').notNull(),
	},
	(table) => [index('oauth_states_expires_at_idx').on(table.expiresAt)]
)

export interface TempopOAuthMetadata {
	key: string
	tempopId: string
}

/**
 * Managed Corporations table - Global corporation registry for admin management
 *
 * Tracks EVE Online corporations configured for data collection.
 * Director characters are managed in the eve-corporation-data worker.
 * This table caches metadata and overall verification status.
 * assignedCharacterId represents the "primary" director for backwards compatibility.
 */
export const managedCorporations = pgTable(
	'managed_corporations',
	{
		/** EVE corporation ID */
		corporationId: text('corporation_id').primaryKey(),
		/** Corporation name (cached from ESI) */
		name: varchar('name', { length: 255 }).notNull(),
		/** Corporation ticker (cached from ESI) */
		ticker: varchar('ticker', { length: 10 }).notNull(),
		/** Primary director character ID (for backwards compatibility, can be null) */
		assignedCharacterId: text('assigned_character_id'),
		/** Primary director character name (cached) */
		assignedCharacterName: varchar('assigned_character_name', { length: 255 }),
		/** Whether this corporation is active for data collection */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether this corporation should be included in background data refresh */
		includeInBackgroundRefresh: boolean('include_in_background_refresh').default(false).notNull(),
		/** Whether this corporation should be included in structure asset snapshots */
		includeInStructureAssetSync: boolean('include_in_structure_asset_sync').default(false).notNull(),
		/** Last successful data sync timestamp */
		lastSync: timestamp('last_sync', { withTimezone: true }),
		/** Last verification timestamp (any director verified) */
		lastVerified: timestamp('last_verified', { withTimezone: true }),
		/** Whether at least one director has verified access */
		isVerified: boolean('is_verified').default(false).notNull(),
		/** Number of healthy directors currently available */
		healthyDirectorCount: integer('healthy_director_count').default(0).notNull(),
		/** Admin user who configured this corporation */
		configuredBy: uuid('configured_by').references(() => users.id, { onDelete: 'set null' }),
		/** Whether this corporation is a member corporation of the alliance */
		isMemberCorporation: boolean('is_member_corporation').default(false).notNull(),
		/** Whether this corporation is an alt corporation */
		isAltCorp: boolean('is_alt_corp').default(false).notNull(),
		/** Whether this corporation is a special purpose corporation */
		isSpecialPurpose: boolean('is_special_purpose').default(false).notNull(),
		/** Whether this corporation is actively recruiting (shown in browse corporations) */
		isRecruiting: boolean('is_recruiting').default(true).notNull(),
		/** Short description shown on browse corporations page (max 250 chars) */
		shortDescription: varchar('short_description', { length: 250 }),
		/** Full description and application instructions shown on corporation detail page */
		fullDescription: text('full_description'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('managed_corporations_name_idx').on(table.name),
		index('managed_corporations_ticker_idx').on(table.ticker),
		index('managed_corporations_assigned_character_id_idx').on(table.assignedCharacterId),
		index('managed_corporations_is_active_idx').on(table.isActive),
		index('managed_corporations_include_in_background_refresh_idx').on(
			table.includeInBackgroundRefresh
		),
		index('managed_corporations_include_in_structure_asset_sync_idx').on(
			table.includeInStructureAssetSync
		),
		index('managed_corporations_corporation_id_is_member_idx').on(
			table.corporationId,
			table.isMemberCorporation
		),
		index('managed_corporations_corporation_id_is_alt_idx').on(
			table.corporationId,
			table.isAltCorp
		),
		index('managed_corporations_corporation_id_is_special_purpose_idx').on(
			table.corporationId,
			table.isSpecialPurpose
		),
	]
)

/**
 * Discord Servers Registry
 *
 * Centralized registry of Discord servers that can be linked to corporations and groups.
 * Admins add servers here once and reuse across multiple entities.
 */
export const discordServers = pgTable(
	'discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Discord guild/server ID */
		guildId: text('guild_id').unique().notNull(),
		/** Discord guild/server name */
		guildName: text('guild_name').notNull(),
		/** Description/notes about this server */
		description: text('description'),
		/** Whether this server is active */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether to automatically manage user nicknames to match their primary character name */
		manageNicknames: boolean('manage_nicknames').default(false).notNull(),
		/** Admin user who added this server */
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_servers_guild_id_idx').on(table.guildId),
		index('discord_servers_active_idx')
			.on(table.isActive)
			.where(sql`${table.isActive} = true`),
	]
)

/**
 * Discord Roles
 *
 * Roles that exist within a Discord server in the registry.
 * These can be assigned to users when they join via auto-invite.
 */
export const discordRoles = pgTable(
	'discord_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which Discord server this role belongs to */
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		/** Discord role ID */
		roleId: text('role_id').notNull(),
		/** Discord role name */
		roleName: text('role_name').notNull(),
		/** Description/notes about this role */
		description: text('description'),
		/** Whether this role is active */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether this role should be auto-applied to all users joining through the system */
		autoApply: boolean('auto_apply').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_roles_server_id_idx').on(table.discordServerId),
		index('discord_roles_server_auto_apply_active_idx')
			.on(table.discordServerId, table.autoApply, table.isActive)
			.where(sql`${table.autoApply} = true AND ${table.isActive} = true`),
		unique('unique_discord_server_role').on(table.discordServerId, table.roleId),
	]
)

/**
 * Discord Command Categories
 *
 * Organizes slash commands in the admin UI.
 */
export const discordCommandCategories = pgTable(
	'discord_command_categories',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull().unique(),
		description: text('description'),
		sortOrder: integer('sort_order').default(0).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('discord_command_categories_sort_order_idx').on(table.sortOrder, table.name)]
)

/**
 * Discord Commands
 *
 * Stores slash command configuration and static response templates.
 */
export const discordCommands = pgTable(
	'discord_commands',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		categoryId: uuid('category_id').references(() => discordCommandCategories.id, {
			onDelete: 'set null',
		}),
		name: text('name').notNull().unique(),
		description: text('description').notNull(),
		commandType: text('command_type', { enum: ['static_response', 'programmatic'] })
			.default('static_response')
			.notNull(),
		responseTemplate: text('response_template'),
		isActive: boolean('is_active').default(true).notNull(),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
		(table) => [
			index('discord_commands_name_idx').on(table.name),
			index('discord_commands_type_idx').on(table.commandType),
			index('discord_commands_is_active_idx').on(table.isActive),
			index('discord_commands_category_id_idx').on(table.categoryId),
		]
)

/**
 * Discord Command Permissions
 *
 * Maps a command to one or more global permission IDs from Groups.
 */
export const discordCommandPermissions = pgTable(
	'discord_command_permissions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		commandId: uuid('command_id')
			.notNull()
			.references(() => discordCommands.id, { onDelete: 'cascade' }),
		permissionId: text('permission_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('discord_command_permissions_command_permission_unique').on(
			table.commandId,
			table.permissionId
		),
		index('discord_command_permissions_command_id_idx').on(table.commandId),
		index('discord_command_permissions_permission_id_idx').on(table.permissionId),
	]
)

/**
 * Discord Server Commands
 *
 * Attachments between command definitions and registered Discord servers.
 */
export const discordServerCommands = pgTable(
	'discord_server_commands',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		commandId: uuid('command_id')
			.notNull()
			.references(() => discordCommands.id, { onDelete: 'cascade' }),
		discordCommandId: text('discord_command_id'),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('discord_server_commands_server_command_unique').on(table.discordServerId, table.commandId),
		index('discord_server_commands_server_id_idx').on(table.discordServerId),
		index('discord_server_commands_command_id_idx').on(table.commandId),
	]
)

/**
 * Corporation Discord Servers
 *
 * Links corporations to Discord servers from the registry.
 * One corporation can have multiple Discord servers.
 */
export const corporationDiscordServers = pgTable(
	'corporation_discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which corporation this attachment belongs to */
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		/** Which Discord server from the registry */
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		/** Whether to automatically invite corporation members */
		autoInvite: boolean('auto_invite').default(false).notNull(),
		/** Whether to automatically assign roles on invite */
		autoAssignRoles: boolean('auto_assign_roles').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_servers_corp_id_idx').on(table.corporationId),
		index('corp_discord_servers_server_id_idx').on(table.discordServerId),
		index('corp_discord_servers_server_auto_assign_idx')
			.on(table.discordServerId, table.autoAssignRoles)
			.where(sql`${table.autoAssignRoles} = true`),
		unique('unique_corp_discord_server').on(table.corporationId, table.discordServerId),
	]
)

/**
 * Corporation Discord Server Scenario Roles
 *
 * Stores one row per bucket for corp member, alliance guest, and non-alliance guest role sync.
 */
export const corporationDiscordServerScenarioRoles = pgTable(
	'corporation_discord_server_scenario_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationDiscordServerId: uuid('corporation_discord_server_id')
			.notNull()
			.references(() => corporationDiscordServers.id, { onDelete: 'cascade' }),
		bucket: text('bucket', {
			enum: ['alliance_guest', 'non_alliance_guest'],
		}).notNull(),
		discordRoleId: uuid('discord_role_id').references(() => discordRoles.id, {
			onDelete: 'set null',
		}),
		autoApply: boolean('auto_apply').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_server_scenario_roles_attachment_idx').on(table.corporationDiscordServerId),
		unique('unique_corp_discord_server_scenario_role').on(
			table.corporationDiscordServerId,
			table.bucket
		),
	]
)

/**
 * Corporation Discord Server Nickname Configs
 *
 * Stores one row per nickname bucket, including All Members and the three member/guest buckets.
 */
export const corporationDiscordServerNicknameConfigs = pgTable(
	'corporation_discord_server_nickname_configs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationDiscordServerId: uuid('corporation_discord_server_id')
			.notNull()
			.references(() => corporationDiscordServers.id, { onDelete: 'cascade' }),
		bucket: text('bucket', {
			enum: ['corp_member', 'alliance_guest', 'non_alliance_guest'],
		}).notNull(),
		enabled: boolean('enabled').default(false).notNull(),
		source: text('source', {
			enum: ['corp', 'alliance', 'custom'],
		})
			.default('corp')
			.notNull(),
		customTicker: text('custom_ticker'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_server_nickname_configs_attachment_idx').on(
			table.corporationDiscordServerId
		),
		unique('unique_corp_discord_server_nickname_config').on(
			table.corporationDiscordServerId,
			table.bucket
		),
	]
)

/**
 * Corporation Discord Server Roles
 *
 * Roles to assign to users when they join a corporation's Discord server.
 * Links corporation_discord_servers to specific discord_roles.
 */
export const corporationDiscordServerRoles = pgTable(
	'corporation_discord_server_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which corporation-server attachment */
		corporationDiscordServerId: uuid('corporation_discord_server_id')
			.notNull()
			.references(() => corporationDiscordServers.id, { onDelete: 'cascade' }),
		/** Which role from the Discord server */
		discordRoleId: uuid('discord_role_id')
			.notNull()
			.references(() => discordRoles.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_server_roles_attachment_idx').on(table.corporationDiscordServerId),
		unique('unique_corp_discord_server_role').on(
			table.corporationDiscordServerId,
			table.discordRoleId
		),
	]
)

/**
 * Corporation Discord Invites audit table
 *
 * Tracks Discord server join attempts for corporation members.
 * Used for debugging and auditing auto-invite functionality.
 */
export const corporationDiscordInvites = pgTable(
	'corporation_discord_invites',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Corporation ID */
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		/** Corporation Discord Server attachment ID */
		corporationDiscordServerId: uuid('corporation_discord_server_id').references(
			() => corporationDiscordServers.id,
			{ onDelete: 'set null' }
		),
		/** User ID from core users table */
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Discord user ID */
		discordUserId: varchar('discord_user_id', { length: 255 }).notNull(),
		/** Whether the invite/join was successful */
		success: boolean('success').notNull(),
		/** Error message if invite failed */
		errorMessage: text('error_message'),
		/** Array of Discord role IDs that were assigned (if any) */
		assignedRoleIds: text('assigned_role_ids').array(),
		/** When the invite attempt was made */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corporation_discord_invites_corp_id_idx').on(table.corporationId),
		index('corporation_discord_invites_user_id_idx').on(table.userId),
		index('corporation_discord_invites_server_id_idx').on(table.corporationDiscordServerId),
		index('corporation_discord_invites_created_at_idx').on(table.createdAt),
	]
)

/**
 * Corporation Alert Destinations
 *
 * Generic alert routing configuration scoped to a corporation and alert type.
 * A single alert type can fan out to multiple destinations, and future destination
 * types can be introduced without schema churn.
 */
export const corporationAlertDestinations = pgTable(
	'corporation_alert_destinations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		alertType: text('alert_type').notNull(),
		destinationType: text('destination_type').notNull(),
		discordServerId: uuid('discord_server_id').references(() => discordServers.id, {
			onDelete: 'cascade',
		}),
		channelId: text('channel_id'),
		coreUserId: uuid('core_user_id').references(() => users.id, { onDelete: 'cascade' }),
		destinationConfig: jsonb('destination_config').$type<Record<string, unknown>>().notNull().default({}),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_alert_destinations_corp_id_idx').on(table.corporationId),
		index('corp_alert_destinations_alert_type_idx').on(table.alertType),
		index('corp_alert_destinations_enabled_idx').on(table.isEnabled),
		index('corp_alert_destinations_corp_alert_type_idx').on(table.corporationId, table.alertType),
	]
)

/**
 * Corporation Alert Configs
 *
 * Corporation-owned alert-type configuration that references shared destinations.
 */
export const corporationAlertConfigs = pgTable(
	'corporation_alert_configs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		alertType: text('alert_type').notNull(),
		destinationIds: uuid('destination_ids').array().notNull().default([]),
		config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
		isEnabled: boolean('is_enabled').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corporation_alert_configs_corp_idx').on(table.corporationId),
		index('corporation_alert_configs_alert_type_idx').on(table.alertType),
		index('corporation_alert_configs_enabled_idx').on(table.isEnabled),
		index('corporation_alert_configs_corp_alert_type_idx').on(table.corporationId, table.alertType),
		unique('corporation_alert_configs_corp_alert_type_unique').on(table.corporationId, table.alertType),
	]
)

/**
 * Discord Member Audit Runs
 *
 * Persisted async audit snapshots per Discord server.
 */
export const discordMemberAuditRuns = pgTable(
	'discord_member_audit_runs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		workflowInstanceId: text('workflow_instance_id').notNull().unique(),
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		guildId: text('guild_id').notNull(),
		guildName: text('guild_name').notNull(),
		initiatedByUserId: uuid('initiated_by_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		status: text('status', {
			enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
		})
			.notNull()
			.default('pending'),
		scanned: integer('scanned').notNull().default(0),
		linkedCount: integer('linked_count').notNull().default(0),
		unlinkedCount: integer('unlinked_count').notNull().default(0),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_member_audit_runs_server_started_idx').on(table.discordServerId, table.startedAt),
		index('discord_member_audit_runs_status_idx').on(table.status),
	]
)

/**
 * Discord Member Audit Rows
 *
 * Snapshot of members for a run with linked/unlinked enrichment.
 */
export const discordMemberAuditRows = pgTable(
	'discord_member_audit_rows',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		runId: uuid('run_id')
			.notNull()
			.references(() => discordMemberAuditRuns.id, { onDelete: 'cascade' }),
		discordUserId: text('discord_user_id').notNull(),
		username: text('username').notNull(),
		discriminator: text('discriminator').notNull(),
		displayName: text('display_name').notNull(),
		roleIds: text('role_ids').array().notNull().default([]),
		linked: boolean('linked').notNull(),
		coreUserId: uuid('core_user_id').references(() => users.id, { onDelete: 'set null' }),
		mainCharacterId: text('main_character_id'),
		mainCharacterName: text('main_character_name'),
		hasValidToken: boolean('has_valid_token'),
		corporationId: text('corporation_id'),
		corporationName: text('corporation_name'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_member_audit_rows_run_linked_user_idx').on(table.runId, table.linked, table.discordUserId),
		unique('discord_member_audit_rows_run_discord_user_unique').on(table.runId, table.discordUserId),
	]
)

/**
 * DKP Transactions table - Immutable ledger of all DKP activity
 *
 * Tracks all DKP earnings and spending for characters.
 * Character DKP automatically contributes to their corporation's total (shared pool).
 * Never UPDATE or DELETE transactions - only INSERT new ones.
 */
export const dkpTransactions = pgTable(
	'dkp_transactions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** User ID who owns the character (for efficient user-level queries) */
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		/** EVE character ID who earned/spent DKP */
		characterId: text('character_id').notNull(),
		/** Cached character name (avoids joins) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** EVE corporation ID (denormalized for query performance) */
		corporationId: text('corporation_id').notNull(),
		/** Cached corporation name (avoids joins) */
		corporationName: varchar('corporation_name', { length: 255 }).notNull(),
		/** DKP amount (positive for earning, negative for spending) */
		amount: integer('amount').notNull(),
		/** Source type of DKP award */
		sourceType: text('source_type', {
			enum: ['fleet', 'market', 'mining', 'manual', 'adjustment'],
		}).notNull(),
		/** Reference to source entity (fleet ID, killmail ID, etc.) */
		sourceId: text('source_id'),
		/** Additional metadata about the source */
		sourceMetadata: jsonb('source_metadata').$type<{
			fleetId?: string
			fleetType?: string
			killmailId?: string
			marketOrderId?: string
			miningOpId?: string
			itemTypeId?: string
			quantity?: number
			iskValue?: string
			[key: string]: unknown
		}>(),
		/** Admin user who awarded this DKP (null for automated awards) */
		awardedBy: uuid('awarded_by').references(() => users.id, { onDelete: 'set null' }),
		/** Reason for manual awards (required for manual type) */
		awardReason: text('award_reason'),
		/** Time decay model for inflation control (not yet applied) */
		decayModel: text('decay_model', {
			enum: ['none', 'percentage', 'linear', 'halflife'],
		})
			.default('none')
			.notNull(),
		/** Decay rate (e.g., "0.01" for 1% per period) */
		decayRate: text('decay_rate'),
		/** Decay period in days (e.g., 7 for weekly decay) */
		decayPeriodDays: integer('decay_period_days'),
		/** When the DKP was actually earned (can be backdated) */
		earnedAt: timestamp('earned_at', { withTimezone: true }).notNull(),
		/** When the transaction was recorded in the system */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// User-level queries (most common pattern)
		index('dkp_transactions_user_earned_idx').on(table.userId, table.earnedAt.desc()),
		index('dkp_transactions_user_source_idx').on(table.userId, table.sourceType),
		// Primary query patterns: character/corp + time range
		index('dkp_transactions_character_earned_idx').on(table.characterId, table.earnedAt.desc()),
		index('dkp_transactions_corp_earned_idx').on(table.corporationId, table.earnedAt.desc()),
		// Time-based filtering for leaderboards
		index('dkp_transactions_earned_at_idx').on(table.earnedAt.desc()),
		// Source tracking
		index('dkp_transactions_source_type_idx').on(table.sourceType),
		index('dkp_transactions_source_id_idx').on(table.sourceId),
		// Manual award auditing
		index('dkp_transactions_awarded_by_idx').on(table.awardedBy),
	]
)

/**
 * DKP Decay Configuration table - Global time decay settings
 *
 * Stores decay parameters that can be applied at query time.
 * Allows changing decay rules without migrating transaction data.
 * Only one config should be active at a time.
 */
export const dkpDecayConfig = pgTable(
	'dkp_decay_config',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Whether this configuration is currently active */
		isActive: boolean('is_active').default(false).notNull(),
		/** Decay model type */
		decayModel: text('decay_model', {
			enum: ['none', 'percentage', 'linear', 'halflife'],
		}).notNull(),
		/** Decay rate (e.g., "0.01" for 1% per period) */
		decayRate: text('decay_rate'),
		/** Decay period in days (e.g., 7 for weekly decay) */
		decayPeriodDays: integer('decay_period_days'),
		/** When this config becomes effective */
		effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
		/** When this config stops being effective (null = ongoing) */
		effectiveTo: timestamp('effective_to', { withTimezone: true }),
		/** Description of this decay configuration */
		description: text('description'),
		/** Admin user who created this configuration */
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Partial index for active config (only one should be active)
		index('dkp_decay_config_active_idx')
			.on(table.isActive)
			.where(sql`${table.isActive} = true`),
		index('dkp_decay_config_effective_from_idx').on(table.effectiveFrom),
	]
)

/**
 * Relations
 */
export const usersRelations = relations(users, ({ many, one }) => ({
	characters: many(userCharacters),
	sessions: many(userSessions),
	preferences: one(userPreferences),
	activityLog: many(userActivityLog),
}))

export const userCharactersRelations = relations(userCharacters, ({ one }) => ({
	user: one(users, {
		fields: [userCharacters.userId],
		references: [users.id],
	}),
}))

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id],
	}),
}))

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
	user: one(users, {
		fields: [userPreferences.userId],
		references: [users.id],
	}),
}))

export const userActivityLogRelations = relations(userActivityLog, ({ one }) => ({
	user: one(users, {
		fields: [userActivityLog.userId],
		references: [users.id],
	}),
}))

export const managedCorporationsRelations = relations(managedCorporations, ({ one, many }) => ({
	configuredByUser: one(users, {
		fields: [managedCorporations.configuredBy],
		references: [users.id],
	}),
	discordServers: many(corporationDiscordServers),
	discordInvites: many(corporationDiscordInvites),
}))

export const discordServersRelations = relations(discordServers, ({ one, many }) => ({
	createdByUser: one(users, {
		fields: [discordServers.createdBy],
		references: [users.id],
	}),
	roles: many(discordRoles),
	commandAttachments: many(discordServerCommands),
	corporationAttachments: many(corporationDiscordServers),
	auditRuns: many(discordMemberAuditRuns),
}))

export const discordMemberAuditRunsRelations = relations(discordMemberAuditRuns, ({ one, many }) => ({
	discordServer: one(discordServers, {
		fields: [discordMemberAuditRuns.discordServerId],
		references: [discordServers.id],
	}),
	initiatedByUser: one(users, {
		fields: [discordMemberAuditRuns.initiatedByUserId],
		references: [users.id],
	}),
	rows: many(discordMemberAuditRows),
}))

export const discordMemberAuditRowsRelations = relations(discordMemberAuditRows, ({ one }) => ({
	run: one(discordMemberAuditRuns, {
		fields: [discordMemberAuditRows.runId],
		references: [discordMemberAuditRuns.id],
	}),
	coreUser: one(users, {
		fields: [discordMemberAuditRows.coreUserId],
		references: [users.id],
	}),
}))

export const discordRolesRelations = relations(discordRoles, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [discordRoles.discordServerId],
		references: [discordServers.id],
	}),
}))

export const discordCommandCategoriesRelations = relations(discordCommandCategories, ({ many }) => ({
	commands: many(discordCommands),
}))

export const discordCommandsRelations = relations(discordCommands, ({ one, many }) => ({
	category: one(discordCommandCategories, {
		fields: [discordCommands.categoryId],
		references: [discordCommandCategories.id],
	}),
	createdByUser: one(users, {
		fields: [discordCommands.createdBy],
		references: [users.id],
	}),
	requiredPermissions: many(discordCommandPermissions),
	serverAttachments: many(discordServerCommands),
}))

export const discordCommandPermissionsRelations = relations(discordCommandPermissions, ({ one }) => ({
	command: one(discordCommands, {
		fields: [discordCommandPermissions.commandId],
		references: [discordCommands.id],
	}),
}))

export const discordServerCommandsRelations = relations(discordServerCommands, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [discordServerCommands.discordServerId],
		references: [discordServers.id],
	}),
	command: one(discordCommands, {
		fields: [discordServerCommands.commandId],
		references: [discordCommands.id],
	}),
	createdByUser: one(users, {
		fields: [discordServerCommands.createdBy],
		references: [users.id],
	}),
}))

export const corporationDiscordServersRelations = relations(
	corporationDiscordServers,
	({ one, many }) => ({
		corporation: one(managedCorporations, {
			fields: [corporationDiscordServers.corporationId],
			references: [managedCorporations.corporationId],
		}),
		discordServer: one(discordServers, {
			fields: [corporationDiscordServers.discordServerId],
			references: [discordServers.id],
		}),
		scenarioRoles: many(corporationDiscordServerScenarioRoles),
		nicknameConfigs: many(corporationDiscordServerNicknameConfigs),
		roles: many(corporationDiscordServerRoles),
		invites: many(corporationDiscordInvites),
	})
)

export const corporationDiscordServerScenarioRolesRelations = relations(
	corporationDiscordServerScenarioRoles,
	({ one }) => ({
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordServerScenarioRoles.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
		discordRole: one(discordRoles, {
			fields: [corporationDiscordServerScenarioRoles.discordRoleId],
			references: [discordRoles.id],
		}),
	})
)

export const corporationDiscordServerNicknameConfigsRelations = relations(
	corporationDiscordServerNicknameConfigs,
	({ one }) => ({
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordServerNicknameConfigs.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
	})
)

export const corporationDiscordServerRolesRelations = relations(
	corporationDiscordServerRoles,
	({ one }) => ({
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordServerRoles.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
		discordRole: one(discordRoles, {
			fields: [corporationDiscordServerRoles.discordRoleId],
			references: [discordRoles.id],
		}),
	})
)

export const corporationDiscordInvitesRelations = relations(
	corporationDiscordInvites,
	({ one }) => ({
		corporation: one(managedCorporations, {
			fields: [corporationDiscordInvites.corporationId],
			references: [managedCorporations.corporationId],
		}),
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordInvites.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
		user: one(users, {
			fields: [corporationDiscordInvites.userId],
			references: [users.id],
		}),
	})
)

export const corporationAlertDestinationsRelations = relations(
	corporationAlertDestinations,
	({ one }) => ({
		corporation: one(managedCorporations, {
			fields: [corporationAlertDestinations.corporationId],
			references: [managedCorporations.corporationId],
		}),
		discordServer: one(discordServers, {
			fields: [corporationAlertDestinations.discordServerId],
			references: [discordServers.id],
		}),
		createdByUser: one(users, {
			fields: [corporationAlertDestinations.createdBy],
			references: [users.id],
		}),
		updatedByUser: one(users, {
			fields: [corporationAlertDestinations.updatedBy],
			references: [users.id],
		}),
	})
)

export const alertDestinationsRelations = relations(alertDestinations, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [alertDestinations.discordServerId],
		references: [discordServers.id],
	}),
	createdByUser: one(users, {
		fields: [alertDestinations.createdBy],
		references: [users.id],
	}),
	updatedByUser: one(users, {
		fields: [alertDestinations.updatedBy],
		references: [users.id],
	}),
}))

export const dkpTransactionsRelations = relations(dkpTransactions, ({ one }) => ({
	awardedByUser: one(users, {
		fields: [dkpTransactions.awardedBy],
		references: [users.id],
	}),
}))

export const dkpDecayConfigRelations = relations(dkpDecayConfig, ({ one }) => ({
	createdByUser: one(users, {
		fields: [dkpDecayConfig.createdBy],
		references: [users.id],
	}),
}))

/**
 * Mumble temp-ops table - TTL-bound public links granting temporary voice access
 *
 * A permitted user generates a temp-op with a TTL; anyone with the link identifies
 * via a minimal-scope EVE SSO and receives an ephemeral, per-guest Mumble credential
 * scoped to a dedicated group. Deleting the temp-op (or expiry) disconnects every guest.
 */
export const mumbleTempops = pgTable(
	'mumble_tempops',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Short, human-friendly code surfaced in the guest's Mumble display name */
		shortCode: varchar('short_code', { length: 8 }).notNull().unique(),
		/** SHA-256 hex of the URL token; the raw token is never stored */
		keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
		/** User who created the temp-op */
		creatorUserId: uuid('creator_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Target Mumble group, snapshotted at creation */
		groupName: varchar('group_name', { length: 120 }).notNull(),
		/** Chosen TTL in seconds (<= 43200 = 12h) */
		ttlSeconds: integer('ttl_seconds').notNull(),
		/** Lifecycle status: 'active' | 'expired' | 'deleted' */
		status: varchar('status', { length: 20 }).default('active').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		/** Set when manually deleted or swept by the expiry job */
		deletedAt: timestamp('deleted_at'),
	},
	(table) => [
		index('mumble_tempops_status_expires_at_idx').on(table.status, table.expiresAt),
		index('mumble_tempops_creator_user_id_idx').on(table.creatorUserId),
	]
)

/**
 * Mumble temp-op guests table - Per-guest ephemeral accounts created via a temp-op link
 *
 * Each guest who completes the publicData SSO gets a row here plus a murmur-control
 * local account keyed by `subjectId`. Affiliation is captured for display only.
 */
export const mumbleTempopGuests = pgTable(
	'mumble_tempop_guests',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		tempopId: uuid('tempop_id')
			.notNull()
			.references(() => mumbleTempops.id, { onDelete: 'cascade' }),
		/** EVE character ID (string form, matches userCharacters.characterId) */
		characterId: varchar('character_id', { length: 32 }).notNull(),
		characterName: varchar('character_name', { length: 255 }).notNull(),
	corporationId: varchar('corporation_id', { length: 32 }),
	allianceId: varchar('alliance_id', { length: 32 }),
	corpTicker: varchar('corp_ticker', { length: 8 }),
	/** murmur-control subject key: `tempop:<tempopId>:<characterId>` */
	subjectId: varchar('subject_id', { length: 255 }).notNull().unique(),
		loginName: varchar('login_name', { length: 60 }).notNull(),
		/** Lifecycle status: 'active' | 'deleted' */
		status: varchar('status', { length: 20 }).default('active').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('mumble_tempop_guests_tempop_id_idx').on(table.tempopId),
		unique('mumble_tempop_guests_tempop_character_uq').on(table.tempopId, table.characterId),
	]
)

/**
 * Mumble temp-op credential handoff table - Short-lived single-use credential bridge
 *
 * The guest's one-time Mumble password is provisioned inside the SSO callback and must
 * not leak via query strings/logs. The callback stores the credentials keyed by the
 * SHA-256 of a random handoff token (60s TTL), redirects with only the token, and the
 * SPA exchanges it exactly once. Expired rows are swept by the temp-op expiry job.
 */
export const mumbleTempopCredentialHandoffs = pgTable(
	'mumble_tempop_credential_handoffs',
	{
		/** SHA-256 hex of the single-use handoff token */
		tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
		tempopId: uuid('tempop_id')
			.notNull()
			.references(() => mumbleTempops.id, { onDelete: 'cascade' }),
		/** One-time plaintext credentials payload { loginName, password, host, port } */
		credentials: jsonb('credentials')
			.$type<{ loginName: string; password: string; host: string; port: number }>()
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		expiresAt: timestamp('expires_at').notNull(),
	},
	(table) => [index('mumble_tempop_credential_handoffs_expires_at_idx').on(table.expiresAt)]
)

export const mumbleTempopsRelations = relations(mumbleTempops, ({ one, many }) => ({
	creator: one(users, {
		fields: [mumbleTempops.creatorUserId],
		references: [users.id],
	}),
	guests: many(mumbleTempopGuests),
}))

export const mumbleTempopGuestsRelations = relations(mumbleTempopGuests, ({ one }) => ({
	tempop: one(mumbleTempops, {
		fields: [mumbleTempopGuests.tempopId],
		references: [mumbleTempops.id],
	}),
}))

/**
 * Why a user landed on the eligible/ineligible side of the services rule.
 *
 * Declared here rather than in lib/service-eligibility.ts so the Postgres enum
 * and the TypeScript union are literally the same list and cannot drift — the
 * rule module imports this. (The dependency only runs this direction:
 * service-eligibility.ts already imports this schema, so the reverse would be a
 * cycle.)
 *
 * Diagnostic only: a subcode never changes the outcome. "3,900 null_corp" is a
 * recognisably broken ESI sync; "3,900 ineligible" is unreviewable at 04:00.
 */
export const SERVICE_ELIGIBILITY_REASONS = [
	/** Eligible: a non-deleted character sits in a member corporation. */
	'member_corp',
	/** Eligible: no member-corp attachment, but `users.is_admin`. */
	'admin_exempt',
	/** Ineligible: no non-deleted characters at all. */
	'no_characters',
	/** Ineligible: characters exist, every one has a NULL corporation. */
	'null_corp',
	/** Ineligible: the qualifying character(s) are soft-deleted. */
	'only_deleted_member_char',
	/** Ineligible: has corporations, none flagged `is_member_corporation`. */
	'unmanaged_corp',
	/** Ineligible: no `users` row exists. */
	'no_user_row',
] as const

/**
 * Service Access Audit Runs
 *
 * Break-glass tool: scan every user against the member-corporation rule, review
 * the blast radius, then on explicit confirmation revoke the ineligible.
 *
 * NOT a reuse of discord_member_audit_runs/rows. That pair is guild-scoped
 * (discord_server_id NOT NULL cascade) and keyed unique(run_id, discord_user_id)
 * with discord_user_id NOT NULL. This audit is user-keyed and MUST include users
 * with no Discord account at all, so reuse would mean nullable-ing five NOT NULL
 * columns and rekeying a live table.
 */
export const serviceAccessAuditRuns = pgTable(
	'service_access_audit_runs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		scanWorkflowInstanceId: text('scan_workflow_instance_id').unique(),
		enforceWorkflowInstanceId: text('enforce_workflow_instance_id').unique(),
		status: text('status', {
			enum: [
				/** Scan in flight. */
				'scanning',
				/** A basis assertion tripped. Terminal, and NOT overridable. */
				'blocked',
				/** Scan done, ineligible users found, waiting on a human. */
				'awaiting_confirmation',
				/** Enforcement in flight. */
				'enforcing',
				'completed',
				/** Enforced, but some rows failed. Distinct so it cannot read as clean. */
				'completed_with_errors',
				'failed',
				'cancelled',
			],
		})
			.notNull()
			.default('scanning'),
		/**
		 * Holds a constant while the run is non-terminal, NULL once terminal.
		 * Postgres ignores NULLs in unique indexes, so this permits exactly one
		 * live run and a concurrent insert 23505s. No DO, no distributed lock.
		 */
		activeLock: text('active_lock'),
		/** 'set null', NOT the precedent's cascade: deleting the admin must not
		 * erase the record of what they did. */
		initiatedByUserId: uuid('initiated_by_user_id').references(() => users.id, {
			onDelete: 'set null',
		}),
		enforcedByUserId: uuid('enforced_by_user_id').references(() => users.id, {
			onDelete: 'set null',
		}),
		/** Free-text justification captured at confirmation time. */
		enforceReason: text('enforce_reason'),
		/**
		 * THE ELIGIBILITY BASIS, snapshotted. `is_member_corporation` is
		 * `.default(false).notNull()` — the basis defaults to the REVOKING value, so
		 * an empty or half-restored managed_corporations does not degrade the rule,
		 * it inverts it. Snapshotted so a run can be audited after the fact and so
		 * the next run can assert the basis did not shrink.
		 */
		memberCorporationIds: text('member_corporation_ids').array().notNull().default([]),
		memberCorpCount: integer('member_corp_count').notNull().default(0),
		/** Every user row walked, including eligible ones. */
		scanned: integer('scanned').notNull().default(0),
		/** Users holding a Mumble account or a Discord link — reported alongside
		 * `scanned` and never instead of it: an emergency tool must not silently
		 * narrow its own denominator. */
		inPopulation: integer('in_population').notNull().default(0),
		eligibleCount: integer('eligible_count').notNull().default(0),
		ineligibleCount: integer('ineligible_count').notNull().default(0),
		/** Set when the >20% heuristic trips; overridable by the typed phrase,
		 * unlike a basis assertion. */
		blastRadiusTripped: boolean('blast_radius_tripped').notNull().default(false),
		errorMessage: text('error_message'),
		startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		enforceStartedAt: timestamp('enforce_started_at', { withTimezone: true }),
		enforceCompletedAt: timestamp('enforce_completed_at', { withTimezone: true }),
		/** Retention horizon. Swept by a FILTERED branch that must never touch a
		 * live run — unlike the discord-audit cleanup, which truncates
		 * unconditionally at midnight. */
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('service_access_audit_runs_status_started_idx').on(table.status, table.startedAt),
		index('service_access_audit_runs_expires_at_idx').on(table.expiresAt),
		unique('service_access_audit_runs_active_lock_unique').on(table.activeLock),
	]
)

/**
 * Service Access Audit Rows — one per user per run.
 *
 * Unlike the discord-audit rows (write-once inserts, wiped wholesale), these are
 * mutated by enforcement, hence `updatedAt` and the per-service statuses.
 */
export const serviceAccessAuditRows = pgTable(
	'service_access_audit_rows',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		runId: uuid('run_id')
			.notNull()
			.references(() => serviceAccessAuditRuns.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Snapshotted so the row stays readable when the character is renamed or
		 * unlinked. Counts are abstract; names are not. */
		mainCharacterId: text('main_character_id'),
		mainCharacterName: text('main_character_name'),
		eligible: boolean('eligible').notNull(),
		reason: text('reason', { enum: SERVICE_ELIGIBILITY_REASONS }).notNull(),
		/** Corporations held at scan time — the evidence for the verdict. */
		corporationIds: text('corporation_ids').array().notNull().default([]),
		hasDiscordLink: boolean('has_discord_link').notNull().default(false),

		/**
		 * Mumble enforcement outcome.
		 * `queued` is NOT `deleted`: the DO persists control-plane failures and
		 * retries by alarm, so the account is live until observed absent.
		 * `confirmed_absent` is the ONLY value that may count toward the number
		 * shown to an operator — a mutation's own return value must never be the
		 * evidence of its success.
		 */
		mumbleStatus: text('mumble_status', {
			enum: [
				'pending',
				'skipped',
				'not_provisioned',
				'queued',
				'confirmed_absent',
				'verify_failed',
				'failed',
				'unknown',
			],
		})
			.notNull()
			.default('pending'),
		mumbleErrorMessage: text('mumble_error_message'),
		/**
		 * Discord enforcement outcome.
		 * `not_in_guild` is a terminal SUCCESS (access is definitionally revoked),
		 * not a failure. `no_op_unverified` is the amber case where the primitive
		 * returned no per-guild results at all — indistinguishable from "did
		 * nothing", so it is never counted as stripped.
		 */
		discordStatus: text('discord_status', {
			enum: [
				'pending',
				'skipped',
				'not_linked',
				'stripped',
				'no_change',
				'not_in_guild',
				'no_op_unverified',
				'failed',
				'unknown',
			],
		})
			.notNull()
			.default('pending'),
		discordErrorMessage: text('discord_error_message'),

		/**
		 * RECONSTRUCTION SNAPSHOT — captured BEFORE the mutation, by the worker
		 * that mutates. Mumble deletion is irreversible and there is no bulk
		 * re-provision, so this is the only record of what existed. Do not cut it.
		 */
		mumbleLoginName: text('mumble_login_name'),
		mumbleDisplayName: text('mumble_display_name'),
		mumbleGroups: text('mumble_groups').array(),
		mumbleWasEnabled: boolean('mumble_was_enabled'),
		/** Written by the enforcement child from its own return value. */
		discordRolesRemoved: text('discord_roles_removed').array(),

		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('service_access_audit_rows_run_eligible_idx').on(table.runId, table.eligible),
		index('service_access_audit_rows_run_reason_idx').on(table.runId, table.reason),
		index('service_access_audit_rows_run_mumble_status_idx').on(table.runId, table.mumbleStatus),
		index('service_access_audit_rows_run_discord_status_idx').on(table.runId, table.discordStatus),
		unique('service_access_audit_rows_run_user_unique').on(table.runId, table.userId),
	]
)

export const serviceAccessAuditRunsRelations = relations(
	serviceAccessAuditRuns,
	({ one, many }) => ({
		// Both FKs point at `users`. relationName is not strictly required while
		// usersRelations declares no back-reference to this table (fields/references
		// are explicit, so drizzle can already tell them apart) — it is set so that
		// adding a `many(serviceAccessAuditRuns)` there later cannot make the pair
		// ambiguous.
		initiatedByUser: one(users, {
			fields: [serviceAccessAuditRuns.initiatedByUserId],
			references: [users.id],
			relationName: 'serviceAccessAuditRunInitiatedBy',
		}),
		enforcedByUser: one(users, {
			fields: [serviceAccessAuditRuns.enforcedByUserId],
			references: [users.id],
			relationName: 'serviceAccessAuditRunEnforcedBy',
		}),
		rows: many(serviceAccessAuditRows),
	})
)

export const serviceAccessAuditRowsRelations = relations(serviceAccessAuditRows, ({ one }) => ({
	run: one(serviceAccessAuditRuns, {
		fields: [serviceAccessAuditRows.runId],
		references: [serviceAccessAuditRuns.id],
	}),
	user: one(users, {
		fields: [serviceAccessAuditRows.userId],
		references: [users.id],
	}),
}))

/**
 * Export schema for db client
 */
export const schema = {
	users,
	userCharacters,
	userIpAddresses,
	userSessions,
	userPreferences,
	userActivityLog,
	oauthStates,
	managedCorporations,
	discordServers,
	discordRoles,
	discordMemberAuditRuns,
	discordMemberAuditRows,
	discordCommandCategories,
	discordCommands,
	discordCommandPermissions,
	discordServerCommands,
	corporationDiscordServers,
	corporationDiscordServerScenarioRoles,
	corporationDiscordServerNicknameConfigs,
	corporationDiscordServerRoles,
	corporationDiscordInvites,
	alertDestinations,
	corporationAlertDestinations,
	corporationAlertConfigs,
	dkpTransactions,
	dkpDecayConfig,
	mumbleTempops,
	mumbleTempopGuests,
	mumbleTempopCredentialHandoffs,
	serviceAccessAuditRuns,
	serviceAccessAuditRows,
	usersRelations,
	userCharactersRelations,
	userSessionsRelations,
	userPreferencesRelations,
	userActivityLogRelations,
	managedCorporationsRelations,
	discordServersRelations,
	discordRolesRelations,
	discordMemberAuditRunsRelations,
	discordMemberAuditRowsRelations,
	discordCommandCategoriesRelations,
	discordCommandsRelations,
	discordCommandPermissionsRelations,
	discordServerCommandsRelations,
	corporationDiscordServersRelations,
	corporationDiscordServerScenarioRolesRelations,
	corporationDiscordServerNicknameConfigsRelations,
	corporationDiscordServerRolesRelations,
	corporationDiscordInvitesRelations,
	corporationAlertDestinationsRelations,
	alertDestinationsRelations,
	dkpTransactionsRelations,
	dkpDecayConfigRelations,
	mumbleTempopsRelations,
	mumbleTempopGuestsRelations,
	serviceAccessAuditRunsRelations,
	serviceAccessAuditRowsRelations,
}

/**
 * Prediction-markets Discord forum config (one row per guild).
 *
 * Core owns Discord orchestration, so this config lives in the core DB. The forum
 * channel is bot-created once under the configured category (`ensureForumChannel`):
 * a row is inserted as a "claim" (forumChannelId null) to serialize the create, then
 * updated with the created channel id + the four status-tag ids. `guildId` as the PK
 * makes the claim atomic (ON CONFLICT DO NOTHING) so a concurrent first-create can't
 * spawn two forum channels.
 */
export const pmForumConfig = pgTable('pm_forum_config', {
	guildId: text('guild_id').primaryKey(),
	categoryId: text('category_id').notNull(),
	/** Null while a create is in progress (the claim row); set once the channel exists. */
	forumChannelId: text('forum_channel_id'),
	tagOpenId: text('tag_open_id'),
	tagClosedId: text('tag_closed_id'),
	tagResolvedId: text('tag_resolved_id'),
	tagVoidedId: text('tag_voided_id'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
