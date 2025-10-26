import { relations } from 'drizzle-orm'
import {
	bigint,
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Enums
 */

/** Visibility for categories and groups */
export const visibilityEnum = pgEnum('visibility', ['public', 'hidden', 'system'])

/** Group creation permission level for categories */
export const categoryPermissionEnum = pgEnum('category_permission', ['anyone', 'admin_only'])

/** Group join modes */
export const joinModeEnum = pgEnum('join_mode', ['open', 'approval', 'invitation_only'])

/** Invitation status */
export const invitationStatusEnum = pgEnum('invitation_status', [
	'pending',
	'accepted',
	'declined',
	'expired',
])

/** Join request status */
export const joinRequestStatusEnum = pgEnum('join_request_status', [
	'pending',
	'approved',
	'rejected',
	'cancelled',
])

/** Permission target - defines who receives the permission */
export const permissionTargetEnum = pgEnum('permission_target', [
	'all_members',
	'all_admins',
	'owner_only',
	'owner_and_admins',
])

/**
 * Categories table - Organizational containers for groups
 *
 * Categories group related groups together and control who can create groups within them.
 * Only system admins can create and manage categories.
 */
export const categories = pgTable(
	'categories',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Category name (must be unique) */
		name: varchar('name', { length: 255 }).notNull().unique(),
		/** Category description */
		description: text('description'),
		/** Visibility level */
		visibility: visibilityEnum('visibility').notNull().default('public'),
		/** Who can create groups in this category */
		allowGroupCreation: categoryPermissionEnum('allow_group_creation').notNull().default('anyone'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [index('categories_visibility_idx').on(table.visibility)]
)

/**
 * Groups table - User-created groups within categories
 *
 * Groups have an owner, can have admins, and members can join based on the join mode.
 */
export const groups = pgTable(
	'groups',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Parent category */
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		/** Group name */
		name: varchar('name', { length: 255 }).notNull(),
		/** Group description */
		description: text('description'),
		/** Visibility level */
		visibility: visibilityEnum('visibility').notNull().default('public'),
		/** How users can join this group */
		joinMode: joinModeEnum('join_mode').notNull().default('open'),
		/** User ID of the group owner (references core.users.id) */
		ownerId: varchar('owner_id', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('groups_category_id_idx').on(table.categoryId),
		index('groups_owner_id_idx').on(table.ownerId),
		index('groups_visibility_idx').on(table.visibility),
		// Unique group name within a category
		unique('unique_group_name_per_category').on(table.categoryId, table.name),
	]
)

/**
 * Group members table - Tracks membership in groups
 *
 * Users are members of groups (not categories directly).
 */
export const groupMembers = pgTable(
	'group_members',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** User ID (references core.users.id) */
		userId: varchar('user_id', { length: 255 }).notNull(),
		joinedAt: timestamp('joined_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_members_group_id_idx').on(table.groupId),
		index('group_members_user_id_idx').on(table.userId),
		// Composite index for batched membership queries (used in listGroups)
		index('group_members_user_group_idx').on(table.userId, table.groupId),
		// One membership per user per group
		unique('unique_group_member').on(table.groupId, table.userId),
	]
)

/**
 * Group admins table - Tracks admin designations
 *
 * Group owners can designate members as admins who can approve join requests and remove members.
 */
export const groupAdmins = pgTable(
	'group_admins',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** User ID (references core.users.id) - must also be a group member */
		userId: varchar('user_id', { length: 255 }).notNull(),
		designatedAt: timestamp('designated_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_admins_group_id_idx').on(table.groupId),
		index('group_admins_user_id_idx').on(table.userId),
		// Composite index for batched admin queries (used in listGroups)
		index('group_admins_user_group_idx').on(table.userId, table.groupId),
		// One admin designation per user per group
		unique('unique_group_admin').on(table.groupId, table.userId),
	]
)

/**
 * Group invitations table - Direct invitations from owner/admins
 *
 * Invitations are sent to users by their main character name.
 * Users must accept the invitation to join. Invitations expire after 7 days.
 */
export const groupInvitations = pgTable(
	'group_invitations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** User ID of the inviter (references core.users.id) */
		inviterId: varchar('inviter_id', { length: 255 }).notNull(),
		/** Main character ID being invited */
		inviteeMainCharacterId: text('invitee_main_character_id').notNull(),
		/** Resolved user ID of the invitee (references core.users.id) */
		inviteeUserId: varchar('invitee_user_id', { length: 255 }),
		/** Invitation status */
		status: invitationStatusEnum('status').notNull().default('pending'),
		/** When the invitation expires (7 days from creation) */
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When the user responded to the invitation */
		respondedAt: timestamp('responded_at'),
	},
	(table) => [
		index('group_invitations_group_id_idx').on(table.groupId),
		index('group_invitations_invitee_user_id_idx').on(table.inviteeUserId),
		index('group_invitations_status_idx').on(table.status),
		index('group_invitations_expires_at_idx').on(table.expiresAt),
	]
)

/**
 * Group invite codes table - Reusable invite codes/tokens
 *
 * Group owners can create invite codes that can be used multiple times (up to a limit).
 * Codes can expire and be revoked. Redemption automatically adds the user to the group.
 */
export const groupInviteCodes = pgTable(
	'group_invite_codes',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** Unique invite code (random alphanumeric string) */
		code: varchar('code', { length: 32 }).notNull().unique(),
		/** User ID of the code creator (references core.users.id) */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		/** Maximum number of times this code can be used (null = unlimited) */
		maxUses: integer('max_uses'),
		/** Current number of times this code has been used */
		currentUses: integer('current_uses').notNull().default(0),
		/** When the code expires (max 30 days from creation) */
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When the code was revoked (null = active) */
		revokedAt: timestamp('revoked_at'),
	},
	(table) => [
		index('group_invite_codes_group_id_idx').on(table.groupId),
		index('group_invite_codes_code_idx').on(table.code),
		index('group_invite_codes_expires_at_idx').on(table.expiresAt),
	]
)

/**
 * Group invite code redemptions table - Track who redeemed which codes
 *
 * Prevents duplicate redemptions by the same user.
 */
export const groupInviteCodeRedemptions = pgTable(
	'group_invite_code_redemptions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		inviteCodeId: uuid('invite_code_id')
			.notNull()
			.references(() => groupInviteCodes.id, { onDelete: 'cascade' }),
		/** User ID who redeemed the code (references core.users.id) */
		userId: varchar('user_id', { length: 255 }).notNull(),
		redeemedAt: timestamp('redeemed_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_invite_code_redemptions_invite_code_id_idx').on(table.inviteCodeId),
		index('group_invite_code_redemptions_user_id_idx').on(table.userId),
		// One redemption per user per code
		unique('unique_code_redemption').on(table.inviteCodeId, table.userId),
	]
)

/**
 * Group join requests table - Requests to join approval-mode groups
 *
 * Users can request to join groups with join_mode='approval'.
 * Group admins can approve or reject these requests.
 */
export const groupJoinRequests = pgTable(
	'group_join_requests',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** User ID requesting to join (references core.users.id) */
		userId: varchar('user_id', { length: 255 }).notNull(),
		/** Optional reason/message from the user */
		reason: text('reason'),
		/** Request status */
		status: joinRequestStatusEnum('status').notNull().default('pending'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When the request was responded to */
		respondedAt: timestamp('responded_at'),
		/** User ID of the admin who responded (references core.users.id) */
		respondedBy: varchar('responded_by', { length: 255 }),
	},
	(table) => [
		index('group_join_requests_group_id_idx').on(table.groupId),
		index('group_join_requests_user_id_idx').on(table.userId),
		index('group_join_requests_status_idx').on(table.status),
		// One pending request per user per group
		unique('unique_pending_join_request').on(table.groupId, table.userId, table.status),
	]
)

/**
 * Group Discord servers table - Discord servers linked to groups
 *
 * Groups can have multiple Discord servers configured for auto-invite.
 * References Discord servers from the registry in core database.
 */
export const groupDiscordServers = pgTable(
	'group_discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** Discord server ID from registry (references core.discord_servers.id) */
		discordServerId: uuid('discord_server_id').notNull(),
		/** Whether to automatically invite group members to this server */
		autoInvite: boolean('auto_invite').notNull().default(false),
		/** Whether to automatically assign roles on invite */
		autoAssignRoles: boolean('auto_assign_roles').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_discord_servers_group_id_idx').on(table.groupId),
		index('group_discord_servers_server_id_idx').on(table.discordServerId),
		index('group_discord_servers_auto_invite_idx').on(table.autoInvite),
		// One Discord server per group (unique server ID per group)
		unique('unique_group_discord_server').on(table.groupId, table.discordServerId),
	]
)

/**
 * Group Discord Server Roles
 *
 * Roles to assign to users when they join a group's Discord server.
 * Links group_discord_servers to specific roles from the core Discord registry.
 */
export const groupDiscordServerRoles = pgTable(
	'group_discord_server_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which group-server attachment */
		groupDiscordServerId: uuid('group_discord_server_id')
			.notNull()
			.references(() => groupDiscordServers.id, { onDelete: 'cascade' }),
		/** Which role from the Discord server (references core.discord_roles.id) */
		discordRoleId: uuid('discord_role_id').notNull(),
		/** Role name cached for display */
		roleName: text('role_name').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_discord_server_roles_attachment_idx').on(table.groupDiscordServerId),
		unique('unique_group_discord_server_role').on(table.groupDiscordServerId, table.discordRoleId),
	]
)

/**
 * Group Discord invites table - Audit log for Discord invite attempts
 *
 * Tracks Discord server join attempts for group members.
 * Used for debugging and auditing auto-invite functionality.
 */
export const groupDiscordInvites = pgTable(
	'group_discord_invites',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Group ID */
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** Group Discord Server attachment that triggered this invite */
		groupDiscordServerId: uuid('group_discord_server_id')
			.notNull()
			.references(() => groupDiscordServers.id, { onDelete: 'cascade' }),
		/** User ID from core users table (references core.users.id) */
		userId: varchar('user_id', { length: 255 }).notNull(),
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
		index('group_discord_invites_group_id_idx').on(table.groupId),
		index('group_discord_invites_server_id_idx').on(table.groupDiscordServerId),
		index('group_discord_invites_user_id_idx').on(table.userId),
		index('group_discord_invites_created_at_idx').on(table.createdAt),
	]
)

/**
 * Permission Categories table - Organize permissions into categories
 *
 * Categories help admins organize permissions logically (e.g., 'Fleet', 'HR', 'Finance')
 */
export const permissionCategories = pgTable(
	'permission_categories',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Category name (must be unique) */
		name: varchar('name', { length: 255 }).notNull().unique(),
		/** Category description */
		description: text('description'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [index('permission_categories_name_idx').on(table.name)]
)

/**
 * Permissions table - Global reusable permission definitions
 *
 * These are permission templates that can be attached to multiple groups.
 * Site admins can create global permissions with URN identifiers.
 */
export const permissions = pgTable(
	'permissions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** URN identifier (e.g., "urn:corporations:dreddit:member") */
		urn: text('urn').notNull().unique(),
		/** Human-readable display name */
		name: varchar('name', { length: 255 }).notNull(),
		/** Permission description */
		description: text('description'),
		/** Optional category for organization */
		categoryId: uuid('category_id').references(() => permissionCategories.id, {
			onDelete: 'set null',
		}),
		/** User ID of the admin who created this permission */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('permissions_urn_idx').on(table.urn),
		index('permissions_category_id_idx').on(table.categoryId),
	]
)

/**
 * Group Permissions table - Permissions attached to groups
 *
 * Links permissions to groups with a specific target type.
 * Supports both global permissions (via permissionId) and group-scoped custom permissions.
 */
export const groupPermissions = pgTable(
	'group_permissions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Group this permission is attached to */
		groupId: uuid('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		/** Reference to global permission (null for group-scoped) */
		permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }),
		/** Custom URN for group-scoped permissions */
		customUrn: text('custom_urn'),
		/** Custom name for group-scoped permissions */
		customName: varchar('custom_name', { length: 255 }),
		/** Custom description for group-scoped permissions */
		customDescription: text('custom_description'),
		/** Who receives this permission */
		targetType: permissionTargetEnum('target_type').notNull(),
		/** User ID of the admin who created this attachment */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('group_permissions_group_id_idx').on(table.groupId),
		index('group_permissions_permission_id_idx').on(table.permissionId),
		index('group_permissions_custom_urn_idx').on(table.customUrn),
		// Ensure either permissionId OR custom fields are set, not both
		// (enforced at application layer)
		// Prevent duplicate permission attachments (same permission on same group)
		unique('unique_group_permission').on(table.groupId, table.permissionId),
	]
)

/**
 * Relations
 */

export const categoriesRelations = relations(categories, ({ many }) => ({
	groups: many(groups),
}))

export const groupsRelations = relations(groups, ({ one, many }) => ({
	category: one(categories, {
		fields: [groups.categoryId],
		references: [categories.id],
	}),
	members: many(groupMembers),
	admins: many(groupAdmins),
	invitations: many(groupInvitations),
	inviteCodes: many(groupInviteCodes),
	joinRequests: many(groupJoinRequests),
	discordServers: many(groupDiscordServers),
	discordInvites: many(groupDiscordInvites),
}))

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
	group: one(groups, {
		fields: [groupMembers.groupId],
		references: [groups.id],
	}),
}))

export const groupAdminsRelations = relations(groupAdmins, ({ one }) => ({
	group: one(groups, {
		fields: [groupAdmins.groupId],
		references: [groups.id],
	}),
}))

export const groupInvitationsRelations = relations(groupInvitations, ({ one }) => ({
	group: one(groups, {
		fields: [groupInvitations.groupId],
		references: [groups.id],
	}),
}))

export const groupInviteCodesRelations = relations(groupInviteCodes, ({ one, many }) => ({
	group: one(groups, {
		fields: [groupInviteCodes.groupId],
		references: [groups.id],
	}),
	redemptions: many(groupInviteCodeRedemptions),
}))

export const groupInviteCodeRedemptionsRelations = relations(
	groupInviteCodeRedemptions,
	({ one }) => ({
		inviteCode: one(groupInviteCodes, {
			fields: [groupInviteCodeRedemptions.inviteCodeId],
			references: [groupInviteCodes.id],
		}),
	})
)

export const groupJoinRequestsRelations = relations(groupJoinRequests, ({ one }) => ({
	group: one(groups, {
		fields: [groupJoinRequests.groupId],
		references: [groups.id],
	}),
}))

export const groupDiscordServersRelations = relations(groupDiscordServers, ({ one, many }) => ({
	group: one(groups, {
		fields: [groupDiscordServers.groupId],
		references: [groups.id],
	}),
	roles: many(groupDiscordServerRoles),
	invites: many(groupDiscordInvites),
}))

export const groupDiscordServerRolesRelations = relations(groupDiscordServerRoles, ({ one }) => ({
	groupDiscordServer: one(groupDiscordServers, {
		fields: [groupDiscordServerRoles.groupDiscordServerId],
		references: [groupDiscordServers.id],
	}),
}))

export const groupDiscordInvitesRelations = relations(groupDiscordInvites, ({ one }) => ({
	group: one(groups, {
		fields: [groupDiscordInvites.groupId],
		references: [groups.id],
	}),
	groupDiscordServer: one(groupDiscordServers, {
		fields: [groupDiscordInvites.groupDiscordServerId],
		references: [groupDiscordServers.id],
	}),
}))

export const permissionCategoriesRelations = relations(permissionCategories, ({ many }) => ({
	permissions: many(permissions),
}))

export const permissionsRelations = relations(permissions, ({ one, many }) => ({
	category: one(permissionCategories, {
		fields: [permissions.categoryId],
		references: [permissionCategories.id],
	}),
	groupPermissions: many(groupPermissions),
}))

export const groupPermissionsRelations = relations(groupPermissions, ({ one }) => ({
	group: one(groups, {
		fields: [groupPermissions.groupId],
		references: [groups.id],
	}),
	permission: one(permissions, {
		fields: [groupPermissions.permissionId],
		references: [permissions.id],
	}),
}))

/**
 * Export schema for db client
 */
export const schema = {
	// Enums
	visibilityEnum,
	categoryPermissionEnum,
	joinModeEnum,
	invitationStatusEnum,
	joinRequestStatusEnum,
	permissionTargetEnum,
	// Tables
	categories,
	groups,
	groupMembers,
	groupAdmins,
	groupInvitations,
	groupInviteCodes,
	groupInviteCodeRedemptions,
	groupJoinRequests,
	groupDiscordServers,
	groupDiscordServerRoles,
	groupDiscordInvites,
	permissionCategories,
	permissions,
	groupPermissions,
	// Relations
	categoriesRelations,
	groupsRelations,
	groupMembersRelations,
	groupAdminsRelations,
	groupInvitationsRelations,
	groupInviteCodesRelations,
	groupInviteCodeRedemptionsRelations,
	groupJoinRequestsRelations,
	groupDiscordServersRelations,
	groupDiscordServerRolesRelations,
	groupDiscordInvitesRelations,
	permissionCategoriesRelations,
	permissionsRelations,
	groupPermissionsRelations,
}
