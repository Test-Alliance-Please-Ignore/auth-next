import { DurableObject } from 'cloudflare:workers'

import { and, createDbClient, eq, inArray, isNull, like, or, sql } from '@repo/db-utils'

// Import Core database schema for Discord server and role lookups
import { discordRoles, discordServers } from '../../core/src/db/schema'
import * as coreSchema from '../../core/src/db/schema'
import { createDb } from './db'
import {
	categories,
	groupAdmins,
	groupDiscordInvites,
	groupDiscordServerRoles,
	groupDiscordServers,
	groupInvitations,
	groupInviteCodeRedemptions,
	groupInviteCodes,
	groupJoinRequests,
	groupMembers,
	groupPermissions,
	groups,
	permissionCategories,
	permissions,
} from './db/schema'
import { generateInviteCode } from './services/code-generator'
import {
	canCreateGroupInCategory,
	canManageGroup,
	canModerateGroup,
	canViewCategory,
	canViewGroup,
	canViewGroupMembers,
	isGroupOwner,
} from './services/permissions'

import type {
	AttachPermissionRequest,
	Category,
	CategoryWithGroups,
	CreateCategoryRequest,
	CreateGroupRequest,
	CreateGroupScopedPermissionRequest,
	CreateInvitationRequest,
	CreateInviteCodeRequest,
	CreateInviteCodeResponse,
	CreateJoinRequestRequest,
	CreatePermissionCategoryRequest,
	CreatePermissionRequest,
	GetGroupMemberPermissionsResponse,
	GetMultiGroupMemberPermissionsResponse,
	Group,
	GroupAdmin,
	GroupInvitation,
	GroupInvitationWithDetails,
	GroupInviteCode,
	GroupJoinRequest,
	GroupJoinRequestWithDetails,
	GroupMember,
	GroupMembershipSummary,
	GroupPermissionWithDetails,
	Groups,
	GroupWithDetails,
	ListGroupsFilters,
	Permission,
	PermissionCategory,
	PermissionTarget,
	PermissionWithDetails,
	RedeemInviteCodeResponse,
	UpdateCategoryRequest,
	UpdateGroupPermissionRequest,
	UpdateGroupRequest,
	UpdatePermissionCategoryRequest,
	UpdatePermissionRequest,
	UserPermission,
} from '@repo/groups'
import type { Env } from './context'

/**
 * Groups Durable Object
 *
 * Manages the groups system with PostgreSQL as primary storage.
 * Implements comprehensive permission checks and business logic for:
 * - Categories and groups
 * - Membership management
 * - Invitations and invite codes
 * - Join requests and approvals
 */
export class GroupsDO extends DurableObject<Env> implements Groups {
	private db: ReturnType<typeof createDb>
	private coreDb: ReturnType<typeof createDbClient<typeof coreSchema>>

	// In-memory caches with TTL
	private discordServersCache = new Map<string, { data: any[]; expires: number }>()
	private groupMembersCache = new Map<string, { data: string[]; expires: number }>()
	private permissionsCache = new Map<string, { data: UserPermission[]; expires: number }>()
	private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.coreDb = createDbClient(env.DATABASE_URL, coreSchema)
	}

	/**
	 * ============================================
	 * CATEGORY OPERATIONS
	 * ============================================
	 */

	async createCategory(data: CreateCategoryRequest, adminUserId: string): Promise<Category> {
		// Admin-only operation - validation should happen before calling this

		const [category] = await this.db
			.insert(categories)
			.values({
				name: data.name,
				description: data.description || null,
				visibility: data.visibility || 'public',
				allowGroupCreation: data.allowGroupCreation || 'anyone',
			})
			.returning()

		// Invalidate categories cache
		await this.invalidateCategoriesCache()

		return this.mapCategory(category)
	}

	async listCategories(userId: string, isAdmin: boolean): Promise<Category[]> {
		// Try to get from KV cache first
		const cacheKey = 'categories:all:v1'
		const cached = await this.env.GROUPS_KV?.get(cacheKey, { type: 'json' })

		let allCategories: Array<typeof categories.$inferSelect>

		if (cached) {
			allCategories = cached as Array<typeof categories.$inferSelect>
		} else {
			// Cache miss - fetch from database
			allCategories = await this.db.query.categories.findMany({
				orderBy: (categories, { asc }) => [asc(categories.name)],
			})

			// Store in KV with 1 hour TTL
			await this.env.GROUPS_KV?.put(cacheKey, JSON.stringify(allCategories), {
				expirationTtl: 3600,
			})
		}

		// Filter based on permissions (user-specific, so always done after caching)
		const visible = allCategories.filter((cat) => canViewCategory(cat, userId, isAdmin))

		return visible.map(this.mapCategory)
	}

	async getCategory(
		id: string,
		userId: string,
		isAdmin: boolean
	): Promise<CategoryWithGroups | null> {
		const category = await this.db.query.categories.findFirst({
			where: eq(categories.id, id),
			with: {
				groups: true,
			},
		})

		if (!category) return null

		// Check if user can view this category
		if (!canViewCategory(category, userId, isAdmin)) {
			return null
		}

		// Filter groups based on user permissions
		const visibleGroups = await Promise.all(
			category.groups.map(async (group) => {
				const isMember = await this.isUserMember(group.id, userId)
				if (canViewGroup(group, userId, isAdmin, isMember)) {
					return this.mapGroup(group)
				}
				return null
			})
		)

		return {
			...this.mapCategory(category),
			groups: visibleGroups.filter((g): g is Group => g !== null),
			groupCount: visibleGroups.filter((g) => g !== null).length,
		}
	}

	async updateCategory(
		id: string,
		data: UpdateCategoryRequest,
		adminUserId: string
	): Promise<Category> {
		// Admin-only operation

		const updates: Partial<typeof categories.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.visibility !== undefined) updates.visibility = data.visibility
		if (data.allowGroupCreation !== undefined) updates.allowGroupCreation = data.allowGroupCreation

		updates.updatedAt = new Date()

		const [updated] = await this.db
			.update(categories)
			.set(updates)
			.where(eq(categories.id, id))
			.returning()

		if (!updated) {
			throw new Error('Category not found')
		}

		// Invalidate categories cache
		await this.invalidateCategoriesCache()

		return this.mapCategory(updated)
	}

	async deleteCategory(id: string, adminUserId: string): Promise<void> {
		// Admin-only operation
		// CASCADE will delete all groups in this category and their relations
		await this.db.delete(categories).where(eq(categories.id, id))

		// Invalidate categories cache
		await this.invalidateCategoriesCache()
	}

	/**
	 * ============================================
	 * GROUP OPERATIONS
	 * ============================================
	 */

	async createGroup(data: CreateGroupRequest, userId: string, isAdmin: boolean): Promise<Group> {
		// Validate category exists and user can create groups in it
		const category = await this.db.query.categories.findFirst({
			where: eq(categories.id, data.categoryId),
		})

		if (!category) {
			throw new Error('Category not found')
		}

		if (!canCreateGroupInCategory(category, userId, isAdmin)) {
			throw new Error('Not allowed to create groups in this category')
		}

		// Create the group
		const [group] = await this.db
			.insert(groups)
			.values({
				categoryId: data.categoryId,
				name: data.name,
				description: data.description || null,
				visibility: data.visibility || 'public',
				joinMode: data.joinMode || 'open',
				ownerId: userId,
			})
			.returning()

		// Automatically add the owner as a member
		await this.db.insert(groupMembers).values({
			groupId: group.id,
			userId: userId,
		})

		return this.mapGroup(group)
	}

	async listGroups(
		filters: ListGroupsFilters,
		userId: string,
		isAdmin: boolean
	): Promise<GroupWithDetails[]> {
		// Build query conditions
		const conditions = []

		if (filters.categoryId) {
			conditions.push(eq(groups.categoryId, filters.categoryId))
		}

		if (filters.visibility) {
			conditions.push(eq(groups.visibility, filters.visibility))
		}

		if (filters.joinMode) {
			conditions.push(eq(groups.joinMode, filters.joinMode))
		}

		if (filters.search) {
			conditions.push(like(groups.name, `%${filters.search}%`))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		// Get groups with category
		const allGroups = await this.db.query.groups.findMany({
			where: whereClause,
			with: {
				category: true,
			},
			orderBy: (groups, { asc }) => [asc(groups.name)],
		})

		// Filter by user memberships if requested
		let groupsToCheck = allGroups

		if (filters.myGroups) {
			const userMemberships = await this.db.query.groupMembers.findMany({
				where: eq(groupMembers.userId, userId),
			})
			const memberGroupIds = new Set(userMemberships.map((m) => m.groupId))
			groupsToCheck = allGroups.filter((g) => memberGroupIds.has(g.id))
		}

		// Early return if no groups to check
		if (groupsToCheck.length === 0) {
			return []
		}

		// === BATCH ALL QUERIES TO ELIMINATE N+1 PROBLEM ===
		const groupIds = groupsToCheck.map((g) => g.id)

		// Batch query 1: Get all memberships for this user across all groups
		const userMemberships = await this.db.query.groupMembers.findMany({
			where: and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, userId)),
		})
		const memberGroupIds = new Set(userMemberships.map((m) => m.groupId))

		// Batch query 2: Get all admin designations for this user
		const userAdminRoles = await this.db.query.groupAdmins.findMany({
			where: and(inArray(groupAdmins.groupId, groupIds), eq(groupAdmins.userId, userId)),
		})
		const adminGroupIds = new Set(userAdminRoles.map((a) => a.groupId))

		// Batch query 3: Get member counts for all groups in one query
		const memberCounts = await this.db
			.select({
				groupId: groupMembers.groupId,
				count: sql<number>`count(*)::int`,
			})
			.from(groupMembers)
			.where(inArray(groupMembers.groupId, groupIds))
			.groupBy(groupMembers.groupId)

		const memberCountMap = new Map(memberCounts.map((m) => [m.groupId, m.count]))

		// === NOW BUILD RESULTS WITHOUT ADDITIONAL QUERIES ===
		const result: GroupWithDetails[] = []

		for (const group of groupsToCheck) {
			const isMember = memberGroupIds.has(group.id)

			if (canViewGroup(group, userId, isAdmin, isMember)) {
				const isOwner = group.ownerId === userId
				const isAdminOfGroup = adminGroupIds.has(group.id)
				const memberCount = memberCountMap.get(group.id) || 0

				result.push({
					...this.mapGroup(group),
					category: this.mapCategory(group.category),
					memberCount,
					isOwner,
					isAdmin: isAdminOfGroup,
					isMember,
				})
			}
		}

		return result
	}

	async getGroup(id: string, userId: string, isAdmin: boolean): Promise<GroupWithDetails | null> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
			with: {
				category: true,
			},
		})

		if (!group) return null

		const isMember = await this.isUserMember(id, userId)

		if (!canViewGroup(group, userId, isAdmin, isMember)) {
			return null
		}

		const isOwner = group.ownerId === userId
		const isAdminOfGroup = await this.isUserGroupAdmin(id, userId)
		const memberCount = await this.getGroupMemberCount(id)

		// Fetch all group admins
		const admins = await this.db.query.groupAdmins.findMany({
			where: eq(groupAdmins.groupId, id),
		})
		const adminUserIds = admins.map((admin) => admin.userId)

		// Lookup owner's character name
		const { bulkFindMainCharactersByUserIds } = await import('./services/character-lookup')
		const characterNames = await bulkFindMainCharactersByUserIds([group.ownerId], this.db)
		const ownerName = characterNames.get(group.ownerId)

		return {
			...this.mapGroup(group),
			category: this.mapCategory(group.category),
			memberCount,
			isOwner,
			isAdmin: isAdminOfGroup,
			isMember,
			adminUserIds,
			ownerName,
		}
	}

	async updateGroup(id: string, data: UpdateGroupRequest, userId: string): Promise<Group> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, userId)) {
			throw new Error('Only the group owner can update the group')
		}

		// Validate category exists if categoryId is being updated
		if (data.categoryId !== undefined) {
			const category = await this.db.query.categories.findFirst({
				where: eq(categories.id, data.categoryId),
			})

			if (!category) {
				throw new Error('Category not found')
			}
		}

		const updates: Partial<typeof groups.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.visibility !== undefined) updates.visibility = data.visibility
		if (data.joinMode !== undefined) updates.joinMode = data.joinMode
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId

		updates.updatedAt = new Date()

		const [updated] = await this.db.update(groups).set(updates).where(eq(groups.id, id)).returning()

		if (!updated) {
			throw new Error('Failed to update group')
		}

		return this.mapGroup(updated)
	}

	async deleteGroup(id: string, userId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, userId)) {
			throw new Error('Only the group owner can delete the group')
		}

		// CASCADE will delete all members, admins, invitations, etc.
		await this.db.delete(groups).where(eq(groups.id, id))
	}

	async transferOwnership(
		groupId: string,
		requestingUserId: string,
		newOwnerId: string,
		isAdmin: boolean = false
	): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Allow transfer if: requesting user is current owner OR requesting user is app admin
		const isCurrentOwner = group.ownerId === requestingUserId
		if (!isCurrentOwner && !isAdmin) {
			throw new Error('Only the current owner or app admins can transfer ownership')
		}

		// Prevent transferring to the same owner
		if (group.ownerId === newOwnerId) {
			throw new Error('Cannot transfer ownership to the current owner')
		}

		// Check if new owner is a member
		const isNewOwnerMember = await this.isUserMember(groupId, newOwnerId)
		if (!isNewOwnerMember) {
			throw new Error('New owner must be a group member')
		}

		const oldOwnerId = group.ownerId

		// Remove new owner from admins list (owners don't need to be in admins table)
		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, newOwnerId)))

		// Update group ownership
		await this.db.update(groups).set({ ownerId: newOwnerId }).where(eq(groups.id, groupId))

		// Always add old owner as admin after ownership transfer
		// Check if they're already in the admins table (edge case: they might have been added manually before transfer)
		const isAlreadyAdmin = await this.isUserGroupAdmin(groupId, oldOwnerId)
		if (!isAlreadyAdmin) {
			await this.db.insert(groupAdmins).values({
				groupId,
				userId: oldOwnerId,
			})
		}

		// Invalidate permissions cache for both old and new owners (their permissions may change)
		this.invalidateUserPermissionsCache(oldOwnerId)
		this.invalidateUserPermissionsCache(newOwnerId)
	}

	/**
	 * ============================================
	 * MEMBERSHIP OPERATIONS
	 * ============================================
	 */

	async joinGroup(groupId: string, userId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Can only join open groups via this method
		if (group.joinMode !== 'open') {
			throw new Error('Group is not open for joining. Use join request or invitation.')
		}

		// Check if already a member
		const isMember = await this.isUserMember(groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId,
			userId,
		})

		// Cancel any pending join requests from this user for this group
		await this.cancelPendingJoinRequests(groupId, userId)

		// Invalidate group members cache
		this.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they now have new permissions from this group)
		this.invalidateUserPermissionsCache(userId)
	}

	async leaveGroup(groupId: string, userId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Owner cannot leave (must transfer ownership first)
		if (group.ownerId === userId) {
			throw new Error('Group owner cannot leave. Transfer ownership first.')
		}

		// Verify user is actually a member before attempting to remove
		const isMember = await this.isUserMember(groupId, userId)
		if (!isMember) {
			throw new Error('You are not a member of this group')
		}

		// Remove from admins if they are one
		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, userId)))

		// Remove from members
		await this.db
			.delete(groupMembers)
			.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they lost permissions from this group)
		this.invalidateUserPermissionsCache(userId)
	}

	async removeMember(groupId: string, adminUserId: string, targetUserId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can remove members')
		}

		// Cannot remove the owner
		if (group.ownerId === targetUserId) {
			throw new Error('Cannot remove the group owner')
		}

		// Remove from admins if they are one
		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, targetUserId)))

		// Remove from members
		await this.db
			.delete(groupMembers)
			.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(groupId)
		// Invalidate target user's permissions cache
		this.invalidateUserPermissionsCache(targetUserId)
	}

	async getGroupMembers(groupId: string, userId: string, isAdmin: boolean): Promise<GroupMember[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isMember = await this.isUserMember(groupId, userId)
		const isGroupOwnerOrAdmin =
			group.ownerId === userId || (await this.isUserGroupAdmin(groupId, userId))

		if (!canViewGroupMembers(group, userId, isAdmin, isMember, isGroupOwnerOrAdmin)) {
			throw new Error('Not authorized to view group members')
		}

		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
			orderBy: (groupMembers, { asc }) => [asc(groupMembers.joinedAt)],
		})

		// Fetch main character names and IDs for all members
		const { bulkFindMainCharactersWithIdsByUserIds } = await import('./services/character-lookup')
		const userIds = members.map((member) => member.userId)
		const characterData = await bulkFindMainCharactersWithIdsByUserIds(userIds, this.db)

		// Enrich members with character names and IDs
		return members.map((member) => {
			const charData = characterData.get(member.userId)
			return {
				...this.mapGroupMember(member),
				mainCharacterName: charData?.name,
				mainCharacterId: charData?.characterId,
			}
		})
	}

	async getUserMemberships(userId: string): Promise<GroupMembershipSummary[]> {
		const memberships = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.userId, userId),
			with: {
				group: {
					with: {
						category: true,
					},
				},
			},
		})

		const result: GroupMembershipSummary[] = []

		for (const membership of memberships) {
			const isOwner = membership.group.ownerId === userId
			const isAdmin = await this.isUserGroupAdmin(membership.groupId, userId)

			result.push({
				groupId: membership.groupId,
				groupName: membership.group.name,
				categoryName: membership.group.category.name,
				isOwner,
				isAdmin,
				joinedAt: membership.joinedAt,
			})
		}

		return result
	}

	/**
	 * ============================================
	 * ADMIN OPERATIONS
	 * ============================================
	 */

	async addAdmin(
		groupId: string,
		ownerId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId, isGlobalAdmin)) {
			throw new Error('Only the group owner or site admins can add admins')
		}

		// Target must be a member
		const isMember = await this.isUserMember(groupId, targetUserId)
		if (!isMember) {
			throw new Error('User must be a group member to become an admin')
		}

		// Check if already an admin - if so, operation is idempotent (just return success)
		const isAlreadyAdmin = await this.isUserGroupAdmin(groupId, targetUserId)
		if (isAlreadyAdmin) {
			return // Already an admin, nothing to do
		}

		// Add as admin
		await this.db.insert(groupAdmins).values({
			groupId,
			userId: targetUserId,
		})

		// Invalidate target user's permissions cache (admin status may grant new permissions)
		this.invalidateUserPermissionsCache(targetUserId)
	}

	async removeAdmin(
		groupId: string,
		ownerId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId, isGlobalAdmin)) {
			throw new Error('Only the group owner or site admins can remove admins')
		}

		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, targetUserId)))

		// Invalidate target user's permissions cache (they may lose admin-only permissions)
		this.invalidateUserPermissionsCache(targetUserId)
	}

	async isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
		return this.isUserGroupAdmin(groupId, userId)
	}

	/**
	 * ============================================
	 * JOIN REQUEST OPERATIONS
	 * ============================================
	 */

	async createJoinRequest(
		data: CreateJoinRequestRequest,
		userId: string
	): Promise<GroupJoinRequest> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Can only create join requests for approval-mode groups
		if (group.joinMode !== 'approval') {
			throw new Error('Group does not accept join requests')
		}

		// Check if already a member
		const isMember = await this.isUserMember(data.groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Check for existing pending request
		const existingRequest = await this.db.query.groupJoinRequests.findFirst({
			where: and(
				eq(groupJoinRequests.groupId, data.groupId),
				eq(groupJoinRequests.userId, userId),
				eq(groupJoinRequests.status, 'pending')
			),
		})

		if (existingRequest) {
			throw new Error('You already have a pending join request for this group')
		}

		const [request] = await this.db
			.insert(groupJoinRequests)
			.values({
				groupId: data.groupId,
				userId,
				reason: data.reason || null,
				status: 'pending',
			})
			.returning()

		return this.mapGroupJoinRequest(request)
	}

	async listJoinRequests(
		groupId: string,
		adminUserId: string
	): Promise<GroupJoinRequestWithDetails[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can view join requests')
		}

		const requests = await this.db.query.groupJoinRequests.findMany({
			where: and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, 'pending')),
			orderBy: (groupJoinRequests, { desc }) => [desc(groupJoinRequests.createdAt)],
		})

		if (requests.length === 0) {
			return []
		}

		// Fetch main character names for all requesting users
		const { bulkFindMainCharactersByUserIds } = await import('./services/character-lookup')
		const userIds = requests.map((req) => req.userId)
		const characterNames = await bulkFindMainCharactersByUserIds(userIds, this.db)

		// Enrich requests with user character names
		return requests.map((req) => ({
			...this.mapGroupJoinRequest(req),
			userMainCharacterName: characterNames.get(req.userId) || undefined,
		}))
	}

	async approveJoinRequest(requestId: string, adminUserId: string): Promise<void> {
		const request = await this.db.query.groupJoinRequests.findFirst({
			where: eq(groupJoinRequests.id, requestId),
		})

		if (!request) {
			throw new Error('Join request not found')
		}

		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, request.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(request.groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can approve join requests')
		}

		if (request.status !== 'pending') {
			throw new Error('Join request is not pending')
		}

		// Add user as member
		await this.db.insert(groupMembers).values({
			groupId: request.groupId,
			userId: request.userId,
		})

		// Update this request status to approved
		await this.db
			.update(groupJoinRequests)
			.set({
				status: 'approved',
				respondedAt: new Date(),
				respondedBy: adminUserId,
			})
			.where(eq(groupJoinRequests.id, requestId))

		// Cancel any OTHER pending join requests from this user for this group
		// (The approved one has already been updated above)
		await this.cancelPendingJoinRequests(request.groupId, request.userId)

		// Invalidate group members cache
		this.invalidateGroupMembersCache(request.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.invalidateUserPermissionsCache(request.userId)
	}

	async rejectJoinRequest(requestId: string, adminUserId: string): Promise<void> {
		const request = await this.db.query.groupJoinRequests.findFirst({
			where: eq(groupJoinRequests.id, requestId),
		})

		if (!request) {
			throw new Error('Join request not found')
		}

		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, request.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(request.groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can reject join requests')
		}

		if (request.status !== 'pending') {
			throw new Error('Join request is not pending')
		}

		// Update request status
		await this.db
			.update(groupJoinRequests)
			.set({
				status: 'rejected',
				respondedAt: new Date(),
				respondedBy: adminUserId,
			})
			.where(eq(groupJoinRequests.id, requestId))
	}

	/**
	 * ============================================
	 * INVITATION OPERATIONS
	 * ============================================
	 */

	async createInvitation(
		data: CreateInvitationRequest,
		inviterId: string
	): Promise<GroupInvitation> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(data.groupId, inviterId)

		if (!canModerateGroup(group, inviterId, isAdmin)) {
			throw new Error('Only group owner or admins can invite users')
		}

		// Look up user by their main character name
		const { findUserByMainCharacterName } = await import('./services/character-lookup')
		const userLookup = await findUserByMainCharacterName(data.characterName, this.db)

		if (!userLookup) {
			throw new Error(`Character '${data.characterName}' not found or is not a main character`)
		}

		// Check if the user is already a member
		const isMember = await this.isUserMember(data.groupId, userLookup.userId)
		if (isMember) {
			throw new Error(`User '${data.characterName}' is already a member of this group`)
		}

		// Check for existing pending invitation
		const existingInvitation = await this.db.query.groupInvitations.findFirst({
			where: and(
				eq(groupInvitations.groupId, data.groupId),
				eq(groupInvitations.inviteeUserId, userLookup.userId),
				eq(groupInvitations.status, 'pending')
			),
		})

		if (existingInvitation) {
			throw new Error(`User '${data.characterName}' already has a pending invitation`)
		}

		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + 7) // 7 days from now

		const [invitation] = await this.db
			.insert(groupInvitations)
			.values({
				groupId: data.groupId,
				inviterId,
				inviteeMainCharacterId: userLookup.characterId,
				inviteeUserId: userLookup.userId,
				status: 'pending',
				expiresAt,
			})
			.returning()

		return this.mapGroupInvitation(invitation)
	}

	async listPendingInvitations(userId: string): Promise<GroupInvitationWithDetails[]> {
		const invitations = await this.db.query.groupInvitations.findMany({
			where: and(
				eq(groupInvitations.inviteeUserId, userId),
				eq(groupInvitations.status, 'pending')
			),
			with: {
				group: true,
			},
			orderBy: (groupInvitations, { desc }) => [desc(groupInvitations.createdAt)],
		})

		// Check for expired invitations
		const now = new Date()

		return invitations
			.filter((inv) => inv.expiresAt > now)
			.map((inv) => ({
				...this.mapGroupInvitation(inv),
				group: {
					id: inv.group.id,
					name: inv.group.name,
					description: inv.group.description,
					visibility: inv.group.visibility,
				},
			}))
	}

	async acceptInvitation(invitationId: string, userId: string): Promise<void> {
		const invitation = await this.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== userId) {
			throw new Error('This invitation is not for you')
		}

		if (invitation.status !== 'pending') {
			throw new Error('Invitation is not pending')
		}

		// Check if expired
		if (invitation.expiresAt < new Date()) {
			await this.db
				.update(groupInvitations)
				.set({ status: 'expired' })
				.where(eq(groupInvitations.id, invitationId))
			throw new Error('Invitation has expired')
		}

		// Check if already a member
		const isMember = await this.isUserMember(invitation.groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId: invitation.groupId,
			userId,
		})

		// Cancel any pending join requests from this user for this group
		await this.cancelPendingJoinRequests(invitation.groupId, userId)

		// Update invitation status
		await this.db
			.update(groupInvitations)
			.set({
				status: 'accepted',
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(invitation.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.invalidateUserPermissionsCache(userId)
	}

	async declineInvitation(invitationId: string, userId: string): Promise<void> {
		const invitation = await this.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== userId) {
			throw new Error('This invitation is not for you')
		}

		if (invitation.status !== 'pending') {
			throw new Error('Invitation is not pending')
		}

		// Update invitation status
		await this.db
			.update(groupInvitations)
			.set({
				status: 'declined',
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))
	}

	async getGroupInvitations(
		groupId: string,
		userId: string,
		isAdmin: boolean
	): Promise<GroupInvitationWithDetails[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isGroupAdmin = await this.isUserGroupAdmin(groupId, userId)

		if (!canModerateGroup(group, userId, isGroupAdmin) && !isAdmin) {
			throw new Error('Only group owner, admins, or system admins can view invitations')
		}

		// Fetch all pending invitations for this group
		const invitations = await this.db.query.groupInvitations.findMany({
			where: and(eq(groupInvitations.groupId, groupId), eq(groupInvitations.status, 'pending')),
			orderBy: (groupInvitations, { desc }) => [desc(groupInvitations.createdAt)],
		})

		// Enrich with character names
		const { bulkFindMainCharactersByUserIds } = await import('./services/character-lookup')
		const userIds = [
			...new Set([
				...invitations.map((inv) => inv.inviterId),
				...invitations.map((inv) => inv.inviteeUserId).filter((id): id is string => id !== null),
			]),
		]
		const characterNames = await bulkFindMainCharactersByUserIds(userIds, this.db)

		return invitations.map((inv) => ({
			...this.mapGroupInvitation(inv),
			inviterCharacterName: characterNames.get(inv.inviterId),
			inviteeCharacterName: inv.inviteeUserId ? characterNames.get(inv.inviteeUserId) : undefined,
			group: {
				id: group.id,
				name: group.name,
				description: group.description,
				visibility: group.visibility,
			},
		}))
	}

	/**
	 * ============================================
	 * INVITE CODE OPERATIONS
	 * ============================================
	 */

	async createInviteCode(
		data: CreateInviteCodeRequest,
		userId: string,
		isAdmin = false
	): Promise<CreateInviteCodeResponse> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, userId, isAdmin)) {
			throw new Error('Only the group owner or global admin can create invite codes')
		}

		// Validate expiration
		if (data.expiresInDays < 1 || data.expiresInDays > 30) {
			throw new Error('Invite code expiration must be between 1 and 30 days')
		}

		// Generate unique code
		let code = generateInviteCode()
		let attempts = 0
		while (attempts < 10) {
			const existing = await this.db.query.groupInviteCodes.findFirst({
				where: eq(groupInviteCodes.code, code),
			})
			if (!existing) break
			code = generateInviteCode()
			attempts++
		}

		if (attempts >= 10) {
			throw new Error('Failed to generate unique invite code')
		}

		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + data.expiresInDays)

		const [inviteCode] = await this.db
			.insert(groupInviteCodes)
			.values({
				groupId: data.groupId,
				code,
				createdBy: userId,
				maxUses: data.maxUses || null,
				currentUses: 0,
				expiresAt,
			})
			.returning()

		return {
			code: this.mapGroupInviteCode(inviteCode),
		}
	}

	async listInviteCodes(
		groupId: string,
		userId: string,
		isGlobalAdmin = false
	): Promise<GroupInviteCode[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isGroupAdmin = await this.isUserGroupAdmin(groupId, userId)

		// Global admins, group owner, or group admins can view invite codes
		if (!isGlobalAdmin && !canModerateGroup(group, userId, isGroupAdmin)) {
			throw new Error('Only group owner, group admins, or global admins can view invite codes')
		}

		const codes = await this.db.query.groupInviteCodes.findMany({
			where: and(eq(groupInviteCodes.groupId, groupId), isNull(groupInviteCodes.revokedAt)),
			orderBy: (groupInviteCodes, { desc }) => [desc(groupInviteCodes.createdAt)],
		})

		return codes.map(this.mapGroupInviteCode)
	}

	async revokeInviteCode(codeId: string, userId: string, isAdmin = false): Promise<void> {
		const inviteCode = await this.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.id, codeId),
			with: {
				group: true,
			},
		})

		if (!inviteCode) {
			throw new Error('Invite code not found')
		}

		if (!canManageGroup(inviteCode.group, userId, isAdmin)) {
			throw new Error('Only the group owner or global admin can revoke invite codes')
		}

		await this.db
			.update(groupInviteCodes)
			.set({ revokedAt: new Date() })
			.where(eq(groupInviteCodes.id, codeId))
	}

	async getGroupByInviteCode(
		code: string,
		userId?: string
	): Promise<import('@repo/groups').GroupByInviteCodeResponse> {
		const inviteCode = await this.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.code, code),
			with: {
				group: {
					with: {
						category: true,
					},
				},
			},
		})

		if (!inviteCode) {
			throw new Error('Invalid invite code')
		}

		const now = new Date()
		const isExpired = inviteCode.expiresAt < now
		const isRevoked = inviteCode.revokedAt !== null
		const hasRemainingUses =
			inviteCode.maxUses === null || inviteCode.currentUses < inviteCode.maxUses
		const isValid = !isExpired && !isRevoked && hasRemainingUses

		// Build group details directly (bypass permission checks since invite code is the authorization)
		const group = inviteCode.group
		const category = inviteCode.group.category

		// Get member count
		const memberCount = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(groupMembers)
			.where(eq(groupMembers.groupId, group.id))
			.then((rows) => rows[0]?.count || 0)

		// Check user's relationship to the group
		let isOwner = false
		let isAdmin = false
		let isMember = false

		if (userId) {
			isOwner = group.ownerId === userId
			isAdmin = await this.isUserGroupAdmin(group.id, userId)
			isMember = await this.isUserMember(group.id, userId)
		}

		const groupDetails: import('@repo/groups').GroupWithDetails = {
			...this.mapGroup(group),
			category: this.mapCategory(category),
			memberCount,
			isOwner,
			isAdmin,
			isMember,
		}

		// Check if user can join
		let canJoin = isValid
		let errorMessage: string | undefined

		if (userId) {
			if (isMember) {
				canJoin = false
				errorMessage = 'You are already a member of this group'
			}

			// Check if already redeemed this code
			const existingRedemption = await this.db.query.groupInviteCodeRedemptions.findFirst({
				where: and(
					eq(groupInviteCodeRedemptions.inviteCodeId, inviteCode.id),
					eq(groupInviteCodeRedemptions.userId, userId)
				),
			})

			if (existingRedemption) {
				canJoin = false
				errorMessage = 'You have already redeemed this invite code'
			}
		}

		if (!isValid) {
			if (isRevoked) {
				errorMessage = 'This invite code has been revoked'
			} else if (isExpired) {
				errorMessage = 'This invite code has expired'
			} else if (!hasRemainingUses) {
				errorMessage = 'This invite code has reached its usage limit'
			}
		}

		return {
			group: groupDetails,
			inviteCode: {
				isValid,
				isExpired,
				isRevoked,
				hasRemainingUses,
				expiresAt: inviteCode.expiresAt,
			},
			canJoin,
			errorMessage,
		}
	}

	async redeemInviteCode(code: string, userId: string): Promise<RedeemInviteCodeResponse> {
		const inviteCode = await this.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.code, code),
			with: {
				group: true,
			},
		})

		if (!inviteCode) {
			throw new Error('Invalid invite code')
		}

		// Check if revoked
		if (inviteCode.revokedAt) {
			throw new Error('Invite code has been revoked')
		}

		// Check if expired
		if (inviteCode.expiresAt < new Date()) {
			throw new Error('Invite code has expired')
		}

		// Check usage limit
		if (inviteCode.maxUses !== null && inviteCode.currentUses >= inviteCode.maxUses) {
			throw new Error('Invite code has reached its usage limit')
		}

		// Check if user has already redeemed this code
		const existingRedemption = await this.db.query.groupInviteCodeRedemptions.findFirst({
			where: and(
				eq(groupInviteCodeRedemptions.inviteCodeId, inviteCode.id),
				eq(groupInviteCodeRedemptions.userId, userId)
			),
		})

		if (existingRedemption) {
			throw new Error('You have already redeemed this invite code')
		}

		// Check if already a member
		const isMember = await this.isUserMember(inviteCode.groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId: inviteCode.groupId,
			userId,
		})

		// Track redemption
		await this.db.insert(groupInviteCodeRedemptions).values({
			inviteCodeId: inviteCode.id,
			userId,
		})

		// Increment usage count
		await this.db
			.update(groupInviteCodes)
			.set({ currentUses: inviteCode.currentUses + 1 })
			.where(eq(groupInviteCodes.id, inviteCode.id))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(inviteCode.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.invalidateUserPermissionsCache(userId)

		return {
			success: true,
			group: this.mapGroup(inviteCode.group),
			message: `Successfully joined ${inviteCode.group.name}`,
		}
	}

	/**
	 * ============================================
	 * DISCORD INTEGRATION OPERATIONS
	 * ============================================
	 */

	/**
	 * Get all Discord servers for a group
	 * Cached in-memory for 5 minutes
	 */
	async getDiscordServers(groupId: string): Promise<any[]> {
		// Check cache first
		const cached = this.discordServersCache.get(groupId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Fetch group Discord server attachments with role assignments
		const attachments = await this.db.query.groupDiscordServers.findMany({
			where: eq(groupDiscordServers.groupId, groupId),
			with: {
				roles: true,
			},
			orderBy: (groupDiscordServers, { asc }) => [asc(groupDiscordServers.createdAt)],
		})

		// Fetch Discord server details from Core database for each attachment
		const results = await Promise.all(
			attachments.map(async (attachment) => {
				// Fetch Discord server from Core
				const discordServer = await this.coreDb.query.discordServers.findFirst({
					where: eq(discordServers.id, attachment.discordServerId),
					with: {
						roles: true,
					},
				})

				// Fetch role details from Core for each role assignment
				const rolesWithDetails = await Promise.all(
					(attachment.roles || []).map(async (roleAssignment) => {
						const roleDetails = await this.coreDb.query.discordRoles.findFirst({
							where: eq(discordRoles.id, roleAssignment.discordRoleId),
						})
						return {
							id: roleAssignment.id,
							discordRoleId: roleAssignment.discordRoleId,
							discordRole: roleDetails || {
								id: roleAssignment.discordRoleId,
								roleName: roleAssignment.roleName,
								roleId: '',
								discordServerId: attachment.discordServerId,
								createdAt: new Date(),
							},
						}
					})
				)

				return {
					...attachment,
					discordServer: discordServer || null,
					roles: rolesWithDetails,
				}
			})
		)

		// Cache the result
		this.discordServersCache.set(groupId, {
			data: results,
			expires: Date.now() + this.CACHE_TTL,
		})

		return results
	}

	/**
	 * Attach a Discord server from the Core registry to a group
	 */
	async attachDiscordServer(
		groupId: string,
		discordServerId: string,
		autoInvite: boolean,
		autoAssignRoles: boolean
	): Promise<typeof groupDiscordServers.$inferSelect> {
		// Check if already attached
		const existing = await this.db.query.groupDiscordServers.findFirst({
			where: and(
				eq(groupDiscordServers.groupId, groupId),
				eq(groupDiscordServers.discordServerId, discordServerId)
			),
		})

		if (existing) {
			throw new Error('Discord server already attached to this group')
		}

		// Create attachment
		const [server] = await this.db
			.insert(groupDiscordServers)
			.values({
				groupId,
				discordServerId,
				autoInvite,
				autoAssignRoles,
			})
			.returning()

		this.discordServersCache.delete(groupId)
		await this.invalidateGroupsWithDiscordCache()

		return server
	}

	/**
	 * Update a Discord server attachment's settings
	 */
	async updateDiscordServerAttachment(
		attachmentId: string,
		updates: {
			autoInvite?: boolean
			autoAssignRoles?: boolean
		}
	): Promise<typeof groupDiscordServers.$inferSelect> {
		const attachment = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, attachmentId),
		})

		if (!attachment) {
			throw new Error('Discord server attachment not found')
		}

		const updateData: Partial<typeof groupDiscordServers.$inferInsert> = {
			updatedAt: new Date(),
		}

		if (updates.autoInvite !== undefined) {
			updateData.autoInvite = updates.autoInvite
		}
		if (updates.autoAssignRoles !== undefined) {
			updateData.autoAssignRoles = updates.autoAssignRoles
		}

		const [updated] = await this.db
			.update(groupDiscordServers)
			.set(updateData)
			.where(eq(groupDiscordServers.id, attachmentId))
			.returning()

		// Invalidate caches
		this.discordServersCache.delete(attachment.groupId)
		await this.invalidateGroupsWithDiscordCache()

		return updated
	}

	/**
	 * Detach a Discord server from a group
	 */
	async detachDiscordServer(attachmentId: string): Promise<void> {
		const attachment = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, attachmentId),
		})

		if (!attachment) {
			throw new Error('Discord server attachment not found')
		}

		// Delete will cascade to role assignments and invite audit records
		await this.db.delete(groupDiscordServers).where(eq(groupDiscordServers.id, attachmentId))

		// Invalidate caches
		this.discordServersCache.delete(attachment.groupId)
		await this.invalidateGroupsWithDiscordCache()
	}

	/**
	 * Assign a Discord role to a group Discord server attachment
	 */
	async assignRoleToDiscordServer(
		attachmentId: string,
		discordRoleId: string
	): Promise<{ id: string; discordRoleId: string }> {
		// Verify attachment exists
		const attachment = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, attachmentId),
		})

		if (!attachment) {
			throw new Error('Discord server attachment not found')
		}

		// Fetch role details from Core to get role name
		const roleDetails = await this.coreDb.query.discordRoles.findFirst({
			where: eq(discordRoles.id, discordRoleId),
		})

		if (!roleDetails) {
			throw new Error('Discord role not found in registry')
		}

		// Check if role is already assigned
		const existing = await this.db.query.groupDiscordServerRoles.findFirst({
			where: and(
				eq(groupDiscordServerRoles.groupDiscordServerId, attachmentId),
				eq(groupDiscordServerRoles.discordRoleId, discordRoleId)
			),
		})

		if (existing) {
			throw new Error('Role already assigned to this Discord server')
		}

		// Create role assignment
		const [roleAssignment] = await this.db
			.insert(groupDiscordServerRoles)
			.values({
				groupDiscordServerId: attachmentId,
				discordRoleId,
				roleName: roleDetails.roleName,
			})
			.returning()

		// Invalidate cache
		this.discordServersCache.delete(attachment.groupId)

		return {
			id: roleAssignment.id,
			discordRoleId: roleAssignment.discordRoleId,
		}
	}

	/**
	 * Unassign a Discord role from a group Discord server attachment
	 */
	async unassignRoleFromDiscordServer(roleAssignmentId: string): Promise<void> {
		// Get the role assignment to find the group ID for cache invalidation
		const roleAssignment = await this.db.query.groupDiscordServerRoles.findFirst({
			where: eq(groupDiscordServerRoles.id, roleAssignmentId),
			with: {
				groupDiscordServer: true,
			},
		})

		if (!roleAssignment) {
			throw new Error('Role assignment not found')
		}

		// Delete the role assignment
		await this.db
			.delete(groupDiscordServerRoles)
			.where(eq(groupDiscordServerRoles.id, roleAssignmentId))

		// Invalidate cache
		this.discordServersCache.delete(roleAssignment.groupDiscordServer.groupId)
	}

	/**
	 * DEPRECATED: Discord server management now happens through Core registry
	 *
	 * Add a Discord server to a group
	 * Invalidates cache on write
	 */
	/*
	async addDiscordServer(
		groupId: string,
		guildId: string,
		guildName: string | null,
		autoInvite: boolean
	): Promise<typeof groupDiscordServers.$inferSelect> {
		const [server] = await this.db
			.insert(groupDiscordServers)
			.values({
				groupId,
				discordGuildId: guildId,
				discordGuildName: guildName,
				autoInvite,
			})
			.returning()

		// Invalidate cache
		this.discordServersCache.delete(groupId)
		await this.invalidateGroupsWithDiscordCache()

		return server
	}
	*/

	/**
	 * DEPRECATED: Discord server management now happens through Core registry
	 *
	 * Update a Discord server configuration
	 * Invalidates cache on write
	 */
	/*
	async updateDiscordServer(
		serverId: string,
		updates: {
			discordGuildName?: string | null
			autoInvite?: boolean
		}
	): Promise<typeof groupDiscordServers.$inferSelect> {
		const server = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, serverId),
		})

		if (!server) {
			throw new Error('Discord server not found')
		}

		const updateData: Partial<typeof groupDiscordServers.$inferInsert> = {
			updatedAt: new Date(),
		}

		if (updates.discordGuildName !== undefined) {
			updateData.discordGuildName = updates.discordGuildName
		}
		if (updates.autoInvite !== undefined) {
			updateData.autoInvite = updates.autoInvite
		}

		const [updated] = await this.db
			.update(groupDiscordServers)
			.set(updateData)
			.where(eq(groupDiscordServers.id, serverId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update Discord server')
		}

		// Invalidate cache
		this.discordServersCache.delete(server.groupId)
		await this.invalidateGroupsWithDiscordCache()

		return updated
	}
	*/

	/**
	 * DEPRECATED: Discord server management now happens through Core registry
	 *
	 * Delete a Discord server from a group
	 * Invalidates cache on write
	 */
	/*
	async deleteDiscordServer(serverId: string): Promise<void> {
		const server = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, serverId),
		})

		if (!server) {
			throw new Error('Discord server not found')
		}

		await this.db.delete(groupDiscordServers).where(eq(groupDiscordServers.id, serverId))

		// Invalidate cache
		this.discordServersCache.delete(server.groupId)
		await this.invalidateGroupsWithDiscordCache()
	}
	*/

	/**
	 * Get all groups with Discord auto-invite enabled
	 * Cached in DO storage with 5-minute refresh
	 */
	async getGroupsWithDiscordAutoInvite(): Promise<
		Array<{
			groupId: string
			groupName: string
			discordServers: Array<{
				id: string
				discordServerId: string
				roleIds?: string[]
			}>
		}>
	> {
		// Try to get from DO storage cache
		const cacheKey = 'groups-with-discord-auto-invite'
		const cached = await this.state.storage.get<{
			data: any[]
			expires: number
		}>(cacheKey)

		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Cache miss - fetch from database with Discord server registry info
		const servers = await this.db.query.groupDiscordServers.findMany({
			where: eq(groupDiscordServers.autoInvite, true),
			with: {
				group: true,
				roles: true,
			},
		})

		// Group by groupId
		const groupsMap = new Map<
			string,
			{
				groupId: string
				groupName: string
				discordServers: Array<{
					id: string
					discordServerId: string
					roleIds?: string[]
				}>
			}
		>()

		for (const server of servers) {
			const groupId = server.groupId
			if (!groupsMap.has(groupId)) {
				groupsMap.set(groupId, {
					groupId,
					groupName: server.group.name,
					discordServers: [],
				})
			}

			// Collect role IDs if auto-assign is enabled
			const roleIds = server.autoAssignRoles ? server.roles.map((r) => r.discordRoleId) : []

			groupsMap.get(groupId)!.discordServers.push({
				id: server.id,
				discordServerId: server.discordServerId,
				roleIds,
			})
		}

		const result = Array.from(groupsMap.values())

		// Store in DO storage with 5-minute TTL
		await this.state.storage.put(cacheKey, {
			data: result,
			expires: Date.now() + this.CACHE_TTL,
		})

		return result
	}

	/**
	 * Get groups that have a specific Discord server attached
	 */
	async getGroupsByDiscordServer(
		discordServerId: string
	): Promise<Array<{ groupId: string; groupName: string }>> {
		const servers = await this.db.query.groupDiscordServers.findMany({
			where: eq(groupDiscordServers.discordServerId, discordServerId),
			with: {
				group: true,
			},
		})

		return servers.map((server) => ({
			groupId: server.groupId,
			groupName: server.group.name,
		}))
	}

	/**
	 * Get cached group members (user IDs only)
	 * Cached in-memory for 5 minutes
	 */
	async getGroupMemberUserIds(groupId: string): Promise<string[]> {
		// Check cache first
		const cached = this.groupMembersCache.get(groupId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Cache miss - fetch from database
		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
		})

		const userIds = members.map((m) => m.userId)

		// Cache the result
		this.groupMembersCache.set(groupId, {
			data: userIds,
			expires: Date.now() + this.CACHE_TTL,
		})

		return userIds
	}

	/**
	 * Get Discord server configuration for a specific attachment
	 * Used for role refresh operations
	 */
	async getDiscordServerAttachmentConfig(attachmentId: string): Promise<{
		groupId: string
		guildId: string
		roleIds: string[]
	}> {
		// Fetch the attachment with its role assignments
		const attachment = await this.db.query.groupDiscordServers.findFirst({
			where: eq(groupDiscordServers.id, attachmentId),
			with: {
				roles: true,
			},
		})

		if (!attachment) {
			throw new Error('Discord server attachment not found')
		}

		// Fetch the Discord server from Core to get the guild ID
		const discordServer = await this.coreDb.query.discordServers.findFirst({
			where: eq(discordServers.id, attachment.discordServerId),
		})

		if (!discordServer) {
			throw new Error('Discord server not found in registry')
		}

		// Extract role IDs from the Discord role details
		const roleIds = await Promise.all(
			(attachment.roles || []).map(async (roleAssignment) => {
				const roleDetails = await this.coreDb.query.discordRoles.findFirst({
					where: eq(discordRoles.id, roleAssignment.discordRoleId),
				})
				return roleDetails?.roleId || null
			})
		)

		// Filter out null values (in case some roles weren't found)
		const validRoleIds = roleIds.filter((id): id is string => id !== null)

		return {
			groupId: attachment.groupId,
			guildId: discordServer.guildId,
			roleIds: validRoleIds,
		}
	}

	/**
	 * Insert Discord invite audit records
	 * Called by Core service after attempting to join users to Discord servers
	 */
	async insertDiscordInviteAuditRecords(
		records: Array<{
			groupId: string
			groupDiscordServerId: string
			userId: string
			discordUserId: string
			success: boolean
			errorMessage?: string | null
			assignedRoleIds?: string[] | null
		}>
	): Promise<void> {
		if (records.length === 0) {
			return
		}

		await this.db.insert(groupDiscordInvites).values(records)
	}

	/**
	 * ============================================
	 * PERMISSION CATEGORY OPERATIONS
	 * ============================================
	 */

	async createPermissionCategory(
		data: CreatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory> {
		// Admin-only operation - validation should happen before calling this

		const [category] = await this.db
			.insert(permissionCategories)
			.values({
				name: data.name,
				description: data.description || null,
			})
			.returning()

		return this.mapPermissionCategory(category)
	}

	async listPermissionCategories(): Promise<PermissionCategory[]> {
		console.log('[DO] listPermissionCategories - Start')

		try {
			console.log('[DO] listPermissionCategories - About to query database')
			const cats = await this.db.query.permissionCategories.findMany({
				orderBy: (permissionCategories, { asc }) => [asc(permissionCategories.name)],
			})

			console.log('[DO] listPermissionCategories - Query complete, count:', cats?.length)

			const result = cats.map((cat) => this.mapPermissionCategory(cat))
			console.log('[DO] listPermissionCategories - Mapped results, count:', result?.length)

			return result
		} catch (error) {
			console.error('[DO] listPermissionCategories - Error:', error)
			if (error instanceof Error) {
				console.error('[DO] listPermissionCategories - Error message:', error.message)
				console.error('[DO] listPermissionCategories - Error stack:', error.stack)
			}
			throw error
		}
	}

	async updatePermissionCategory(
		id: string,
		data: UpdatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory> {
		// Admin-only operation

		const updates: Partial<typeof permissionCategories.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description

		updates.updatedAt = new Date()

		const [updated] = await this.db
			.update(permissionCategories)
			.set(updates)
			.where(eq(permissionCategories.id, id))
			.returning()

		if (!updated) {
			throw new Error('Permission category not found')
		}

		return this.mapPermissionCategory(updated)
	}

	async deletePermissionCategory(id: string, adminUserId: string): Promise<void> {
		// Admin-only operation
		// SET NULL will update permissions that reference this category
		await this.db.delete(permissionCategories).where(eq(permissionCategories.id, id))
	}

	/**
	 * ============================================
	 * GLOBAL PERMISSION OPERATIONS
	 * ============================================
	 */

	async createPermission(data: CreatePermissionRequest, adminUserId: string): Promise<Permission> {
		// Admin-only operation

		const [permission] = await this.db
			.insert(permissions)
			.values({
				urn: data.urn,
				name: data.name,
				description: data.description || null,
				categoryId: data.categoryId || null,
				createdBy: adminUserId,
			})
			.returning()

		return this.mapPermission(permission)
	}

	async listPermissions(categoryId?: string): Promise<PermissionWithDetails[]> {
		console.log('[DO] listPermissions - Start, categoryId:', categoryId)

		try {
			const whereClause = categoryId ? eq(permissions.categoryId, categoryId) : undefined
			console.log('[DO] listPermissions - whereClause:', whereClause)

			console.log('[DO] listPermissions - About to query database')
			const perms = await this.db.query.permissions.findMany({
				where: whereClause,
				with: {
					category: true,
				},
				orderBy: (permissions, { asc }) => [asc(permissions.name)],
			})

			console.log('[DO] listPermissions - Query complete, count:', perms?.length)

			const result = perms.map((perm) => ({
				...this.mapPermission(perm),
				category: perm.category ? this.mapPermissionCategory(perm.category) : null,
			}))

			console.log('[DO] listPermissions - Mapped results, count:', result?.length)
			return result
		} catch (error) {
			console.error('[DO] listPermissions - Error:', error)
			if (error instanceof Error) {
				console.error('[DO] listPermissions - Error message:', error.message)
				console.error('[DO] listPermissions - Error stack:', error.stack)
			}
			throw error
		}
	}

	async getPermission(id: string): Promise<PermissionWithDetails | null> {
		const perm = await this.db.query.permissions.findFirst({
			where: eq(permissions.id, id),
			with: {
				category: true,
			},
		})

		if (!perm) return null

		return {
			...this.mapPermission(perm),
			category: perm.category ? this.mapPermissionCategory(perm.category) : null,
		}
	}

	async updatePermission(
		id: string,
		data: UpdatePermissionRequest,
		adminUserId: string
	): Promise<Permission> {
		// Admin-only operation

		const updates: Partial<typeof permissions.$inferInsert> = {}

		if (data.urn !== undefined) updates.urn = data.urn
		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId

		updates.updatedAt = new Date()

		const [updated] = await this.db
			.update(permissions)
			.set(updates)
			.where(eq(permissions.id, id))
			.returning()

		if (!updated) {
			throw new Error('Permission not found')
		}

		// Invalidate all permissions caches since this global permission may affect many users
		this.invalidateAllPermissionsCache()

		return this.mapPermission(updated)
	}

	async deletePermission(id: string, adminUserId: string): Promise<void> {
		// Admin-only operation
		// CASCADE will delete all group_permissions that reference this
		await this.db.delete(permissions).where(eq(permissions.id, id))

		// Invalidate all permissions caches
		this.invalidateAllPermissionsCache()
	}

	/**
	 * ============================================
	 * GROUP PERMISSION OPERATIONS
	 * ============================================
	 */

	async attachPermissionToGroup(
		data: AttachPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails> {
		// Admin-only operation

		// Verify the permission exists
		const permission = await this.db.query.permissions.findFirst({
			where: eq(permissions.id, data.permissionId),
			with: {
				category: true,
			},
		})

		if (!permission) {
			throw new Error('Permission not found')
		}

		// Verify the group exists
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Check for duplicate
		const existing = await this.db.query.groupPermissions.findFirst({
			where: and(
				eq(groupPermissions.groupId, data.groupId),
				eq(groupPermissions.permissionId, data.permissionId)
			),
		})

		if (existing) {
			throw new Error('Permission already attached to this group')
		}

		const [groupPerm] = await this.db
			.insert(groupPermissions)
			.values({
				groupId: data.groupId,
				permissionId: data.permissionId,
				targetType: data.targetType,
				createdBy: adminUserId,
			})
			.returning()

		// Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(data.groupId)

		return {
			...this.mapGroupPermission(groupPerm),
			permission: {
				...this.mapPermission(permission),
				category: permission.category ? this.mapPermissionCategory(permission.category) : null,
			},
			group: {
				id: group.id,
				name: group.name,
			},
		}
	}

	async createGroupScopedPermission(
		data: CreateGroupScopedPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails> {
		// Admin-only operation

		// Verify the group exists
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Check for duplicate custom URN in this group
		const existing = await this.db.query.groupPermissions.findFirst({
			where: and(
				eq(groupPermissions.groupId, data.groupId),
				eq(groupPermissions.customUrn, data.urn)
			),
		})

		if (existing) {
			throw new Error('Permission with this URN already exists in this group')
		}

		const [groupPerm] = await this.db
			.insert(groupPermissions)
			.values({
				groupId: data.groupId,
				permissionId: null,
				customUrn: data.urn,
				customName: data.name,
				customDescription: data.description || null,
				targetType: data.targetType,
				createdBy: adminUserId,
			})
			.returning()

		// Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(data.groupId)

		return {
			...this.mapGroupPermission(groupPerm),
			permission: null,
			group: {
				id: group.id,
				name: group.name,
			},
		}
	}

	async listGroupPermissions(
		groupId: string,
		adminUserId: string
	): Promise<GroupPermissionWithDetails[]> {
		// Admin-only operation

		const groupPerms = await this.db.query.groupPermissions.findMany({
			where: eq(groupPermissions.groupId, groupId),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
				group: true,
			},
			orderBy: (groupPermissions, { desc }) => [desc(groupPermissions.createdAt)],
		})

		return groupPerms.map((gp) => ({
			...this.mapGroupPermission(gp),
			permission: gp.permission
				? {
						...this.mapPermission(gp.permission),
						category: gp.permission.category
							? this.mapPermissionCategory(gp.permission.category)
							: null,
					}
				: null,
			group: {
				id: gp.group.id,
				name: gp.group.name,
			},
		}))
	}

	async updateGroupPermission(
		groupPermissionId: string,
		data: UpdateGroupPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails> {
		// Admin-only operation

		const groupPerm = await this.db.query.groupPermissions.findFirst({
			where: eq(groupPermissions.id, groupPermissionId),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
				group: true,
			},
		})

		if (!groupPerm) {
			throw new Error('Group permission not found')
		}

		const updates: Partial<typeof groupPermissions.$inferInsert> = {}

		if (data.targetType !== undefined) updates.targetType = data.targetType

		// Only allow updating custom fields for group-scoped permissions
		if (!groupPerm.permissionId) {
			if (data.customUrn !== undefined) updates.customUrn = data.customUrn
			if (data.customName !== undefined) updates.customName = data.customName
			if (data.customDescription !== undefined) updates.customDescription = data.customDescription
		}

		const [updated] = await this.db
			.update(groupPermissions)
			.set(updates)
			.where(eq(groupPermissions.id, groupPermissionId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update group permission')
		}

		// Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(groupPerm.groupId)

		return {
			...this.mapGroupPermission(updated),
			permission: groupPerm.permission
				? {
						...this.mapPermission(groupPerm.permission),
						category: groupPerm.permission.category
							? this.mapPermissionCategory(groupPerm.permission.category)
							: null,
					}
				: null,
			group: {
				id: groupPerm.group.id,
				name: groupPerm.group.name,
			},
		}
	}

	async removePermissionFromGroup(groupPermissionId: string, adminUserId: string): Promise<void> {
		// Admin-only operation

		const groupPerm = await this.db.query.groupPermissions.findFirst({
			where: eq(groupPermissions.id, groupPermissionId),
		})

		if (!groupPerm) {
			throw new Error('Group permission not found')
		}

		await this.db.delete(groupPermissions).where(eq(groupPermissions.id, groupPermissionId))

		// Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(groupPerm.groupId)
	}

	/**
	 * ============================================
	 * PERMISSION QUERY OPERATIONS
	 * ============================================
	 */

	async getUserPermissions(userId: string): Promise<UserPermission[]> {
		// Check cache first
		const cached = this.permissionsCache.get(userId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Get all groups the user is a member of
		const memberships = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.userId, userId),
			with: {
				group: true,
			},
		})

		if (memberships.length === 0) {
			return []
		}

		const groupIds = memberships.map((m) => m.groupId)

		// Get user's admin roles
		const adminRoles = await this.db.query.groupAdmins.findMany({
			where: and(inArray(groupAdmins.groupId, groupIds), eq(groupAdmins.userId, userId)),
		})
		const adminGroupIds = new Set(adminRoles.map((a) => a.groupId))

		// Get all group permissions for these groups
		const groupPerms = await this.db.query.groupPermissions.findMany({
			where: inArray(groupPermissions.groupId, groupIds),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
				group: true,
			},
		})

		// Resolve permissions based on user's role in each group
		const resolvedPermissions: UserPermission[] = []

		for (const gp of groupPerms) {
			const isOwner = gp.group.ownerId === userId
			const isAdmin = adminGroupIds.has(gp.groupId)

			// Determine if user gets this permission based on target type
			let hasPermission = false
			if (gp.targetType === 'all_members') {
				hasPermission = true
			} else if (gp.targetType === 'all_admins') {
				hasPermission = isAdmin
			} else if (gp.targetType === 'owner_only') {
				hasPermission = isOwner
			} else if (gp.targetType === 'owner_and_admins') {
				hasPermission = isOwner || isAdmin
			}

			if (!hasPermission) continue

			// Determine URN and name based on whether this is global or group-scoped
			const urn = gp.permissionId ? gp.permission!.urn : gp.customUrn!
			const name = gp.permissionId ? gp.permission!.name : gp.customName!
			const description = gp.permissionId ? gp.permission!.description : gp.customDescription
			const category = gp.permissionId && gp.permission!.category ? gp.permission!.category : null

			resolvedPermissions.push({
				urn,
				name,
				description,
				category: category ? this.mapPermissionCategory(category) : null,
				groupId: gp.groupId,
				groupName: gp.group.name,
				targetType: gp.targetType,
				source: gp.permissionId ? 'global' : 'group_scoped',
			})
		}

		// Deduplicate by URN (in case user has same permission from multiple groups)
		const deduped = Array.from(new Map(resolvedPermissions.map((p) => [p.urn, p])).values())

		// Cache the result
		this.permissionsCache.set(userId, {
			data: deduped,
			expires: Date.now() + this.CACHE_TTL,
		})

		return deduped
	}

	async getGroupMemberPermissions(groupId: string): Promise<GetGroupMemberPermissionsResponse> {
		// Get all members of the group
		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
		})

		const userIds = members.map((m) => m.userId)

		if (userIds.length === 0) {
			return { userPermissions: {} }
		}

		// Get permissions for each user
		const userPermissionsMap: Record<string, UserPermission[]> = {}

		await Promise.all(
			userIds.map(async (userId) => {
				const perms = await this.getUserPermissions(userId)
				// Filter to only permissions from this group
				userPermissionsMap[userId] = perms.filter((p) => p.groupId === groupId)
			})
		)

		return { userPermissions: userPermissionsMap }
	}

	async getMultiGroupMemberPermissions(
		groupIds: string[]
	): Promise<GetMultiGroupMemberPermissionsResponse> {
		// Get all members across all groups
		const allMembers = await this.db.query.groupMembers.findMany({
			where: inArray(groupMembers.groupId, groupIds),
		})

		// Get unique user IDs
		const uniqueUserIds = Array.from(new Set(allMembers.map((m) => m.userId)))

		if (uniqueUserIds.length === 0) {
			return { userPermissions: {} }
		}

		// Get permissions for each user
		const userPermissionsMap: Record<string, UserPermission[]> = {}

		await Promise.all(
			uniqueUserIds.map(async (userId) => {
				const perms = await this.getUserPermissions(userId)
				// Filter to only permissions from the specified groups
				userPermissionsMap[userId] = perms.filter((p) => groupIds.includes(p.groupId))
			})
		)

		return { userPermissions: userPermissionsMap }
	}

	/**
	 * ============================================
	 * HELPER METHODS
	 * ============================================
	 */

	/**
	 * Invalidate the categories cache in Workers KV
	 */
	private async invalidateCategoriesCache(): Promise<void> {
		const cacheKey = 'categories:all:v1'
		await this.env.GROUPS_KV?.delete(cacheKey)
	}

	/**
	 * Invalidate the groups with Discord auto-invite cache in DO storage
	 */
	private async invalidateGroupsWithDiscordCache(): Promise<void> {
		const cacheKey = 'groups-with-discord-auto-invite'
		await this.state.storage.delete(cacheKey)
	}

	/**
	 * Invalidate the group members cache for a specific group
	 */
	private invalidateGroupMembersCache(groupId: string): void {
		this.groupMembersCache.delete(groupId)
	}

	/**
	 * Invalidate permissions cache for a specific user
	 */
	private invalidateUserPermissionsCache(userId: string): void {
		this.permissionsCache.delete(userId)
	}

	/**
	 * Invalidate permissions cache for all members of a group
	 */
	private async invalidateGroupMemberPermissionsCache(groupId: string): Promise<void> {
		// Get all members of the group
		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
		})

		// Invalidate cache for each member
		for (const member of members) {
			this.invalidateUserPermissionsCache(member.userId)
		}
	}

	/**
	 * Invalidate all permissions caches (for global permission changes)
	 */
	private invalidateAllPermissionsCache(): void {
		this.permissionsCache.clear()
	}

	private async isUserMember(groupId: string, userId: string): Promise<boolean> {
		const membership = await this.db.query.groupMembers.findFirst({
			where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
		})
		return !!membership
	}

	private async isUserGroupAdmin(groupId: string, userId: string): Promise<boolean> {
		const admin = await this.db.query.groupAdmins.findFirst({
			where: and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, userId)),
		})
		return !!admin
	}

	private async getGroupMemberCount(groupId: string): Promise<number> {
		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
		})
		return members.length
	}

	/**
	 * Cancel all pending join requests for a user in a specific group.
	 * This should be called whenever a user joins a group through any method
	 * (direct join, invitation acceptance, or request approval) to prevent
	 * showing stale join requests to group admins.
	 */
	private async cancelPendingJoinRequests(groupId: string, userId: string): Promise<void> {
		await this.db
			.update(groupJoinRequests)
			.set({
				status: 'cancelled',
				respondedAt: new Date(),
				respondedBy: null,
			})
			.where(
				and(
					eq(groupJoinRequests.groupId, groupId),
					eq(groupJoinRequests.userId, userId),
					eq(groupJoinRequests.status, 'pending')
				)
			)
	}

	/**
	 * ============================================
	 * MAPPING FUNCTIONS
	 * ============================================
	 */

	private mapCategory(cat: typeof categories.$inferSelect): Category {
		return {
			id: cat.id,
			name: cat.name,
			description: cat.description,
			visibility: cat.visibility,
			allowGroupCreation: cat.allowGroupCreation,
			createdAt: cat.createdAt,
			updatedAt: cat.updatedAt,
		}
	}

	private mapGroup(group: typeof groups.$inferSelect): Group {
		return {
			id: group.id,
			categoryId: group.categoryId,
			name: group.name,
			description: group.description,
			visibility: group.visibility,
			joinMode: group.joinMode,
			ownerId: group.ownerId,
			createdAt: group.createdAt,
			updatedAt: group.updatedAt,
		}
	}

	private mapGroupMember(member: typeof groupMembers.$inferSelect): GroupMember {
		return {
			id: member.id,
			groupId: member.groupId,
			userId: member.userId,
			joinedAt: member.joinedAt,
		}
	}

	private mapGroupAdmin(admin: typeof groupAdmins.$inferSelect): GroupAdmin {
		return {
			id: admin.id,
			groupId: admin.groupId,
			userId: admin.userId,
			designatedAt: admin.designatedAt,
		}
	}

	private mapGroupInvitation(inv: typeof groupInvitations.$inferSelect): GroupInvitation {
		return {
			id: inv.id,
			groupId: inv.groupId,
			inviterId: inv.inviterId,
			inviteeMainCharacterId: inv.inviteeMainCharacterId,
			inviteeUserId: inv.inviteeUserId,
			status: inv.status,
			expiresAt: inv.expiresAt,
			createdAt: inv.createdAt,
			respondedAt: inv.respondedAt,
		}
	}

	private mapGroupInviteCode(code: typeof groupInviteCodes.$inferSelect): GroupInviteCode {
		return {
			id: code.id,
			groupId: code.groupId,
			code: code.code,
			createdBy: code.createdBy,
			maxUses: code.maxUses,
			currentUses: code.currentUses,
			expiresAt: code.expiresAt,
			createdAt: code.createdAt,
			revokedAt: code.revokedAt,
		}
	}

	private mapGroupJoinRequest(req: typeof groupJoinRequests.$inferSelect): GroupJoinRequest {
		return {
			id: req.id,
			groupId: req.groupId,
			userId: req.userId,
			reason: req.reason,
			status: req.status,
			createdAt: req.createdAt,
			respondedAt: req.respondedAt,
			respondedBy: req.respondedBy,
		}
	}

	private mapPermissionCategory(cat: typeof permissionCategories.$inferSelect): PermissionCategory {
		return {
			id: cat.id,
			name: cat.name,
			description: cat.description,
			createdAt: cat.createdAt,
			updatedAt: cat.updatedAt,
		}
	}

	private mapPermission(perm: typeof permissions.$inferSelect): Permission {
		return {
			id: perm.id,
			urn: perm.urn,
			name: perm.name,
			description: perm.description,
			categoryId: perm.categoryId,
			createdBy: perm.createdBy,
			createdAt: perm.createdAt,
			updatedAt: perm.updatedAt,
		}
	}

	private mapGroupPermission(gp: typeof groupPermissions.$inferSelect) {
		return {
			id: gp.id,
			groupId: gp.groupId,
			permissionId: gp.permissionId,
			customUrn: gp.customUrn,
			customName: gp.customName,
			customDescription: gp.customDescription,
			targetType: gp.targetType as PermissionTarget,
			createdBy: gp.createdBy,
			createdAt: gp.createdAt,
		}
	}
}
