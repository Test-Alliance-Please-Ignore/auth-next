import { pgTable, uuid, varchar, text, timestamp, boolean, integer, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// Groups
// ============================================================================

export const groups = pgTable('groups_groups', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).unique().notNull(),
	slug: varchar('slug', { length: 255 }).unique().notNull(),
	description: text('description'),
	groupType: varchar('group_type', { length: 50 }).notNull(), // 'standard', 'managed', 'derived'
	visibility: varchar('visibility', { length: 50 }).notNull(), // 'public', 'private', 'hidden'
	joinability: varchar('joinability', { length: 50 }).notNull(), // 'open', 'approval_required', 'invite_only', 'closed'
	isLeaveable: boolean('is_leaveable').default(true).notNull(),
	autoApproveRules: text('auto_approve_rules'), // JSON
	ownerId: uuid('owner_id'),
	categoryId: uuid('category_id'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	nameIdx: uniqueIndex('groups_groups_name_idx').on(table.name),
	slugIdx: uniqueIndex('groups_groups_slug_idx').on(table.slug),
	typeIdx: index('groups_groups_type_idx').on(table.groupType),
	categoryIdx: index('groups_groups_category_idx').on(table.categoryId),
	ownerIdx: index('groups_groups_owner_idx').on(table.ownerId)
}))

// ============================================================================
// Group Members
// ============================================================================

export const members = pgTable('groups_members', {
	id: uuid('id').defaultRandom().primaryKey(),
	groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
	rootUserId: uuid('root_user_id').notNull(),
	role: varchar('role', { length: 50 }).notNull(), // 'owner', 'admin', 'moderator', 'member'
	status: varchar('status', { length: 50 }).notNull(), // 'active', 'pending', 'suspended'
	assignmentType: varchar('assignment_type', { length: 50 }).notNull(), // 'manual', 'auto_assigned', 'derived', 'invited'
	canLeave: boolean('can_leave').default(true).notNull(),
	joinedAt: timestamp('joined_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueMemberIdx: uniqueIndex('groups_members_unique_idx').on(table.groupId, table.rootUserId),
	groupIdx: index('groups_members_group_idx').on(table.groupId),
	userIdx: index('groups_members_user_idx').on(table.rootUserId),
	statusIdx: index('groups_members_status_idx').on(table.status)
}))

// ============================================================================
// Group Join Requests
// ============================================================================

export const joinRequests = pgTable('groups_join_requests', {
	id: uuid('id').defaultRandom().primaryKey(),
	groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
	rootUserId: uuid('root_user_id').notNull(),
	message: text('message'),
	status: varchar('status', { length: 50 }).notNull(), // 'pending', 'approved', 'rejected'
	reviewedBy: uuid('reviewed_by'),
	reviewedAt: timestamp('reviewed_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	groupUserIdx: uniqueIndex('groups_requests_unique_idx').on(table.groupId, table.rootUserId),
	groupIdx: index('groups_requests_group_idx').on(table.groupId),
	userIdx: index('groups_requests_user_idx').on(table.rootUserId),
	statusIdx: index('groups_requests_status_idx').on(table.status)
}))

// ============================================================================
// Group Invites
// ============================================================================

export const invites = pgTable('groups_invites', {
	id: uuid('id').defaultRandom().primaryKey(),
	groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
	invitedUserId: uuid('invited_user_id'),
	invitedBy: uuid('invited_by').notNull(),
	inviteCode: varchar('invite_code', { length: 12 }).unique(), // 12-char alphanumeric
	status: varchar('status', { length: 50 }).notNull(), // 'pending', 'accepted', 'declined', 'expired', 'revoked'
	maxUses: integer('max_uses'),
	currentUses: integer('current_uses').default(0).notNull(),
	expiresAt: timestamp('expires_at'),
	revokedAt: timestamp('revoked_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	groupUserIdx: index('groups_invites_group_user_idx').on(table.groupId, table.invitedUserId),
	inviteCodeIdx: uniqueIndex('groups_invites_code_idx').on(table.inviteCode),
	statusIdx: index('groups_invites_status_idx').on(table.status)
}))

// ============================================================================
// Group Categories
// ============================================================================

export const categories = pgTable('groups_categories', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: varchar('name', { length: 255 }).unique().notNull(),
	description: text('description'),
	displayOrder: integer('display_order').default(0).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	nameIdx: uniqueIndex('groups_categories_name_idx').on(table.name),
	orderIdx: index('groups_categories_order_idx').on(table.displayOrder)
}))

// ============================================================================
// Group Roles
// ============================================================================

export const roles = pgTable('groups_roles', {
	id: uuid('id').defaultRandom().primaryKey(),
	groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
	roleName: varchar('role_name', { length: 50 }).notNull(),
	permissions: text('permissions'), // JSON array of permissions
	priority: integer('priority').default(0).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	uniqueRoleIdx: uniqueIndex('groups_roles_unique_idx').on(table.groupId, table.roleName),
	groupIdx: index('groups_roles_group_idx').on(table.groupId)
}))

// ============================================================================
// Derived Group Rules
// ============================================================================

export const derivedRules = pgTable('groups_derived_rules', {
	id: uuid('id').defaultRandom().primaryKey(),
	derivedGroupId: uuid('derived_group_id').references(() => groups.id, { onDelete: 'cascade' }).notNull(),
	ruleType: varchar('rule_type', { length: 50 }).notNull(), // 'parent_child', 'role_based', 'union', 'conditional'
	sourceGroupIds: text('source_group_ids'), // JSON array
	conditionRules: text('condition_rules'), // JSON
	priority: integer('priority').default(0).notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	derivedIdx: index('groups_derived_rules_group_idx').on(table.derivedGroupId),
	activeIdx: index('groups_derived_rules_active_idx').on(table.isActive)
}))

// ============================================================================
// Relations
// ============================================================================

export const groupsRelations = relations(groups, ({ one, many }) => ({
	category: one(categories, {
		fields: [groups.categoryId],
		references: [categories.id]
	}),
	members: many(members),
	joinRequests: many(joinRequests),
	invites: many(invites),
	roles: many(roles),
	derivedRules: many(derivedRules)
}))

export const membersRelations = relations(members, ({ one }) => ({
	group: one(groups, {
		fields: [members.groupId],
		references: [groups.id]
	})
}))

export const joinRequestsRelations = relations(joinRequests, ({ one }) => ({
	group: one(groups, {
		fields: [joinRequests.groupId],
		references: [groups.id]
	})
}))

export const invitesRelations = relations(invites, ({ one }) => ({
	group: one(groups, {
		fields: [invites.groupId],
		references: [groups.id]
	})
}))

export const categoriesRelations = relations(categories, ({ many }) => ({
	groups: many(groups)
}))

export const rolesRelations = relations(roles, ({ one }) => ({
	group: one(groups, {
		fields: [roles.groupId],
		references: [groups.id]
	})
}))

export const derivedRulesRelations = relations(derivedRules, ({ one }) => ({
	derivedGroup: one(groups, {
		fields: [derivedRules.derivedGroupId],
		references: [groups.id]
	})
}))