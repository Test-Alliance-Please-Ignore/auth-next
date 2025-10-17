import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

// ========== Type Definitions ==========

export interface GroupData extends Record<string, number | string> {
	group_id: string
	name: string
	slug: string
	description: string
	group_type: string
	visibility: string
	joinability: string
	is_leaveable: number
	auto_approve_rules: string
	owner_id: string
	category_id: string
	created_at: number
	updated_at: number
}

export interface Group {
	groupId: string
	name: string
	slug: string
	description: string
	groupType: 'standard' | 'managed' | 'derived'
	visibility: 'public' | 'private' | 'hidden'
	joinability: 'open' | 'approval_required' | 'invite_only' | 'closed'
	isLeaveable: boolean
	autoApproveRules: Record<string, unknown> | null
	ownerId: string
	ownerName?: string // Primary character name of the owner
	categoryId: string | null
	createdAt: number
	updatedAt: number
}

export interface GroupMemberData extends Record<string, number | string> {
	membership_id: string
	group_id: string
	social_user_id: string
	role: string
	status: string
	assignment_type: string
	can_leave: number
	joined_at: number
	updated_at: number
}

export interface GroupMember {
	membershipId: string
	groupId: string
	socialUserId: string
	role: 'owner' | 'admin' | 'moderator' | 'member'
	status: 'active' | 'pending' | 'suspended'
	assignmentType: 'manual' | 'auto_assigned' | 'derived' | 'invited'
	canLeave: boolean
	joinedAt: number
	updatedAt: number
}

export interface JoinRequestData extends Record<string, number | string> {
	request_id: string
	group_id: string
	social_user_id: string
	message: string
	status: string
	reviewed_by: string
	reviewed_at: number
	created_at: number
	updated_at: number
}

export interface JoinRequest {
	requestId: string
	groupId: string
	socialUserId: string
	message: string | null
	status: 'pending' | 'approved' | 'rejected'
	reviewedBy: string | null
	reviewedAt: number | null
	createdAt: number
	updatedAt: number
}

export interface GroupInviteData extends Record<string, number | string> {
	invite_id: string
	group_id: string
	invited_user_id: string
	invited_by: string
	status: string
	expires_at: number
	created_at: number
	updated_at: number
	invite_code: string
	max_uses: number
	current_uses: number
	revoked_at: number
}

export interface GroupInvite {
	inviteId: string
	groupId: string
	invitedUserId: string | null
	invitedBy: string
	status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
	expiresAt: number
	createdAt: number
	updatedAt: number
	inviteCode?: string | null
	maxUses?: number | null
	currentUses?: number
	revokedAt?: number | null
}

export interface GroupRoleData extends Record<string, number | string> {
	role_id: string
	group_id: string
	role_name: string
	permissions: string
	priority: number
	created_at: number
	updated_at: number
}

export interface GroupRole {
	roleId: string
	groupId: string
	roleName: string
	permissions: string[]
	priority: number
	createdAt: number
	updatedAt: number
}

export interface DerivedGroupRuleData extends Record<string, number | string> {
	rule_id: string
	derived_group_id: string
	rule_type: string
	source_group_ids: string
	condition_rules: string
	priority: number
	is_active: number
	created_at: number
	updated_at: number
}

export interface DerivedGroupRule {
	ruleId: string
	derivedGroupId: string
	ruleType: 'parent_child' | 'role_based' | 'union' | 'conditional'
	sourceGroupIds: string[] | null
	conditionRules: Record<string, unknown> | null
	priority: number
	isActive: boolean
	createdAt: number
	updatedAt: number
}

export interface GroupCategoryData extends Record<string, number | string> {
	category_id: string
	name: string
	description: string
	display_order: number
	created_at: number
	updated_at: number
}

export interface GroupCategory {
	categoryId: string
	name: string
	description: string | null
	displayOrder: number
	createdAt: number
	updatedAt: number
}

export class GroupStore extends DurableObject<Env> {
	private schemaInitialized = false
	private readonly CURRENT_SCHEMA_VERSION = 3

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async getSchemaVersion(): Promise<number> {
		// Create schema_version table if it doesn't exist
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			)
		`)

		const rows = await this.ctx.storage.sql
			.exec<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
			.toArray()

		return rows.length > 0 ? rows[0].version : 0
	}

	private async setSchemaVersion(version: number): Promise<void> {
		const now = Date.now()
		await this.ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)',
			version,
			now
		)
	}

	private async ensureSchema() {
		// Only run migrations once per DO instance
		if (this.schemaInitialized) {
			return
		}

		try {
			const currentVersion = await this.getSchemaVersion()

			logger.info('Running group store schema migrations', {
				currentVersion,
				targetVersion: this.CURRENT_SCHEMA_VERSION,
			})

			// Migration 1: Initial schema
			if (currentVersion < 1) {
				await this.runMigration1()
				await this.setSchemaVersion(1)
				logger.info('Applied migration 1: Initial group schema')
			}

			// Migration 2: Add invite code support
			if (currentVersion < 2) {
				await this.runMigration2()
				await this.setSchemaVersion(2)
				logger.info('Applied migration 2: Add invite code support')
			}

			// Migration 3: Add group categories
			if (currentVersion < 3) {
				await this.runMigration3()
				await this.setSchemaVersion(3)
				logger.info('Applied migration 3: Add group categories')
			}

			this.schemaInitialized = true
		} catch (error) {
			// If migration fails, don't mark as initialized so it retries
			logger.error('Group store schema migration failed', {
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private async runMigration1(): Promise<void> {
		// Groups table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS groups (
				group_id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				slug TEXT NOT NULL UNIQUE,
				description TEXT,
				group_type TEXT NOT NULL,
				visibility TEXT NOT NULL,
				joinability TEXT NOT NULL,
				is_leaveable INTEGER NOT NULL DEFAULT 1,
				auto_approve_rules TEXT,
				owner_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_groups_slug ON groups(slug)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_groups_type ON groups(group_type)
		`)

		// Group members table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS group_members (
				membership_id TEXT PRIMARY KEY,
				group_id TEXT NOT NULL,
				social_user_id TEXT NOT NULL,
				role TEXT NOT NULL,
				status TEXT NOT NULL,
				assignment_type TEXT NOT NULL,
				can_leave INTEGER NOT NULL DEFAULT 1,
				joined_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(group_id, social_user_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_group_members_status ON group_members(status)
		`)

		// Group join requests table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS group_join_requests (
				request_id TEXT PRIMARY KEY,
				group_id TEXT NOT NULL,
				social_user_id TEXT NOT NULL,
				message TEXT,
				status TEXT NOT NULL,
				reviewed_by TEXT,
				reviewed_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_join_requests_group ON group_join_requests(group_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_join_requests_user ON group_join_requests(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_join_requests_status ON group_join_requests(status)
		`)

		// Group invites table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS group_invites (
				invite_id TEXT PRIMARY KEY,
				group_id TEXT NOT NULL,
				invited_user_id TEXT NOT NULL,
				invited_by TEXT NOT NULL,
				status TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_invites_group ON group_invites(group_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_invites_user ON group_invites(invited_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_invites_status ON group_invites(status)
		`)

		// Group roles table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS group_roles (
				role_id TEXT PRIMARY KEY,
				group_id TEXT NOT NULL,
				role_name TEXT NOT NULL,
				permissions TEXT NOT NULL,
				priority INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(group_id, role_name)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_group_roles_group ON group_roles(group_id)
		`)

		// Derived group rules table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS derived_group_rules (
				rule_id TEXT PRIMARY KEY,
				derived_group_id TEXT NOT NULL,
				rule_type TEXT NOT NULL,
				source_group_ids TEXT,
				condition_rules TEXT,
				priority INTEGER NOT NULL,
				is_active INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_derived_rules_group ON derived_group_rules(derived_group_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_derived_rules_active ON derived_group_rules(is_active)
		`)
	}

	private async runMigration2(): Promise<void> {
		// Add invite code columns to group_invites table
		await this.ctx.storage.sql.exec(`
			ALTER TABLE group_invites ADD COLUMN invite_code TEXT
		`)

		await this.ctx.storage.sql.exec(`
			ALTER TABLE group_invites ADD COLUMN max_uses INTEGER
		`)

		await this.ctx.storage.sql.exec(`
			ALTER TABLE group_invites ADD COLUMN current_uses INTEGER DEFAULT 0
		`)

		await this.ctx.storage.sql.exec(`
			ALTER TABLE group_invites ADD COLUMN revoked_at INTEGER
		`)

		// Create unique index on invite_code (excluding NULL values)
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_code ON group_invites(invite_code) WHERE invite_code IS NOT NULL
		`)
	}

	private async runMigration3(): Promise<void> {
		// Create group_categories table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS group_categories (
				category_id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				description TEXT,
				display_order INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_categories_order ON group_categories(display_order)
		`)

		// Add category_id column to groups table
		await this.ctx.storage.sql.exec(`
			ALTER TABLE groups ADD COLUMN category_id TEXT
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category_id)
		`)
	}

	private generateId(): string {
		// Generate a random UUID
		return crypto.randomUUID()
	}

	private generateSlug(name: string): string {
		// Generate URL-safe slug from name
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
	}

	private generateInviteCode(): string {
		// Generate a random 12-character alphanumeric code
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude confusing chars like 0, O, 1, I
		let code = ''
		const randomValues = new Uint8Array(12)
		crypto.getRandomValues(randomValues)
		for (let i = 0; i < 12; i++) {
			code += chars[randomValues[i] % chars.length]
		}
		return code
	}

	// ========== Group CRUD ==========

	async createGroup(
		name: string,
		description: string | null,
		groupType: 'standard' | 'managed' | 'derived',
		visibility: 'public' | 'private' | 'hidden',
		joinability: 'open' | 'approval_required' | 'invite_only' | 'closed',
		ownerId: string,
		autoApproveRules?: Record<string, unknown>,
		categoryId?: string | null
	): Promise<Group> {
		await this.ensureSchema()

		const groupId = this.generateId()
		const slug = this.generateSlug(name)
		const now = Date.now()

		// Managed and derived groups are not leaveable
		const isLeaveable = groupType === 'standard' ? 1 : 0

		await this.ctx.storage.sql.exec(
			`INSERT INTO groups (
				group_id, name, slug, description, group_type, visibility, joinability,
				is_leaveable, auto_approve_rules, owner_id, category_id, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			groupId,
			name,
			slug,
			description || '',
			groupType,
			visibility,
			joinability,
			isLeaveable,
			autoApproveRules ? JSON.stringify(autoApproveRules) : '',
			ownerId,
			categoryId || '',
			now,
			now
		)

		// Automatically add owner as a member
		await this.addMember(groupId, ownerId, 'owner', 'manual')

		logger
			.withTags({
				type: 'group_created',
				groupType,
			})
			.info('Created group', {
				groupId,
				name,
				slug,
				ownerId: ownerId.substring(0, 8) + '...',
			})

		return {
			groupId,
			name,
			slug,
			description: description || '',
			groupType,
			visibility,
			joinability,
			isLeaveable: isLeaveable === 1,
			autoApproveRules: autoApproveRules || null,
			ownerId,
			categoryId: categoryId || null,
			createdAt: now,
			updatedAt: now,
		}
	}

	async getGroupBySlug(slug: string): Promise<Group | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupData>('SELECT * FROM groups WHERE slug = ?', slug)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			groupId: row.group_id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			groupType: row.group_type as 'standard' | 'managed' | 'derived',
			visibility: row.visibility as 'public' | 'private' | 'hidden',
			joinability: row.joinability as 'open' | 'approval_required' | 'invite_only' | 'closed',
			isLeaveable: row.is_leaveable === 1,
			autoApproveRules: row.auto_approve_rules ? JSON.parse(row.auto_approve_rules) : null,
			ownerId: row.owner_id,
			categoryId: row.category_id || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	}

	async getGroupById(groupId: string): Promise<Group | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupData>('SELECT * FROM groups WHERE group_id = ?', groupId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			groupId: row.group_id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			groupType: row.group_type as 'standard' | 'managed' | 'derived',
			visibility: row.visibility as 'public' | 'private' | 'hidden',
			joinability: row.joinability as 'open' | 'approval_required' | 'invite_only' | 'closed',
			isLeaveable: row.is_leaveable === 1,
			autoApproveRules: row.auto_approve_rules ? JSON.parse(row.auto_approve_rules) : null,
			ownerId: row.owner_id,
			categoryId: row.category_id || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	}

	async updateGroup(
		groupId: string,
		updates: {
			name?: string
			description?: string | null
			visibility?: 'public' | 'private' | 'hidden'
			joinability?: 'open' | 'approval_required' | 'invite_only' | 'closed'
			autoApproveRules?: Record<string, unknown> | null
			categoryId?: string | null
		}
	): Promise<Group> {
		await this.ensureSchema()

		const now = Date.now()
		const group = await this.getGroupById(groupId)

		if (!group) {
			throw new Error('Group not found')
		}

		// Build update query dynamically
		const updateFields: string[] = []
		const values: Array<string | number> = []

		if (updates.name !== undefined) {
			updateFields.push('name = ?')
			values.push(updates.name)
			updateFields.push('slug = ?')
			values.push(this.generateSlug(updates.name))
		}

		if (updates.description !== undefined) {
			updateFields.push('description = ?')
			values.push(updates.description || '')
		}

		if (updates.visibility !== undefined) {
			updateFields.push('visibility = ?')
			values.push(updates.visibility)
		}

		if (updates.joinability !== undefined) {
			updateFields.push('joinability = ?')
			values.push(updates.joinability)
		}

		if (updates.autoApproveRules !== undefined) {
			updateFields.push('auto_approve_rules = ?')
			values.push(updates.autoApproveRules ? JSON.stringify(updates.autoApproveRules) : '')
		}

		if (updates.categoryId !== undefined) {
			updateFields.push('category_id = ?')
			values.push(updates.categoryId || '')
		}

		updateFields.push('updated_at = ?')
		values.push(now)

		values.push(groupId)

		await this.ctx.storage.sql.exec(
			`UPDATE groups SET ${updateFields.join(', ')} WHERE group_id = ?`,
			...values
		)

		logger
			.withTags({
				type: 'group_updated',
			})
			.info('Updated group', {
				groupId,
				updates: Object.keys(updates),
			})

		// Return updated group
		const updated = await this.getGroupById(groupId)
		if (!updated) {
			throw new Error('Group not found after update')
		}

		return updated
	}

	async deleteGroup(groupId: string): Promise<void> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		// Delete all related data
		await this.ctx.storage.sql.exec('DELETE FROM group_members WHERE group_id = ?', groupId)
		await this.ctx.storage.sql.exec('DELETE FROM group_join_requests WHERE group_id = ?', groupId)
		await this.ctx.storage.sql.exec('DELETE FROM group_invites WHERE group_id = ?', groupId)
		await this.ctx.storage.sql.exec('DELETE FROM group_roles WHERE group_id = ?', groupId)
		await this.ctx.storage.sql.exec('DELETE FROM derived_group_rules WHERE derived_group_id = ?', groupId)
		await this.ctx.storage.sql.exec('DELETE FROM groups WHERE group_id = ?', groupId)

		logger
			.withTags({
				type: 'group_deleted',
			})
			.info('Deleted group', {
				groupId,
				name: group.name,
			})
	}

	async listGroups(
		filters?: {
			visibility?: Array<'public' | 'private' | 'hidden'>
			groupType?: Array<'standard' | 'managed' | 'derived'>
			userId?: string
		},
		limit?: number,
		offset?: number
	): Promise<{ total: number; groups: Group[] }> {
		await this.ensureSchema()

		const parsedLimit = Math.min(limit || 50, 100)
		const parsedOffset = offset || 0

		// Build WHERE clause
		const whereClauses: string[] = []
		const whereValues: Array<string | number> = []

		if (filters?.visibility && filters.visibility.length > 0) {
			whereClauses.push(`visibility IN (${filters.visibility.map(() => '?').join(', ')})`)
			whereValues.push(...filters.visibility)
		}

		if (filters?.groupType && filters.groupType.length > 0) {
			whereClauses.push(`group_type IN (${filters.groupType.map(() => '?').join(', ')})`)
			whereValues.push(...filters.groupType)
		}

		const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

		// Get total count
		const countRows = await this.ctx.storage.sql
			.exec<{ count: number }>(`SELECT COUNT(*) as count FROM groups ${whereClause}`, ...whereValues)
			.toArray()
		const total = countRows[0]?.count || 0

		// Get paginated results
		const rows = await this.ctx.storage.sql
			.exec<GroupData>(
				`SELECT * FROM groups ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
				...whereValues,
				parsedLimit,
				parsedOffset
			)
			.toArray()

		const groups = rows.map((row) => ({
			groupId: row.group_id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			groupType: row.group_type as 'standard' | 'managed' | 'derived',
			visibility: row.visibility as 'public' | 'private' | 'hidden',
			joinability: row.joinability as 'open' | 'approval_required' | 'invite_only' | 'closed',
			isLeaveable: row.is_leaveable === 1,
			autoApproveRules: row.auto_approve_rules ? JSON.parse(row.auto_approve_rules) : null,
			ownerId: row.owner_id,
			categoryId: row.category_id || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))

		return { total, groups }
	}

	// ========== Membership Management ==========

	async addMember(
		groupId: string,
		socialUserId: string,
		role: 'owner' | 'admin' | 'moderator' | 'member',
		assignmentType: 'manual' | 'auto_assigned' | 'derived' | 'invited',
		status: 'active' | 'pending' | 'suspended' = 'active'
	): Promise<GroupMember> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		// Check if already a member
		const existing = await this.getMembership(groupId, socialUserId)
		if (existing) {
			throw new Error('User is already a member of this group')
		}

		const membershipId = this.generateId()
		const now = Date.now()

		// Auto-assigned and derived memberships cannot be left
		const canLeave = assignmentType === 'manual' || assignmentType === 'invited' ? 1 : 0

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_members (
				membership_id, group_id, social_user_id, role, status, assignment_type, can_leave, joined_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			membershipId,
			groupId,
			socialUserId,
			role,
			status,
			assignmentType,
			canLeave,
			now,
			now
		)

		logger
			.withTags({
				type: 'member_added',
				assignmentType,
			})
			.info('Added member to group', {
				groupId,
				socialUserId: socialUserId.substring(0, 8) + '...',
				role,
			})

		return {
			membershipId,
			groupId,
			socialUserId,
			role,
			status,
			assignmentType,
			canLeave: canLeave === 1,
			joinedAt: now,
			updatedAt: now,
		}
	}

	async getMembership(groupId: string, socialUserId: string): Promise<GroupMember | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupMemberData>(
				'SELECT * FROM group_members WHERE group_id = ? AND social_user_id = ?',
				groupId,
				socialUserId
			)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			membershipId: row.membership_id,
			groupId: row.group_id,
			socialUserId: row.social_user_id,
			role: row.role as 'owner' | 'admin' | 'moderator' | 'member',
			status: row.status as 'active' | 'pending' | 'suspended',
			assignmentType: row.assignment_type as 'manual' | 'auto_assigned' | 'derived' | 'invited',
			canLeave: row.can_leave === 1,
			joinedAt: row.joined_at,
			updatedAt: row.updated_at,
		}
	}

	async canUserLeaveGroup(groupId: string, socialUserId: string): Promise<boolean> {
		const membership = await this.getMembership(groupId, socialUserId)
		if (!membership) {
			return false
		}

		const group = await this.getGroupById(groupId)
		if (!group) {
			return false
		}

		// Managed/derived groups are never leaveable
		if (!group.isLeaveable) {
			return false
		}

		// Check membership-specific can_leave flag (for auto-assigned members)
		if (!membership.canLeave) {
			return false
		}

		// Owners cannot leave without transferring ownership first
		if (membership.role === 'owner') {
			return false
		}

		return true
	}

	async removeMember(groupId: string, socialUserId: string): Promise<void> {
		await this.ensureSchema()

		const membership = await this.getMembership(groupId, socialUserId)
		if (!membership) {
			throw new Error('Membership not found')
		}

		await this.ctx.storage.sql.exec(
			'DELETE FROM group_members WHERE group_id = ? AND social_user_id = ?',
			groupId,
			socialUserId
		)

		logger
			.withTags({
				type: 'member_removed',
			})
			.info('Removed member from group', {
				groupId,
				socialUserId: socialUserId.substring(0, 8) + '...',
			})
	}

	async updateMemberRole(
		groupId: string,
		socialUserId: string,
		role: 'owner' | 'admin' | 'moderator' | 'member'
	): Promise<void> {
		await this.ensureSchema()

		const membership = await this.getMembership(groupId, socialUserId)
		if (!membership) {
			throw new Error('Membership not found')
		}

		const now = Date.now()

		await this.ctx.storage.sql.exec(
			'UPDATE group_members SET role = ?, updated_at = ? WHERE group_id = ? AND social_user_id = ?',
			role,
			now,
			groupId,
			socialUserId
		)

		logger
			.withTags({
				type: 'member_role_updated',
			})
			.info('Updated member role', {
				groupId,
				socialUserId: socialUserId.substring(0, 8) + '...',
				role,
			})
	}

	async listGroupMembers(
		groupId: string,
		limit?: number,
		offset?: number
	): Promise<{ total: number; members: GroupMember[] }> {
		await this.ensureSchema()

		const parsedLimit = Math.min(limit || 50, 100)
		const parsedOffset = offset || 0

		// Get total count
		const countRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM group_members WHERE group_id = ?', groupId)
			.toArray()
		const total = countRows[0]?.count || 0

		// Get paginated results
		const rows = await this.ctx.storage.sql
			.exec<GroupMemberData>(
				'SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at DESC LIMIT ? OFFSET ?',
				groupId,
				parsedLimit,
				parsedOffset
			)
			.toArray()

		const members = rows.map((row) => ({
			membershipId: row.membership_id,
			groupId: row.group_id,
			socialUserId: row.social_user_id,
			role: row.role as 'owner' | 'admin' | 'moderator' | 'member',
			status: row.status as 'active' | 'pending' | 'suspended',
			assignmentType: row.assignment_type as 'manual' | 'auto_assigned' | 'derived' | 'invited',
			canLeave: row.can_leave === 1,
			joinedAt: row.joined_at,
			updatedAt: row.updated_at,
		}))

		return { total, members }
	}

	async getUserGroups(socialUserId: string): Promise<Group[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupData>(
				`SELECT g.* FROM groups g
				INNER JOIN group_members gm ON g.group_id = gm.group_id
				WHERE gm.social_user_id = ? AND gm.status = 'active'
				ORDER BY gm.joined_at DESC`,
				socialUserId
			)
			.toArray()

		return rows.map((row) => ({
			groupId: row.group_id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			groupType: row.group_type as 'standard' | 'managed' | 'derived',
			visibility: row.visibility as 'public' | 'private' | 'hidden',
			joinability: row.joinability as 'open' | 'approval_required' | 'invite_only' | 'closed',
			isLeaveable: row.is_leaveable === 1,
			autoApproveRules: row.auto_approve_rules ? JSON.parse(row.auto_approve_rules) : null,
			ownerId: row.owner_id,
			categoryId: row.category_id || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	// ========== Permission Checking ==========

	async hasGroupPermission(
		groupId: string,
		socialUserId: string,
		permission: 'owner' | 'admin' | 'moderator' | 'member'
	): Promise<boolean> {
		const membership = await this.getMembership(groupId, socialUserId)
		if (!membership || membership.status !== 'active') {
			return false
		}

		// Role hierarchy: owner > admin > moderator > member
		const roleHierarchy: Record<string, number> = {
			owner: 4,
			admin: 3,
			moderator: 2,
			member: 1,
		}

		return roleHierarchy[membership.role] >= roleHierarchy[permission]
	}

	// ========== Join Request Workflow ==========

	async createJoinRequest(
		groupId: string,
		socialUserId: string,
		message: string | null
	): Promise<JoinRequest> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		// Check if already a member
		const existingMembership = await this.getMembership(groupId, socialUserId)
		if (existingMembership) {
			throw new Error('User is already a member of this group')
		}

		// Check if there's already a pending request
		const existingRequests = await this.ctx.storage.sql
			.exec<JoinRequestData>(
				'SELECT * FROM group_join_requests WHERE group_id = ? AND social_user_id = ? AND status = ?',
				groupId,
				socialUserId,
				'pending'
			)
			.toArray()

		if (existingRequests.length > 0) {
			throw new Error('You already have a pending join request for this group')
		}

		const requestId = this.generateId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_join_requests (
				request_id, group_id, social_user_id, message, status, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			requestId,
			groupId,
			socialUserId,
			message || '',
			'pending',
			now,
			now
		)

		logger
			.withTags({
				type: 'join_request_created',
			})
			.info('Created join request', {
				requestId,
				groupId,
				socialUserId: socialUserId.substring(0, 8) + '...',
			})

		return {
			requestId,
			groupId,
			socialUserId,
			message,
			status: 'pending',
			reviewedBy: null,
			reviewedAt: null,
			createdAt: now,
			updatedAt: now,
		}
	}

	async approveJoinRequest(requestId: string, reviewerId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<JoinRequestData>('SELECT * FROM group_join_requests WHERE request_id = ?', requestId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Join request not found')
		}

		const request = rows[0]

		if (request.status !== 'pending') {
			throw new Error('Join request has already been processed')
		}

		const now = Date.now()

		// Update request status
		await this.ctx.storage.sql.exec(
			'UPDATE group_join_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE request_id = ?',
			'approved',
			reviewerId,
			now,
			now,
			requestId
		)

		// Add user as member
		await this.addMember(request.group_id, request.social_user_id, 'member', 'manual')

		logger
			.withTags({
				type: 'join_request_approved',
			})
			.info('Approved join request', {
				requestId,
				reviewerId: reviewerId.substring(0, 8) + '...',
			})
	}

	async rejectJoinRequest(requestId: string, reviewerId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<JoinRequestData>('SELECT * FROM group_join_requests WHERE request_id = ?', requestId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Join request not found')
		}

		const request = rows[0]

		if (request.status !== 'pending') {
			throw new Error('Join request has already been processed')
		}

		const now = Date.now()

		await this.ctx.storage.sql.exec(
			'UPDATE group_join_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE request_id = ?',
			'rejected',
			reviewerId,
			now,
			now,
			requestId
		)

		logger
			.withTags({
				type: 'join_request_rejected',
			})
			.info('Rejected join request', {
				requestId,
				reviewerId: reviewerId.substring(0, 8) + '...',
			})
	}

	async listJoinRequests(
		groupId: string,
		status?: 'pending' | 'approved' | 'rejected'
	): Promise<JoinRequest[]> {
		await this.ensureSchema()

		const query = status
			? 'SELECT * FROM group_join_requests WHERE group_id = ? AND status = ? ORDER BY created_at DESC'
			: 'SELECT * FROM group_join_requests WHERE group_id = ? ORDER BY created_at DESC'

		const params = status ? [groupId, status] : [groupId]

		const rows = await this.ctx.storage.sql
			.exec<JoinRequestData>(query, ...params)
			.toArray()

		return rows.map((row) => ({
			requestId: row.request_id,
			groupId: row.group_id,
			socialUserId: row.social_user_id,
			message: row.message || null,
			status: row.status as 'pending' | 'approved' | 'rejected',
			reviewedBy: row.reviewed_by || null,
			reviewedAt: row.reviewed_at || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	// ========== Invitation System ==========

	async createInvite(
		groupId: string,
		invitedUserId: string,
		invitedBy: string,
		expiresInDays: number = 7
	): Promise<GroupInvite> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		// Check if already a member
		const existingMembership = await this.getMembership(groupId, invitedUserId)
		if (existingMembership) {
			throw new Error('User is already a member of this group')
		}

		// Check if there's already a pending invite
		const existingInvites = await this.ctx.storage.sql
			.exec<GroupInviteData>(
				'SELECT * FROM group_invites WHERE group_id = ? AND invited_user_id = ? AND status = ?',
				groupId,
				invitedUserId,
				'pending'
			)
			.toArray()

		if (existingInvites.length > 0) {
			throw new Error('User already has a pending invite for this group')
		}

		const inviteId = this.generateId()
		const now = Date.now()
		const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_invites (
				invite_id, group_id, invited_user_id, invited_by, status, expires_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			inviteId,
			groupId,
			invitedUserId,
			invitedBy,
			'pending',
			expiresAt,
			now,
			now
		)

		logger
			.withTags({
				type: 'invite_created',
			})
			.info('Created group invite', {
				inviteId,
				groupId,
				invitedUserId: invitedUserId.substring(0, 8) + '...',
				invitedBy: invitedBy.substring(0, 8) + '...',
			})

		return {
			inviteId,
			groupId,
			invitedUserId,
			invitedBy,
			status: 'pending',
			expiresAt,
			createdAt: now,
			updatedAt: now,
		}
	}

	async acceptInvite(inviteId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>('SELECT * FROM group_invites WHERE invite_id = ?', inviteId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Invite not found')
		}

		const invite = rows[0]

		if (invite.status !== 'pending') {
			throw new Error('Invite has already been processed')
		}

		const now = Date.now()

		if (invite.expires_at < now) {
			// Mark as expired
			await this.ctx.storage.sql.exec(
				'UPDATE group_invites SET status = ?, updated_at = ? WHERE invite_id = ?',
				'expired',
				now,
				inviteId
			)
			throw new Error('Invite has expired')
		}

		// Update invite status
		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET status = ?, updated_at = ? WHERE invite_id = ?',
			'accepted',
			now,
			inviteId
		)

		// Add user as member
		await this.addMember(invite.group_id, invite.invited_user_id, 'member', 'invited')

		logger
			.withTags({
				type: 'invite_accepted',
			})
			.info('Accepted group invite', {
				inviteId,
			})
	}

	async declineInvite(inviteId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>('SELECT * FROM group_invites WHERE invite_id = ?', inviteId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Invite not found')
		}

		const invite = rows[0]

		if (invite.status !== 'pending') {
			throw new Error('Invite has already been processed')
		}

		const now = Date.now()

		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET status = ?, updated_at = ? WHERE invite_id = ?',
			'declined',
			now,
			inviteId
		)

		logger
			.withTags({
				type: 'invite_declined',
			})
			.info('Declined group invite', {
				inviteId,
			})
	}

	async listUserInvites(socialUserId: string): Promise<GroupInvite[]> {
		await this.ensureSchema()

		const now = Date.now()

		// Expire old invites
		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET status = ?, updated_at = ? WHERE invited_user_id = ? AND status = ? AND expires_at < ?',
			'expired',
			now,
			socialUserId,
			'pending',
			now
		)

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>(
				'SELECT * FROM group_invites WHERE invited_user_id = ? AND status = ? ORDER BY created_at DESC',
				socialUserId,
				'pending'
			)
			.toArray()

		return rows.map((row) => ({
			inviteId: row.invite_id,
			groupId: row.group_id,
			invitedUserId: row.invited_user_id || null,
			invitedBy: row.invited_by,
			status: row.status as 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked',
			expiresAt: row.expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			inviteCode: row.invite_code || null,
			maxUses: row.max_uses || null,
			currentUses: row.current_uses || 0,
			revokedAt: row.revoked_at || null,
		}))
	}

	async createInviteCode(
		groupId: string,
		invitedBy: string,
		maxUses: number | null = null,
		expiresInDays: number = 7
	): Promise<GroupInvite> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		const inviteId = this.generateId()
		const inviteCode = this.generateInviteCode()
		const now = Date.now()
		const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_invites (
				invite_id, group_id, invited_user_id, invited_by, status, expires_at,
				invite_code, max_uses, current_uses, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			inviteId,
			groupId,
			'', // Empty string for invite codes (no specific user)
			invitedBy,
			'pending',
			expiresAt,
			inviteCode,
			maxUses || 0,
			0,
			now,
			now
		)

		logger
			.withTags({
				type: 'invite_code_created',
			})
			.info('Created invite code', {
				inviteId,
				groupId,
				inviteCode: inviteCode.substring(0, 4) + '...',
				invitedBy: invitedBy.substring(0, 8) + '...',
			})

		return {
			inviteId,
			groupId,
			invitedUserId: null,
			invitedBy,
			status: 'pending',
			expiresAt,
			createdAt: now,
			updatedAt: now,
			inviteCode,
			maxUses,
			currentUses: 0,
		}
	}

	async redeemInviteCode(code: string, socialUserId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>('SELECT * FROM group_invites WHERE invite_code = ?', code)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Invalid invite code')
		}

		const invite = rows[0]

		if (invite.status !== 'pending') {
			throw new Error('Invite code is no longer valid')
		}

		const now = Date.now()

		if (invite.expires_at < now) {
			// Mark as expired
			await this.ctx.storage.sql.exec(
				'UPDATE group_invites SET status = ?, updated_at = ? WHERE invite_id = ?',
				'expired',
				now,
				invite.invite_id
			)
			throw new Error('Invite code has expired')
		}

		// Check if user is already a member
		const existingMembership = await this.getMembership(invite.group_id, socialUserId)
		if (existingMembership) {
			throw new Error('You are already a member of this group')
		}

		// Check usage limits
		if (invite.max_uses && invite.max_uses > 0 && invite.current_uses >= invite.max_uses) {
			throw new Error('Invite code has reached its usage limit')
		}

		// Increment usage count
		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET current_uses = current_uses + 1, updated_at = ? WHERE invite_id = ?',
			now,
			invite.invite_id
		)

		// Mark as accepted if usage limit reached
		if (invite.max_uses && invite.max_uses > 0 && invite.current_uses + 1 >= invite.max_uses) {
			await this.ctx.storage.sql.exec(
				'UPDATE group_invites SET status = ?, updated_at = ? WHERE invite_id = ?',
				'accepted',
				now,
				invite.invite_id
			)
		}

		// Add user as member
		await this.addMember(invite.group_id, socialUserId, 'member', 'invited')

		logger
			.withTags({
				type: 'invite_code_redeemed',
			})
			.info('Redeemed invite code', {
				inviteId: invite.invite_id,
				code: code.substring(0, 4) + '...',
				socialUserId: socialUserId.substring(0, 8) + '...',
			})
	}

	async listGroupInvites(groupId: string): Promise<GroupInvite[]> {
		await this.ensureSchema()

		const now = Date.now()

		// Expire old invites
		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET status = ?, updated_at = ? WHERE group_id = ? AND status = ? AND expires_at < ?',
			'expired',
			now,
			groupId,
			'pending',
			now
		)

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>(
				'SELECT * FROM group_invites WHERE group_id = ? ORDER BY created_at DESC',
				groupId
			)
			.toArray()

		return rows.map((row) => ({
			inviteId: row.invite_id,
			groupId: row.group_id,
			invitedUserId: row.invited_user_id || null,
			invitedBy: row.invited_by,
			status: row.status as 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked',
			expiresAt: row.expires_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			inviteCode: row.invite_code || null,
			maxUses: row.max_uses || null,
			currentUses: row.current_uses || 0,
			revokedAt: row.revoked_at || null,
		}))
	}

	async revokeInvite(inviteId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupInviteData>('SELECT * FROM group_invites WHERE invite_id = ?', inviteId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Invite not found')
		}

		const invite = rows[0]

		if (invite.status !== 'pending') {
			throw new Error('Only pending invites can be revoked')
		}

		const now = Date.now()

		await this.ctx.storage.sql.exec(
			'UPDATE group_invites SET status = ?, revoked_at = ?, updated_at = ? WHERE invite_id = ?',
			'revoked',
			now,
			now,
			inviteId
		)

		logger
			.withTags({
				type: 'invite_revoked',
			})
			.info('Revoked invite', {
				inviteId,
			})
	}

	async bulkCreateInvites(
		groupId: string,
		userIds: string[],
		invitedBy: string,
		expiresInDays: number = 7
	): Promise<GroupInvite[]> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		const invites: GroupInvite[] = []
		const now = Date.now()
		const expiresAt = now + expiresInDays * 24 * 60 * 60 * 1000

		for (const userId of userIds) {
			try {
				// Check if already a member
				const existingMembership = await this.getMembership(groupId, userId)
				if (existingMembership) {
					logger.warn('User already a member, skipping invite', {
						groupId,
						userId: userId.substring(0, 8) + '...',
					})
					continue
				}

				// Check if there's already a pending invite
				const existingInvites = await this.ctx.storage.sql
					.exec<GroupInviteData>(
						'SELECT * FROM group_invites WHERE group_id = ? AND invited_user_id = ? AND status = ?',
						groupId,
						userId,
						'pending'
					)
					.toArray()

				if (existingInvites.length > 0) {
					logger.warn('User already has pending invite, skipping', {
						groupId,
						userId: userId.substring(0, 8) + '...',
					})
					continue
				}

				const inviteId = this.generateId()

				await this.ctx.storage.sql.exec(
					`INSERT INTO group_invites (
						invite_id, group_id, invited_user_id, invited_by, status, expires_at, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					inviteId,
					groupId,
					userId,
					invitedBy,
					'pending',
					expiresAt,
					now,
					now
				)

				invites.push({
					inviteId,
					groupId,
					invitedUserId: userId,
					invitedBy,
					status: 'pending',
					expiresAt,
					createdAt: now,
					updatedAt: now,
				})
			} catch (error) {
				logger.error('Failed to create invite in bulk operation', {
					groupId,
					userId: userId.substring(0, 8) + '...',
					error: String(error),
				})
			}
		}

		logger
			.withTags({
				type: 'bulk_invites_created',
			})
			.info('Created bulk invites', {
				groupId,
				count: invites.length,
				invitedBy: invitedBy.substring(0, 8) + '...',
			})

		return invites
	}

	// ========== Custom Roles ==========

	async createGroupRole(
		groupId: string,
		roleName: string,
		permissions: string[],
		priority: number
	): Promise<GroupRole> {
		await this.ensureSchema()

		const group = await this.getGroupById(groupId)
		if (!group) {
			throw new Error('Group not found')
		}

		const roleId = this.generateId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_roles (
				role_id, group_id, role_name, permissions, priority, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			roleId,
			groupId,
			roleName,
			JSON.stringify(permissions),
			priority,
			now,
			now
		)

		logger
			.withTags({
				type: 'group_role_created',
			})
			.info('Created custom group role', {
				roleId,
				groupId,
				roleName,
			})

		return {
			roleId,
			groupId,
			roleName,
			permissions,
			priority,
			createdAt: now,
			updatedAt: now,
		}
	}

	async listGroupRoles(groupId: string): Promise<GroupRole[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupRoleData>(
				'SELECT * FROM group_roles WHERE group_id = ? ORDER BY priority DESC',
				groupId
			)
			.toArray()

		return rows.map((row) => ({
			roleId: row.role_id,
			groupId: row.group_id,
			roleName: row.role_name,
			permissions: JSON.parse(row.permissions),
			priority: row.priority,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	// ========== Derived Group Rules ==========

	async createDerivedGroupRule(
		derivedGroupId: string,
		ruleType: 'parent_child' | 'role_based' | 'union' | 'conditional',
		sourceGroupIds: string[] | null,
		conditionRules: Record<string, unknown> | null,
		priority: number
	): Promise<DerivedGroupRule> {
		await this.ensureSchema()

		const group = await this.getGroupById(derivedGroupId)
		if (!group) {
			throw new Error('Group not found')
		}

		if (group.groupType !== 'derived') {
			throw new Error('Can only add rules to derived groups')
		}

		const ruleId = this.generateId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO derived_group_rules (
				rule_id, derived_group_id, rule_type, source_group_ids, condition_rules, priority, is_active, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			ruleId,
			derivedGroupId,
			ruleType,
			sourceGroupIds ? JSON.stringify(sourceGroupIds) : '',
			conditionRules ? JSON.stringify(conditionRules) : '',
			priority,
			1,
			now,
			now
		)

		logger
			.withTags({
				type: 'derived_rule_created',
			})
			.info('Created derived group rule', {
				ruleId,
				derivedGroupId,
				ruleType,
			})

		return {
			ruleId,
			derivedGroupId,
			ruleType,
			sourceGroupIds,
			conditionRules,
			priority,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		}
	}

	async listDerivedGroupRules(derivedGroupId: string): Promise<DerivedGroupRule[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<DerivedGroupRuleData>(
				'SELECT * FROM derived_group_rules WHERE derived_group_id = ? ORDER BY priority DESC',
				derivedGroupId
			)
			.toArray()

		return rows.map((row) => ({
			ruleId: row.rule_id,
			derivedGroupId: row.derived_group_id,
			ruleType: row.rule_type as 'parent_child' | 'role_based' | 'union' | 'conditional',
			sourceGroupIds: row.source_group_ids ? JSON.parse(row.source_group_ids) : null,
			conditionRules: row.condition_rules ? JSON.parse(row.condition_rules) : null,
			priority: row.priority,
			isActive: row.is_active === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	// This would be called by a scheduled alarm or manually
	async syncDerivedGroupMemberships(derivedGroupId: string): Promise<void> {
		await this.ensureSchema()

		const rules = await this.listDerivedGroupRules(derivedGroupId)
		const activeRules = rules.filter((r) => r.isActive)

		// Collect all user IDs that should be in this derived group
		const userIdsToAdd = new Set<string>()

		for (const rule of activeRules) {
			switch (rule.ruleType) {
				case 'union':
				case 'parent_child': {
					if (rule.sourceGroupIds) {
						for (const sourceGroupId of rule.sourceGroupIds) {
							const { members } = await this.listGroupMembers(sourceGroupId, 1000)
							members.forEach((m) => {
								if (m.status === 'active') {
									userIdsToAdd.add(m.socialUserId)
								}
							})
						}
					}
					break
				}
				// role_based and conditional would need additional implementation
			}
		}

		// Get current members
		const { members: currentMembers } = await this.listGroupMembers(derivedGroupId, 1000)
		const currentDerivedMembers = currentMembers.filter((m) => m.assignmentType === 'derived')
		const currentUserIds = new Set(currentDerivedMembers.map((m) => m.socialUserId))

		// Add new members
		for (const userId of userIdsToAdd) {
			if (!currentUserIds.has(userId)) {
				try {
					await this.addMember(derivedGroupId, userId, 'member', 'derived')
				} catch (error) {
					// User might already be a member through another assignment type
					logger.warn('Failed to add derived member', {
						derivedGroupId,
						userId: userId.substring(0, 8) + '...',
						error: String(error),
					})
				}
			}
		}

		// Remove members who no longer match rules
		for (const member of currentDerivedMembers) {
			if (!userIdsToAdd.has(member.socialUserId)) {
				await this.removeMember(derivedGroupId, member.socialUserId)
			}
		}

		logger
			.withTags({
				type: 'derived_group_synced',
			})
			.info('Synced derived group memberships', {
				derivedGroupId,
				rulesCount: activeRules.length,
				membersAdded: userIdsToAdd.size - currentUserIds.size,
			})
	}

	// ========== Group Categories ==========

	async createCategory(
		name: string,
		description: string | null,
		displayOrder: number
	): Promise<GroupCategory> {
		await this.ensureSchema()

		const categoryId = this.generateId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO group_categories (
				category_id, name, description, display_order, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?)`,
			categoryId,
			name,
			description || '',
			displayOrder,
			now,
			now
		)

		logger
			.withTags({
				type: 'category_created',
			})
			.info('Created category', {
				categoryId,
				name,
			})

		return {
			categoryId,
			name,
			description,
			displayOrder,
			createdAt: now,
			updatedAt: now,
		}
	}

	async getCategory(categoryId: string): Promise<GroupCategory | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupCategoryData>('SELECT * FROM group_categories WHERE category_id = ?', categoryId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			categoryId: row.category_id,
			name: row.name,
			description: row.description || null,
			displayOrder: row.display_order,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	}

	async listCategories(): Promise<GroupCategory[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<GroupCategoryData>('SELECT * FROM group_categories ORDER BY display_order ASC, name ASC')
			.toArray()

		return rows.map((row) => ({
			categoryId: row.category_id,
			name: row.name,
			description: row.description || null,
			displayOrder: row.display_order,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	async updateCategory(
		categoryId: string,
		updates: {
			name?: string
			description?: string | null
			displayOrder?: number
		}
	): Promise<GroupCategory> {
		await this.ensureSchema()

		const category = await this.getCategory(categoryId)
		if (!category) {
			throw new Error('Category not found')
		}

		const now = Date.now()
		const updateFields: string[] = []
		const values: Array<string | number> = []

		if (updates.name !== undefined) {
			updateFields.push('name = ?')
			values.push(updates.name)
		}

		if (updates.description !== undefined) {
			updateFields.push('description = ?')
			values.push(updates.description || '')
		}

		if (updates.displayOrder !== undefined) {
			updateFields.push('display_order = ?')
			values.push(updates.displayOrder)
		}

		updateFields.push('updated_at = ?')
		values.push(now)

		values.push(categoryId)

		await this.ctx.storage.sql.exec(
			`UPDATE group_categories SET ${updateFields.join(', ')} WHERE category_id = ?`,
			...values
		)

		logger
			.withTags({
				type: 'category_updated',
			})
			.info('Updated category', {
				categoryId,
				updates: Object.keys(updates),
			})

		const updated = await this.getCategory(categoryId)
		if (!updated) {
			throw new Error('Category not found after update')
		}

		return updated
	}

	async deleteCategory(categoryId: string): Promise<void> {
		await this.ensureSchema()

		const category = await this.getCategory(categoryId)
		if (!category) {
			throw new Error('Category not found')
		}

		// Check if any groups are using this category
		const groupsInCategory = await this.ctx.storage.sql
			.exec<GroupData>('SELECT * FROM groups WHERE category_id = ?', categoryId)
			.toArray()

		if (groupsInCategory.length > 0) {
			throw new Error('Cannot delete category that is being used by groups')
		}

		await this.ctx.storage.sql.exec('DELETE FROM group_categories WHERE category_id = ?', categoryId)

		logger
			.withTags({
				type: 'category_deleted',
			})
			.info('Deleted category', {
				categoryId,
				name: category.name,
			})
	}
}
