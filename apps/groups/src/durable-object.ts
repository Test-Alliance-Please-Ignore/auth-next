import { DurableObject } from 'cloudflare:workers'

import { and, createDbClient, eq, ilike, inArray, isNull, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

// Import Core database schema for Discord server and role lookups
import { discordRoles, discordServers } from '../../core/src/db/schema'
import * as coreSchema from '../../core/src/db/schema'
import { createDb } from './db'
import {
	categories,
	corporationPermissions,
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
import { assertValidBroadcastPermissionUrn } from './services/broadcast-urn'
import { CategoryService } from './services/category-service' // Added
import {
	bulkFindMainCharactersByUserIds,
	bulkFindMainCharactersWithIdsByUserIds,
	findUserByMainCharacterName,
} from './services/character-lookup'
import { generateInviteCode } from './services/code-generator'
import { GroupsDOCache } from './services/groups-do-cache' // Added
import {
	mapCategory,
	mapGroup,
	mapGroupInvitation,
	mapGroupInviteCode,
	mapGroupJoinRequest,
	mapGroupMember,
} from './services/mappers'
// Added
import {
	canCreateGroupInCategory,
	canManageGroup,
	canModerateGroup,
	canViewCategory,
	canViewGroup,
	canViewGroupMembers,
	isGroupOwner,
} from './services/permissions'
import { RoleService } from './services/role-service'

import type { Core } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type {
	AttachPermissionRequest,
	AttachPermissionToCorporationRequest,
	AttachRoleToRequest,
	BatchAttachRoleToRequest,
	BatchCreateRolesRequest,
	BatchGetRolesForRequest,
	Category,
	CategoryWithGroups,
	CorporationPermissionWithDetails,
	CreateCategoryRequest,
	CreateGroupRequest,
	CreateGroupScopedPermissionRequest,
	CreateInvitationRequest,
	CreateInviteCodeRequest,
	CreateInviteCodeResponse,
	CreateJoinRequestRequest,
	CreatePermissionCategoryRequest,
	CreatePermissionRequest,
	CreateRoleRequest,
	DetachRoleFromRequest,
	GetGroupMemberPermissionsResponse,
	GetMultiGroupMemberPermissionsResponse,
	GetRolesForRequest,
	Group,
	GroupAdmin,
	GroupByInviteCodeResponse,
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
	ReplaceCoreMembershipRolesForUserRequest,
	ReplaceCoreMembershipRolesForUserResponse,
	Role,
	RoleAttachment,
	UpdateCategoryRequest,
	UpdateGroupPermissionRequest,
	UpdateGroupRequest,
	UpdatePermissionCategoryRequest,
	UpdatePermissionRequest,
	UserPermission,
} from '@repo/groups'
import type { Env } from './context'
import type { ServiceContext } from './services/context' // Added

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
	private roleService: RoleService
	private categoryService: CategoryService // Added
	private groupsDOCache: GroupsDOCache // Added

	// In-memory caches with TTL and size limits
	private discordServersCache = new Map<string, { data: any[]; expires: number }>()
	private groupMembersCache = new Map<string, { data: string[]; expires: number }>()
	private permissionsCache = new Map<string, { data: UserPermission[]; expires: number }>()
	private corporationPermissionsCache = new Map<
		string,
		{ data: UserPermission[]; expires: number }
	>()
	private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
	private readonly MAX_CACHE_ENTRIES = 1000

	/**
	 * Set a cache entry with LRU eviction when the cache is full.
	 * Removes the oldest entry (first inserted) when limit is reached.
	 */
	private setCacheEntry<T>(
		cache: Map<string, { data: T; expires: number }>,
		key: string,
		data: T
	): void {
		// Evict oldest entry if cache is at capacity
		if (cache.size >= this.MAX_CACHE_ENTRIES && !cache.has(key)) {
			const oldestKey = cache.keys().next().value
			if (oldestKey !== undefined) {
				cache.delete(oldestKey)
			}
		}
		cache.set(key, { data, expires: Date.now() + this.CACHE_TTL })
	}

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.coreDb = createDbClient(env.DATABASE_URL, coreSchema)
		this.groupsDOCache = new GroupsDOCache(
			this.state,
			this.env.GROUPS_KV,
			this.discordServersCache,
			this.groupMembersCache,
			this.permissionsCache,
			this.corporationPermissionsCache
		)
		const serviceContext: ServiceContext = {
			db: this.db,
			coreDb: this.coreDb,
			env: this.env,
			state: this.state,
			groupsDOCache: this.groupsDOCache,
		}
		this.roleService = new RoleService(serviceContext)
		this.categoryService = new CategoryService(serviceContext)
	}

	/**
	 * ============================================
	 * CATEGORY OPERATIONS
	 * ============================================
	 */

	async createCategory(data: CreateCategoryRequest, actorId: string): Promise<Category> {
		return this.categoryService.createCategory(data, actorId)
	}

	async listCategories(actorId: string): Promise<Category[]> {
		const isSiteAdmin = await this.isUserSiteAdmin(actorId)
		return this.categoryService.listCategories(actorId, isSiteAdmin)
	}

	async getCategory(id: string, actorId: string): Promise<CategoryWithGroups | null> {
		const isSiteAdmin = await this.isUserSiteAdmin(actorId)
		return this.categoryService.getCategory(id, actorId, isSiteAdmin)
	}

	async updateCategory(
		id: string,
		data: UpdateCategoryRequest,
		actorId: string
	): Promise<Category> {
		return this.categoryService.updateCategory(id, data, actorId)
	}

	async deleteCategory(id: string, actorId: string): Promise<void> {
		return this.categoryService.deleteCategory(id, actorId)
	}

	/**
	 * ============================================
	 * GROUP OPERATIONS
	 * ============================================
	 */

	async createGroup(data: CreateGroupRequest, actorId: string): Promise<Group> {
		// Validate category exists and user can create groups in it
		const [category, isSiteAdmin] = await Promise.all([
			this.db.query.categories.findFirst({
				where: eq(categories.id, data.categoryId),
			}),
			this.isUserSiteAdmin(actorId),
		])

		if (!category) {
			throw new Error('Category not found')
		}

		if (!canCreateGroupInCategory(category, actorId, isSiteAdmin)) {
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
				ownerId: actorId,
			})
			.returning()

		// Automatically add the owner as a member
		await this.db.insert(groupMembers).values({
			groupId: group.id,
			userId: actorId,
		})

		return this.mapGroup(group)
	}

	async listGroups(filters: ListGroupsFilters, actorId: string): Promise<GroupWithDetails[]> {
		const limit = filters.limit ?? 100
		const offset = filters.offset ?? 0

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

		const searchQuery = filters.search?.trim()
		if (searchQuery) {
			conditions.push(ilike(groups.name, `%${searchQuery}%`))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		// Get groups with category
		const allGroups = await this.db.query.groups.findMany({
			where: whereClause,
			with: {
				category: true,
			},
			orderBy: (groups, { asc }) => [asc(groups.name)],
			limit: filters.myGroups ? undefined : limit,
			offset: filters.myGroups ? undefined : offset,
		})

		// Filter by user memberships if requested
		let groupsToCheck = allGroups

		if (filters.myGroups) {
			const userMemberships = await this.db.query.groupMembers.findMany({
				where: eq(groupMembers.userId, actorId),
			})
			const memberGroupIds = new Set(userMemberships.map((m) => m.groupId))
			groupsToCheck = allGroups.filter((g) => memberGroupIds.has(g.id))
			groupsToCheck = groupsToCheck.slice(offset, offset + limit)
		}

		// Resolve site admin status once for filtering
		const isSiteAdmin = await this.isUserSiteAdmin(actorId)

		// Early return if no groups to check
		if (groupsToCheck.length === 0) {
			return []
		}

		// === BATCH ALL QUERIES TO ELIMINATE N+1 PROBLEM ===
		const groupIds = groupsToCheck.map((g) => g.id)

		// Batch query 1: Get all memberships for this user across all groups
		const userMemberships = await this.db.query.groupMembers.findMany({
			where: and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, actorId)),
		})
		const memberGroupIds = new Set(userMemberships.map((m) => m.groupId))

		// Batch query 2: Get all admin designations for this user
		const userAdminRoles = await this.db.query.groupAdmins.findMany({
			where: and(inArray(groupAdmins.groupId, groupIds), eq(groupAdmins.userId, actorId)),
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

			if (canViewGroup(group, actorId, isSiteAdmin, isMember)) {
				const isOwner = group.ownerId === actorId
				const isAdminOfGroup = adminGroupIds.has(group.id)
				const memberCount = memberCountMap.get(group.id) || 0

				result.push({
					...this.mapGroup(group),
					category: mapCategory(group.category),
					memberCount,
					isOwner,
					isAdmin: isAdminOfGroup,
					isMember,
				})
			}
		}

		return result
	}

	async getGroup(id: string, actorId: string): Promise<GroupWithDetails | null> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
			with: {
				category: true,
			},
		})

		if (!group) return null

		const [isMember, isSiteAdmin] = await Promise.all([
			this.isUserMember(id, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canViewGroup(group, actorId, isSiteAdmin, isMember)) {
			return null
		}

		const isOwner = group.ownerId === actorId

		// Parallelize independent queries for better performance
		const [isAdminOfGroup, memberCount, admins, characterNames, pendingRequest] = await Promise.all(
			[
				this.isUserGroupAdmin(id, actorId),
				this.getGroupMemberCount(id),
				this.db.query.groupAdmins.findMany({
					where: eq(groupAdmins.groupId, id),
				}),
				bulkFindMainCharactersByUserIds([group.ownerId], this.db),
				this.db.query.groupJoinRequests.findFirst({
					where: and(
						eq(groupJoinRequests.groupId, id),
						eq(groupJoinRequests.userId, actorId),
						eq(groupJoinRequests.status, 'pending')
					),
				}),
			]
		)

		const adminUserIds = admins.map((admin) => admin.userId)
		const ownerName = characterNames.get(group.ownerId)

		return {
			...this.mapGroup(group),
			category: mapCategory(group.category),
			memberCount,
			isOwner,
			isAdmin: isAdminOfGroup,
			isMember,
			hasPendingJoinRequest: !!pendingRequest,
			adminUserIds,
			ownerName,
		}
	}

	async getGroupMetadataByIds(ids: string[]): Promise<Array<{ id: string; name: string }>> {
		const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
		if (normalizedIds.length === 0) {
			return []
		}

		const rows = await this.db.query.groups.findMany({
			where: inArray(groups.id, normalizedIds),
			columns: {
				id: true,
				name: true,
			},
		})

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
		}))
	}

	async updateGroup(id: string, data: UpdateGroupRequest, actorId: string): Promise<Group> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isSiteAdmin = await this.isUserSiteAdmin(actorId)
		if (!canManageGroup(group, actorId, isSiteAdmin)) {
			throw new Error('Only the group owner or site admins can update the group')
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

	async deleteGroup(id: string, actorId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isSiteAdmin = await this.isUserSiteAdmin(actorId)
		if (!canManageGroup(group, actorId, isSiteAdmin)) {
			throw new Error('Only the group owner or site admins can delete the group')
		}

		// CASCADE will delete all members, admins, invitations, etc.
		await this.db.delete(groups).where(eq(groups.id, id))
	}

	async transferOwnership(groupId: string, actorId: string, newOwnerId: string): Promise<void> {
		const [group, isSiteAdmin] = await Promise.all([
			this.db.query.groups.findFirst({
				where: eq(groups.id, groupId),
			}),
			this.isUserSiteAdmin(actorId),
		])

		if (!group) {
			throw new Error('Group not found')
		}

		// Allow transfer if: requesting user is current owner OR requesting user is app admin
		const isCurrentOwner = group.ownerId === actorId
		if (!isCurrentOwner && !isSiteAdmin) {
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

	async joinGroup(groupId: string, actorId: string): Promise<void> {
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
		const isMember = await this.isUserMember(groupId, actorId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId,
			userId: actorId,
		})

		// Cancel any pending join requests from this user for this group
		await this.cancelPendingJoinRequests(groupId, actorId)
		// Cancel any pending invitations for this user to this group
		await this.cancelPendingInvitations(groupId, actorId)

		// Invalidate group members cache
		this.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they now have new permissions from this group)
		this.invalidateUserPermissionsCache(actorId)
	}

	async leaveGroup(groupId: string, actorId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Owner cannot leave (must transfer ownership first)
		if (group.ownerId === actorId) {
			throw new Error('Group owner cannot leave. Transfer ownership first.')
		}

		// Verify user is actually a member before attempting to remove
		const isMember = await this.isUserMember(groupId, actorId)
		if (!isMember) {
			throw new Error('You are not a member of this group')
		}

		// Remove from admins if they are one
		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, actorId)))

		// Remove from members
		await this.db
			.delete(groupMembers)
			.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, actorId)))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they lost permissions from this group)
		this.invalidateUserPermissionsCache(actorId)
	}

	async removeMember(groupId: string, actorId: string, targetUserId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
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

	async getGroupMembers(groupId: string, actorId: string): Promise<GroupMember[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isMember, isSiteAdmin] = await Promise.all([
			this.isUserMember(groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])
		const isGroupOwnerOrAdmin =
			group.ownerId === actorId || (await this.isUserGroupAdmin(groupId, actorId))

		if (!canViewGroupMembers(group, actorId, isSiteAdmin, isMember, isGroupOwnerOrAdmin)) {
			throw new Error('Not authorized to view group members')
		}

		const members = await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
			orderBy: (groupMembers, { asc }) => [asc(groupMembers.joinedAt)],
		})

		// Fetch main character names and IDs for all members
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

		if (memberships.length === 0) {
			return []
		}

		// Batch fetch all admin records for this user across all their groups
		const groupIds = memberships.map((m) => m.groupId)
		const adminRecords = await this.db.query.groupAdmins.findMany({
			where: and(eq(groupAdmins.userId, userId), inArray(groupAdmins.groupId, groupIds)),
		})
		const adminGroupIds = new Set(adminRecords.map((a) => a.groupId))

		return memberships.map((membership) => ({
			groupId: membership.groupId,
			groupName: membership.group.name,
			categoryName: membership.group.category.name,
			isOwner: membership.group.ownerId === userId,
			isAdmin: adminGroupIds.has(membership.groupId),
			joinedAt: membership.joinedAt,
		}))
	}

	/**
	 * ============================================
	 * ADMIN OPERATIONS
	 * ============================================
	 */

	async addAdmin(
		groupId: string,
		actorId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, actorId, isGlobalAdmin)) {
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
		actorId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, actorId, isGlobalAdmin)) {
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
		actorId: string
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
		const isMember = await this.isUserMember(data.groupId, actorId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Check for existing pending request
		const existingRequest = await this.db.query.groupJoinRequests.findFirst({
			where: and(
				eq(groupJoinRequests.groupId, data.groupId),
				eq(groupJoinRequests.userId, actorId),
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
				userId: actorId,
				reason: data.reason || null,
				status: 'pending',
			})
			.returning()

		return this.mapGroupJoinRequest(request)
	}

	async listJoinRequests(groupId: string, actorId: string): Promise<GroupJoinRequestWithDetails[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
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
		const userIds = requests.map((req) => req.userId)
		const characterNames = await bulkFindMainCharactersByUserIds(userIds, this.db)

		// Enrich requests with user character names
		return requests.map((req) => ({
			...this.mapGroupJoinRequest(req),
			userMainCharacterName: characterNames.get(req.userId) || undefined,
		}))
	}

	async approveJoinRequest(requestId: string, actorId: string): Promise<{ userId: string }> {
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

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(request.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner or admins can approve join requests')
		}

		if (request.status !== 'pending') {
			throw new Error('Join request is not pending')
		}

		// Check if already a member
		const isMember = await this.isUserMember(request.groupId, request.userId)
		if (isMember) {
			throw new Error('Already a member of this group')
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
				respondedBy: actorId,
			})
			.where(eq(groupJoinRequests.id, requestId))

		// Cancel any OTHER pending join requests from this user for this group
		// (The approved one has already been updated above)
		await this.cancelPendingJoinRequests(request.groupId, request.userId)
		// Cancel any pending invitations for this user to this group
		await this.cancelPendingInvitations(request.groupId, request.userId)

		// Invalidate group members cache
		this.invalidateGroupMembersCache(request.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.invalidateUserPermissionsCache(request.userId)

		return { userId: request.userId }
	}

	async rejectJoinRequest(requestId: string, actorId: string): Promise<void> {
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

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(request.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
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
				respondedBy: actorId,
			})
			.where(eq(groupJoinRequests.id, requestId))
	}

	/**
	 * ============================================
	 * INVITATION OPERATIONS
	 * ============================================
	 */

	async createInvitation(data: CreateInvitationRequest, actorId: string): Promise<GroupInvitation> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(data.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner or admins can invite users')
		}

		// Look up user by their main character name
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

		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + 7) // 7 days from now

		if (existingInvitation) {
			if (existingInvitation.expiresAt > new Date()) {
				throw new Error(`User '${data.characterName}' already has a pending invitation`)
			}

			// Invitation exists but has expired — refresh it rather than creating a duplicate
			const [updated] = await this.db
				.update(groupInvitations)
				.set({
					inviterId: actorId,
					inviteeMainCharacterId: userLookup.characterId,
					expiresAt,
					respondedAt: null,
				})
				.where(eq(groupInvitations.id, existingInvitation.id))
				.returning()

			return this.mapGroupInvitation(updated)
		}

		const [invitation] = await this.db
			.insert(groupInvitations)
			.values({
				groupId: data.groupId,
				inviterId: actorId,
				inviteeMainCharacterId: userLookup.characterId,
				inviteeUserId: userLookup.userId,
				status: 'pending',
				expiresAt,
			})
			.returning()

		return this.mapGroupInvitation(invitation)
	}

	async listPendingInvitations(actorId: string): Promise<GroupInvitationWithDetails[]> {
		const invitations = await this.db.query.groupInvitations.findMany({
			where: and(
				eq(groupInvitations.inviteeUserId, actorId),
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

	async acceptInvitation(invitationId: string, actorId: string): Promise<void> {
		const invitation = await this.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== actorId) {
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
		const isMember = await this.isUserMember(invitation.groupId, actorId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId: invitation.groupId,
			userId: actorId,
		})

		// Cancel any pending join requests from this user for this group
		await this.cancelPendingJoinRequests(invitation.groupId, actorId)

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
		this.invalidateUserPermissionsCache(actorId)
	}

	async declineInvitation(invitationId: string, actorId: string): Promise<void> {
		const invitation = await this.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== actorId) {
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

	async cancelInvitation(invitationId: string, actorId: string): Promise<void> {
		const invitation = await this.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
			with: { group: true },
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.status !== 'pending') {
			throw new Error(`Invitation cannot be cancelled (status: ${invitation.status})`)
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(invitation.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])
		if (!canModerateGroup(invitation.group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner or admins can cancel invitations')
		}

		await this.db
			.update(groupInvitations)
			.set({
				status: 'cancelled',
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))
	}

	async getGroupInvitations(
		groupId: string,
		actorId: string
	): Promise<GroupInvitationWithDetails[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner, admins, or system admins can view invitations')
		}

		// Fetch pending invitations for this group, excluding those expired more than 30 days ago
		const thirtyDaysAgo = sql`now() - interval '30 days'`
		const invitations = await this.db.query.groupInvitations.findMany({
			where: and(
				eq(groupInvitations.groupId, groupId),
				eq(groupInvitations.status, 'pending'),
				sql`${groupInvitations.expiresAt} >= ${thirtyDaysAgo}`
			),
			orderBy: (groupInvitations, { desc }) => [desc(groupInvitations.createdAt)],
		})

		// Enrich with character names
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
		actorId: string
	): Promise<CreateInviteCodeResponse> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(data.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner or group admins can create invite codes')
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
				createdBy: actorId,
				maxUses: data.maxUses || null,
				currentUses: 0,
				expiresAt,
			})
			.returning()

		return {
			code: this.mapGroupInviteCode(inviteCode),
		}
	}

	async listInviteCodes(groupId: string, actorId: string): Promise<GroupInviteCode[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner, group admins, or global admins can view invite codes')
		}

		// Show active codes plus expired/revoked codes within the last 30 days
		const codes = await this.db.query.groupInviteCodes.findMany({
			where: and(
				eq(groupInviteCodes.groupId, groupId),
				sql`${groupInviteCodes.expiresAt} >= now() - interval '30 days'`
			),
			orderBy: (groupInviteCodes, { desc }) => [desc(groupInviteCodes.createdAt)],
		})

		return codes.map(this.mapGroupInviteCode)
	}

	async revokeInviteCode(codeId: string, actorId: string): Promise<void> {
		const inviteCode = await this.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.id, codeId),
			with: {
				group: true,
			},
		})

		if (!inviteCode) {
			throw new Error('Invite code not found')
		}

		const [isGroupAdmin, isSiteAdmin] = await Promise.all([
			this.isUserGroupAdmin(inviteCode.groupId, actorId),
			this.isUserSiteAdmin(actorId),
		])

		if (!canModerateGroup(inviteCode.group, actorId, isGroupAdmin, isSiteAdmin)) {
			throw new Error('Only group owner or group admins can revoke invite codes')
		}

		await this.db
			.update(groupInviteCodes)
			.set({ revokedAt: new Date() })
			.where(eq(groupInviteCodes.id, codeId))
	}

	async getGroupByInviteCode(code: string, userId?: string): Promise<GroupByInviteCodeResponse> {
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

		const groupDetails: GroupWithDetails = {
			...this.mapGroup(group),
			category: mapCategory(category),
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

	async redeemInviteCode(code: string, actorId: string): Promise<RedeemInviteCodeResponse> {
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
				eq(groupInviteCodeRedemptions.userId, actorId)
			),
		})

		if (existingRedemption) {
			throw new Error('You have already redeemed this invite code')
		}

		// Check if already a member
		const isMember = await this.isUserMember(inviteCode.groupId, actorId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.db.insert(groupMembers).values({
			groupId: inviteCode.groupId,
			userId: actorId,
		})

		// Track redemption
		await this.db.insert(groupInviteCodeRedemptions).values({
			inviteCodeId: inviteCode.id,
			userId: actorId,
		})

		// Increment usage count
		await this.db
			.update(groupInviteCodes)
			.set({ currentUses: inviteCode.currentUses + 1 })
			.where(eq(groupInviteCodes.id, inviteCode.id))

		// Invalidate group members cache
		this.invalidateGroupMembersCache(inviteCode.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.invalidateUserPermissionsCache(actorId)

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

		if (attachments.length === 0) {
			this.setCacheEntry(this.discordServersCache, groupId, [])
			return []
		}

		// Collect all unique Discord server IDs and role IDs for batch queries
		const serverIds = [...new Set(attachments.map((a) => a.discordServerId))]
		const roleIds = [
			...new Set(attachments.flatMap((a) => (a.roles || []).map((r) => r.discordRoleId))),
		]

		// Batch fetch all Discord servers and roles in parallel
		const [allServers, allRoles] = await Promise.all([
			this.coreDb.query.discordServers.findMany({
				where: inArray(discordServers.id, serverIds),
				with: { roles: true },
			}),
			roleIds.length > 0
				? this.coreDb.query.discordRoles.findMany({
						where: inArray(discordRoles.id, roleIds),
					})
				: [],
		])

		// Create lookup maps for O(1) access
		const serverMap = new Map(allServers.map((s) => [s.id, s]))
		const roleMap = new Map(allRoles.map((r) => [r.id, r]))

		// Map results using the lookup maps
		const results = attachments.map((attachment) => {
			const rolesWithDetails = (attachment.roles || []).map((roleAssignment) => {
				const roleDetails = roleMap.get(roleAssignment.discordRoleId)
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

			return {
				...attachment,
				discordServer: serverMap.get(attachment.discordServerId) || null,
				roles: rolesWithDetails,
			}
		})

		// Cache the result with LRU eviction
		this.setCacheEntry(this.discordServersCache, groupId, results)

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
	 * Get all groups with Discord servers attached (both auto-invite and manual join)
	 * Cached in DO storage with 5-minute refresh
	 * Note: Method name kept for backward compatibility, but now returns all Discord servers
	 */
	async getGroupsWithDiscordAutoInvite(): Promise<
		Array<{
			groupId: string
			groupName: string
			discordServers: Array<{
				id: string
				discordServerId: string
				roleIds?: string[]
				autoInvite?: boolean
				autoAssignRoles?: boolean
			}>
		}>
	> {
		// Try to get from DO storage cache
		const cacheKey = 'groups-with-discord-servers' // Updated cache key
		const cached = await this.state.storage.get<{
			data: any[]
			expires: number
		}>(cacheKey)

		if (cached && cached.expires > Date.now()) {
			return cached.data
		}

		// Cache miss - fetch ALL group Discord servers (not just auto-invite)
		// The autoInvite flag only controls automatic vs manual joining, not eligibility
		const servers = await this.db.query.groupDiscordServers.findMany({
			// No WHERE clause - get all Discord server attachments
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
					autoInvite?: boolean
					autoAssignRoles?: boolean
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
				autoInvite: server.autoInvite, // Include autoInvite flag
				autoAssignRoles: server.autoAssignRoles, // Include autoAssignRoles flag
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
	): Promise<Array<{ groupId: string; groupName: string; id: string; autoAssignRoles: boolean }>> {
		const servers = await this.db.query.groupDiscordServers.findMany({
			where: eq(groupDiscordServers.discordServerId, discordServerId),
			with: {
				group: true,
			},
		})

		return servers.map((server) => ({
			groupId: server.groupId,
			groupName: server.group.name,
			id: server.id,
			autoAssignRoles: server.autoAssignRoles,
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

		// Cache the result with LRU eviction
		this.setCacheEntry(this.groupMembersCache, groupId, userIds)

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
		actorId: string
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
		actorId: string
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

	async deletePermissionCategory(id: string, actorId: string): Promise<void> {
		// Admin-only operation
		// SET NULL will update permissions that reference this category
		await this.db.delete(permissionCategories).where(eq(permissionCategories.id, id))
	}

	/**
	 * ============================================
	 * GLOBAL PERMISSION OPERATIONS
	 * ============================================
	 */

	async createPermission(data: CreatePermissionRequest, actorId: string): Promise<Permission> {
		// Admin-only operation
		assertValidBroadcastPermissionUrn(data.urn)

		const [permission] = await this.db
			.insert(permissions)
			.values({
				urn: data.urn,
				name: data.name,
				description: data.description || null,
				categoryId: data.categoryId || null,
				createdBy: actorId,
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
		actorId: string
	): Promise<Permission> {
		// Admin-only operation
		if (data.urn !== undefined) {
			assertValidBroadcastPermissionUrn(data.urn)
		}

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

	async deletePermission(id: string, actorId: string): Promise<void> {
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
		actorId: string
	): Promise<GroupPermissionWithDetails> {
		// Admin-only operation

		// Verify the permission exists
		const perm = await this.db.query.permissions.findFirst({
			where: eq(permissions.id, data.permissionId),
			with: {
				category: true,
			},
		})

		if (!perm) {
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
			const creatorNames = await bulkFindMainCharactersByUserIds([existing.createdBy], this.db)
			return {
				...this.mapGroupPermission(existing),
				createdByName: creatorNames.get(existing.createdBy),
				permission: {
					...this.mapPermission(perm),
					category: perm.category ? this.mapPermissionCategory(perm.category) : null,
				},
				group: {
					id: group.id,
					name: group.name,
				},
			}
		}

		const [permission] = await this.db
			.insert(groupPermissions)
			.values({
				groupId: data.groupId,
				permissionId: data.permissionId,
				targetType: data.targetType,
				createdBy: actorId,
			})
			.returning() // Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(data.groupId)

		const creatorNames = await bulkFindMainCharactersByUserIds([actorId], this.db)

		return {
			...this.mapGroupPermission(permission),
			createdByName: creatorNames.get(actorId),
			permission: {
				...this.mapPermission(perm),
				category: perm.category ? this.mapPermissionCategory(perm.category) : null,
			},
			group: {
				id: group.id,
				name: group.name,
			},
		}
	}

	async createGroupScopedPermission(
		data: CreateGroupScopedPermissionRequest,
		actorId: string
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
				createdBy: actorId,
			})
			.returning()

		// Invalidate permissions cache for all members of this group
		this.invalidateGroupMemberPermissionsCache(data.groupId)

		const creatorNames = await bulkFindMainCharactersByUserIds([actorId], this.db)

		return {
			...this.mapGroupPermission(groupPerm),
			createdByName: creatorNames.get(actorId),
			permission: null,
			group: {
				id: group.id,
				name: group.name,
			},
		}
	}

	async listGroupPermissions(
		groupId: string,
		actorId: string
	): Promise<GroupPermissionWithDetails[]> {
		// Admin-only operation

		const groupPerms = await this.db.query.groupPermissions.findMany({
			where: eq(groupPermissions.groupId, groupId),
			orderBy: (groupPermissions, { desc }) => [desc(groupPermissions.createdAt)],
		})

		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})
		if (!group) {
			throw new Error('Group not found')
		}

		const permissionIds = [
			...new Set(
				groupPerms
					.map((gp) => gp.permissionId)
					.filter((id): id is string => typeof id === 'string' && id.length > 0)
			),
		]
		const permissionRows =
			permissionIds.length > 0
				? await this.db.query.permissions.findMany({
						where: inArray(permissions.id, permissionIds),
						with: {
							category: true,
						},
					})
				: []
		const permissionById = new Map(permissionRows.map((permission) => [permission.id, permission]))

		const creatorIds = [...new Set(groupPerms.map((gp) => gp.createdBy))]
		const creatorNames = await bulkFindMainCharactersByUserIds(creatorIds, this.db)

		return groupPerms.map((gp) => {
			const permissionRow = gp.permissionId ? permissionById.get(gp.permissionId) : undefined
			return {
				...this.mapGroupPermission(gp),
				createdByName: creatorNames.get(gp.createdBy),
				permission: permissionRow
					? {
							...this.mapPermission(permissionRow),
							category: permissionRow.category
								? this.mapPermissionCategory(permissionRow.category)
								: null,
						}
					: null,
				group: {
					id: group.id,
					name: group.name,
				},
			}
		})
	}

	async updateGroupPermission(
		groupPermissionId: string,
		data: UpdateGroupPermissionRequest,
		actorId: string
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

		const creatorNames = await bulkFindMainCharactersByUserIds([updated.createdBy], this.db)

		return {
			...this.mapGroupPermission(updated),
			createdByName: creatorNames.get(updated.createdBy),
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

	async removePermissionFromGroup(groupPermissionId: string, actorId: string): Promise<void> {
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
	 * CORPORATION PERMISSION OPERATIONS
	 * ============================================
	 */

	async attachPermissionToCorporation(
		data: AttachPermissionToCorporationRequest,
		actorId: string
	): Promise<CorporationPermissionWithDetails> {
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

		// Check for duplicate
		const existing = await this.db.query.corporationPermissions.findFirst({
			where: and(
				eq(corporationPermissions.corporationId, data.corporationId),
				eq(corporationPermissions.permissionId, data.permissionId)
			),
		})

		if (existing) {
			throw new Error('Permission already attached to this corporation')
		}

		const [corpPerm] = await this.db
			.insert(corporationPermissions)
			.values({
				corporationId: data.corporationId,
				permissionId: data.permissionId,
				createdBy: actorId,
			})
			.returning()

		// Invalidate cache for this corporation
		this.invalidateCorporationPermissionsCache(data.corporationId)

		return {
			id: corpPerm.id,
			corporationId: corpPerm.corporationId,
			permissionId: corpPerm.permissionId,
			createdBy: corpPerm.createdBy,
			createdAt: corpPerm.createdAt,
			permission: {
				...this.mapPermission(permission),
				category: permission.category ? this.mapPermissionCategory(permission.category) : null,
			},
		}
	}

	async listCorporationPermissions(
		corporationId: string
	): Promise<CorporationPermissionWithDetails[]> {
		const corpPerms = await this.db.query.corporationPermissions.findMany({
			where: eq(corporationPermissions.corporationId, corporationId),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
			},
			orderBy: (corporationPermissions, { desc }) => [desc(corporationPermissions.createdAt)],
		})

		return corpPerms.map((cp) => ({
			id: cp.id,
			corporationId: cp.corporationId,
			permissionId: cp.permissionId,
			createdBy: cp.createdBy,
			createdAt: cp.createdAt,
			permission: {
				...this.mapPermission(cp.permission),
				category: cp.permission.category
					? this.mapPermissionCategory(cp.permission.category)
					: null,
			},
		}))
	}

	async removePermissionFromCorporation(
		corporationPermissionId: string,
		actorId: string
	): Promise<void> {
		// Admin-only operation

		const corpPerm = await this.db.query.corporationPermissions.findFirst({
			where: eq(corporationPermissions.id, corporationPermissionId),
		})

		if (!corpPerm) {
			throw new Error('Corporation permission not found')
		}

		await this.db
			.delete(corporationPermissions)
			.where(eq(corporationPermissions.id, corporationPermissionId))

		// Invalidate cache for this corporation
		this.invalidateCorporationPermissionsCache(corpPerm.corporationId)
	}

	async getCharacterPermissions(characterId: string): Promise<UserPermission[]> {
		console.log('[getCharacterPermissions] Fetching permissions for character', { characterId })

		// Resolve character's corporation via EveCharacterData DO
		const charStub = getStub<EveCharacterData>(this.env.EVE_CHARACTER_DATA, characterId)
		const charInfo = await charStub.getCharacterInfo(characterId)

		if (!charInfo || !charInfo.corporationId) {
			console.log('[getCharacterPermissions] No character info or corporation ID', {
				characterId,
				hasCharInfo: !!charInfo,
				corporationId: charInfo?.corporationId,
			})
			return []
		}

		const corporationId = String(charInfo.corporationId)
		console.log('[getCharacterPermissions] Character corporation resolved', {
			characterId,
			corporationId,
		})

		// Query corporation permissions with join
		const corpPerms = await this.db.query.corporationPermissions.findMany({
			where: eq(corporationPermissions.corporationId, corporationId),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
			},
		})

		console.log('[getCharacterPermissions] Found corporation permissions', {
			characterId,
			corporationId,
			count: corpPerms.length,
			permissions: corpPerms.map((cp) => cp.permission.urn),
		})

		// Transform to UserPermission format
		return corpPerms.map((cp) => ({
			permissionId: cp.permissionId,
			urn: cp.permission.urn,
			name: cp.permission.name,
			description: cp.permission.description,
			category: cp.permission.category ? this.mapPermissionCategory(cp.permission.category) : null,
			groupId: corporationId, // Use corporationId as groupId for consistency
			groupName: charInfo.corporationName || corporationId,
			targetType: 'all_members' as PermissionTarget, // Corporation permissions always apply to all members
			source: 'global' as const,
		}))
	}

	/**
	 * ============================================
	 * PERMISSION QUERY OPERATIONS
	 * ============================================
	 */

	/**
	 * Check cache for user permissions and return if valid
	 */
	private getCachedUserPermissions(userId: string): UserPermission[] | null {
		const cached = this.permissionsCache.get(userId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}
		return null
	}

	/**
	 * Store user permissions in cache with LRU eviction
	 */
	private cacheUserPermissions(userId: string, permissions: UserPermission[]): void {
		this.setCacheEntry(this.permissionsCache, userId, permissions)
	}

	/**
	 * Check cache for corporation permissions and return if valid
	 */
	private getCachedCorporationPermissions(corporationId: string): UserPermission[] | null {
		const cached = this.corporationPermissionsCache.get(corporationId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}
		return null
	}

	/**
	 * Store corporation permissions in cache with LRU eviction
	 */
	private cacheCorporationPermissions(corporationId: string, permissions: UserPermission[]): void {
		this.setCacheEntry(this.corporationPermissionsCache, corporationId, permissions)
	}

	/**
	 * Fetch user's group memberships with group details
	 */
	private async getUserGroupMemberships(userId: string) {
		return await this.db.query.groupMembers.findMany({
			where: eq(groupMembers.userId, userId),
			with: {
				group: true,
			},
		})
	}

	/**
	 * Fetch user's admin roles and return Set of group IDs where user is admin
	 */
	private async getUserAdminGroupIds(userId: string, groupIds: string[]): Promise<Set<string>> {
		const adminRoles = await this.db.query.groupAdmins.findMany({
			where: and(inArray(groupAdmins.groupId, groupIds), eq(groupAdmins.userId, userId)),
		})
		return new Set(adminRoles.map((a) => a.groupId))
	}

	/**
	 * Fetch all group permissions for given groups with relations
	 */
	private async getGroupPermissionsForGroups(groupIds: string[]) {
		return await this.db.query.groupPermissions.findMany({
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
	}

	/**
	 * Fetch user's corporations and alliances from Core durable object
	 */
	private async getUserCorporationsAndAlliances(userId: string): Promise<{
		corporations: Array<{ corporationId: string; corporationName: string }>
		alliances: Array<{ allianceId: string; allianceName: string }>
	}> {
		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const [corporations, alliances] = await Promise.all([
			coreStub.getUserCorporations(userId),
			coreStub.getUserAlliances(userId),
		])
		return { corporations, alliances }
	}

	/**
	 * Fetch corporation permissions for multiple corporations with caching
	 */
	private async getCorporationPermissionsForCorporations(
		corporationIds: string[],
		corporationNames: Map<string, string>
	): Promise<UserPermission[]> {
		if (corporationIds.length === 0) {
			return []
		}

		// Check cache for each corporation and collect uncached IDs
		const cachedPermissions: UserPermission[] = []
		const uncachedCorporationIds: string[] = []

		for (const corporationId of corporationIds) {
			const cached = this.getCachedCorporationPermissions(corporationId)
			if (cached) {
				cachedPermissions.push(...cached)
			} else {
				uncachedCorporationIds.push(corporationId)
			}
		}

		// If all were cached, return cached permissions
		if (uncachedCorporationIds.length === 0) {
			return cachedPermissions
		}

		// Query database for uncached corporations
		const corpPerms = await this.db.query.corporationPermissions.findMany({
			where: inArray(corporationPermissions.corporationId, uncachedCorporationIds),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
			},
		})

		// Group permissions by corporation ID and cache them
		const permissionsByCorp = new Map<string, UserPermission[]>()
		for (const cp of corpPerms) {
			const corporationId = cp.corporationId
			if (!permissionsByCorp.has(corporationId)) {
				permissionsByCorp.set(corporationId, [])
			}

			const corporationName = corporationNames.get(corporationId) || corporationId
			const userPermission: UserPermission = {
				permissionId: cp.permissionId,
				urn: cp.permission.urn,
				name: cp.permission.name,
				description: cp.permission.description,
				category: cp.permission.category
					? this.mapPermissionCategory(cp.permission.category)
					: null,
				groupId: corporationId,
				groupName: corporationName,
				targetType: 'all_members' as PermissionTarget,
				source: 'global' as const,
			}

			permissionsByCorp.get(corporationId)!.push(userPermission)
		}

		// Cache permissions for each corporation
		for (const [corporationId, permissions] of permissionsByCorp) {
			this.cacheCorporationPermissions(corporationId, permissions)
		}

		// Combine cached and newly fetched permissions
		const allPermissions = [...cachedPermissions]
		for (const permissions of permissionsByCorp.values()) {
			allPermissions.push(...permissions)
		}

		return allPermissions
	}

	/**
	 * Determine if user qualifies for permission based on targetType
	 */
	private userHasPermission(
		targetType: PermissionTarget,
		isOwner: boolean,
		isAdmin: boolean
	): boolean {
		if (targetType === 'all_members') {
			return true
		} else if (targetType === 'all_admins') {
			return isAdmin
		} else if (targetType === 'owner_only') {
			return isOwner
		} else if (targetType === 'owner_and_admins') {
			return isOwner || isAdmin
		}
		return false
	}

	/**
	 * Build UserPermission object from group permission data
	 */
	private buildUserPermission(
		groupPerm: Awaited<ReturnType<typeof this.getGroupPermissionsForGroups>>[number],
		userId: string
	): UserPermission {
		// Determine URN and name based on whether this is global or group-scoped
		const urn = groupPerm.permissionId ? groupPerm.permission!.urn : groupPerm.customUrn!
		const name = groupPerm.permissionId ? groupPerm.permission!.name : groupPerm.customName!
		const description = groupPerm.permissionId
			? groupPerm.permission!.description
			: groupPerm.customDescription
		const category =
			groupPerm.permissionId && groupPerm.permission!.category
				? groupPerm.permission!.category
				: null

		return {
			permissionId: groupPerm.permissionId ?? null,
			urn,
			name,
			description,
			category: category ? this.mapPermissionCategory(category) : null,
			groupId: groupPerm.groupId,
			groupName: groupPerm.group.name,
			targetType: groupPerm.targetType,
			source: groupPerm.permissionId ? 'global' : 'group_scoped',
		}
	}

	/**
	 * Resolve all permissions user should receive based on their role in each group
	 */
	private resolveUserPermissions(
		groupPerms: Awaited<ReturnType<typeof this.getGroupPermissionsForGroups>>,
		userId: string,
		adminGroupIds: Set<string>
	): UserPermission[] {
		const resolvedPermissions: UserPermission[] = []

		for (const gp of groupPerms) {
			const isOwner = gp.group.ownerId === userId
			const isAdmin = adminGroupIds.has(gp.groupId)

			// Determine if user gets this permission based on target type
			if (!this.userHasPermission(gp.targetType, isOwner, isAdmin)) {
				continue
			}

			resolvedPermissions.push(this.buildUserPermission(gp, userId))
		}

		return resolvedPermissions
	}

	/**
	 * Deduplicate permissions by URN (in case user has same permission from multiple groups)
	 */
	private deduplicatePermissionsByUrn(permissions: UserPermission[]): UserPermission[] {
		return Array.from(new Map(permissions.map((p) => [p.urn, p])).values())
	}

	async getUserPermissions(userId: string): Promise<UserPermission[]> {
		console.log('[getUserPermissions] Fetching permissions for user', { userId })

		// Check cache first
		const cached = this.getCachedUserPermissions(userId)
		if (cached) {
			console.log('[getUserPermissions] Returning cached permissions', {
				userId,
				count: cached.length,
				permissions: cached.map((p) => p.urn),
			})
			return cached
		}

		// Get all groups the user is a member of and user's corporations in parallel
		const [memberships, { corporations }] = await Promise.all([
			this.getUserGroupMemberships(userId),
			this.getUserCorporationsAndAlliances(userId),
		])

		// Resolve group permissions
		let groupPermissions: UserPermission[] = []
		if (memberships.length > 0) {
			const groupIds = memberships.map((m) => m.groupId)
			console.log('[getUserPermissions] User memberships found', {
				userId,
				groupCount: memberships.length,
				groupIds,
			})

			// Get user's admin roles and group permissions
			const [adminGroupIds, groupPerms] = await Promise.all([
				this.getUserAdminGroupIds(userId, groupIds),
				this.getGroupPermissionsForGroups(groupIds),
			])

			// Resolve permissions based on user's role in each group
			groupPermissions = this.resolveUserPermissions(groupPerms, userId, adminGroupIds)
		} else {
			console.log('[getUserPermissions] User has no group memberships', { userId })
		}

		// Resolve corporation permissions
		let corporationPermissions: UserPermission[] = []
		if (corporations.length > 0) {
			const corporationIds = corporations.map((c) => c.corporationId)
			const corporationNames = new Map(
				corporations.map((c) => [c.corporationId, c.corporationName])
			)

			console.log('[getUserPermissions] User corporations found', {
				userId,
				corporationCount: corporations.length,
				corporationIds,
			})

			corporationPermissions = await this.getCorporationPermissionsForCorporations(
				corporationIds,
				corporationNames
			)
		}

		// Combine group and corporation permissions
		const allPermissions = [...groupPermissions, ...corporationPermissions]

		// Deduplicate by URN (in case user has same permission from multiple groups or corporations)
		const deduped = this.deduplicatePermissionsByUrn(allPermissions)

		console.log('[getUserPermissions] Resolved user permissions', {
			userId,
			groupPermissions: groupPermissions.length,
			corporationPermissions: corporationPermissions.length,
			totalPermissions: allPermissions.length,
			dedupedCount: deduped.length,
			permissions: deduped.map((p) => ({ urn: p.urn, groupId: p.groupId, source: p.source })),
		})

		// Cache the result
		this.cacheUserPermissions(userId, deduped)

		return deduped
	}

	/**
	 * Batch version of getUserPermissions - optimized for fetching multiple users at once.
	 * Reduces N+1 queries by batching all database operations.
	 */
	async getUserPermissionsBatch(userIds: string[]): Promise<Map<string, UserPermission[]>> {
		if (userIds.length === 0) {
			return new Map()
		}

		console.log('[getUserPermissionsBatch] Fetching permissions for users', {
			userCount: userIds.length,
		})

		// Check cache and separate cached vs uncached users
		const result = new Map<string, UserPermission[]>()
		const uncachedUserIds: string[] = []

		for (const userId of userIds) {
			const cached = this.getCachedUserPermissions(userId)
			if (cached) {
				result.set(userId, cached)
			} else {
				uncachedUserIds.push(userId)
			}
		}

		// If all users were cached, return early
		if (uncachedUserIds.length === 0) {
			console.log('[getUserPermissionsBatch] All users cached', {
				cachedCount: userIds.length,
			})
			return result
		}

		// STEP 1: Batch fetch all group memberships for uncached users
		const allMemberships = await this.db.query.groupMembers.findMany({
			where: inArray(groupMembers.userId, uncachedUserIds),
			with: {
				group: true,
			},
		})

		// Build user -> memberships map
		const userMembershipsMap = new Map<string, Array<(typeof allMemberships)[number]>>()
		for (const membership of allMemberships) {
			if (!userMembershipsMap.has(membership.userId)) {
				userMembershipsMap.set(membership.userId, [])
			}
			userMembershipsMap.get(membership.userId)!.push(membership)
		}

		// STEP 2: Batch fetch corporations for all uncached users
		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const [corporationsByUser, _alliancesByUser] = await Promise.all([
			coreStub.getUserCorporationsBatch(uncachedUserIds),
			Promise.resolve(new Map<string, Array<{ allianceId: string; allianceName: string }>>()), // Not used yet
		])

		// STEP 3: Collect all unique groupIds and corporationIds
		const allGroupIds = new Set<string>()
		const allCorporationIds = new Set<string>()
		const corporationNamesMap = new Map<string, string>()

		for (const userId of uncachedUserIds) {
			const memberships = userMembershipsMap.get(userId) || []
			for (const m of memberships) {
				allGroupIds.add(m.groupId)
			}

			const corporations = corporationsByUser.get(userId) || []
			for (const c of corporations) {
				allCorporationIds.add(c.corporationId)
				corporationNamesMap.set(c.corporationId, c.corporationName)
			}
		}

		// STEP 4: Batch fetch admin roles and group permissions (shared data)
		const [allAdminRoles, allGroupPerms] = await Promise.all([
			allGroupIds.size > 0
				? this.db.query.groupAdmins.findMany({
						where: and(
							inArray(groupAdmins.groupId, Array.from(allGroupIds)),
							inArray(groupAdmins.userId, uncachedUserIds)
						),
					})
				: [],
			allGroupIds.size > 0 ? this.getGroupPermissionsForGroups(Array.from(allGroupIds)) : [],
		])

		// Build user -> admin groupIds map
		const userAdminGroupsMap = new Map<string, Set<string>>()
		for (const admin of allAdminRoles) {
			if (!userAdminGroupsMap.has(admin.userId)) {
				userAdminGroupsMap.set(admin.userId, new Set())
			}
			userAdminGroupsMap.get(admin.userId)!.add(admin.groupId)
		}

		// Build groupId -> group permissions map (shared across users)
		const groupPermsMap = new Map<string, Array<(typeof allGroupPerms)[number]>>()
		for (const gp of allGroupPerms) {
			if (!groupPermsMap.has(gp.groupId)) {
				groupPermsMap.set(gp.groupId, [])
			}
			groupPermsMap.get(gp.groupId)!.push(gp)
		}

		// STEP 5: Fetch corporation permissions (with caching)
		const corpPermissions = await this.getCorporationPermissionsForCorporations(
			Array.from(allCorporationIds),
			corporationNamesMap
		)

		// Build corporationId -> permissions map
		const corpPermsMap = new Map<string, UserPermission[]>()
		for (const cp of corpPermissions) {
			if (!corpPermsMap.has(cp.groupId)) {
				corpPermsMap.set(cp.groupId, [])
			}
			corpPermsMap.get(cp.groupId)!.push(cp)
		}

		// STEP 6: Resolve permissions for each user
		for (const userId of uncachedUserIds) {
			const memberships = userMembershipsMap.get(userId) || []
			const adminGroupIds = userAdminGroupsMap.get(userId) || new Set()
			const userCorporations = corporationsByUser.get(userId) || []

			// Resolve group permissions
			const groupPermissions: UserPermission[] = []
			for (const membership of memberships) {
				const groupId = membership.groupId
				const group = membership.group
				const isOwner = group.ownerId === userId
				const isAdmin = adminGroupIds.has(groupId)

				const permsForGroup = groupPermsMap.get(groupId) || []
				for (const gp of permsForGroup) {
					if (!this.userHasPermission(gp.targetType, isOwner, isAdmin)) {
						continue
					}
					groupPermissions.push(this.buildUserPermission(gp, userId))
				}
			}

			// Resolve corporation permissions
			const corporationPermissions: UserPermission[] = []
			for (const corp of userCorporations) {
				const perms = corpPermsMap.get(corp.corporationId) || []
				corporationPermissions.push(...perms)
			}

			// Combine and deduplicate
			const allPermissions = [...groupPermissions, ...corporationPermissions]
			const deduped = this.deduplicatePermissionsByUrn(allPermissions)

			// Cache the result
			this.cacheUserPermissions(userId, deduped)
			result.set(userId, deduped)
		}

		console.log('[getUserPermissionsBatch] Completed', {
			totalUsers: userIds.length,
			cachedUsers: userIds.length - uncachedUserIds.length,
			fetchedUsers: uncachedUserIds.length,
		})

		return result
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

		// Use batch method to get all permissions at once
		const permissionsMap = await this.getUserPermissionsBatch(userIds)

		// Convert to response format, filtering to only permissions from this group
		const userPermissionsMap: Record<string, UserPermission[]> = {}
		for (const [userId, perms] of permissionsMap) {
			userPermissionsMap[userId] = perms.filter((p) => p.groupId === groupId)
		}

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

		// Use batch method to get all permissions at once
		const groupIdsSet = new Set(groupIds)
		const permissionsMap = await this.getUserPermissionsBatch(uniqueUserIds)

		// Convert to response format, filtering to only permissions from specified groups
		const userPermissionsMap: Record<string, UserPermission[]> = {}
		for (const [userId, perms] of permissionsMap) {
			userPermissionsMap[userId] = perms.filter((p) => groupIdsSet.has(p.groupId))
		}

		return { userPermissions: userPermissionsMap }
	}

	async createRole(request: CreateRoleRequest): Promise<Role> {
		return this.roleService.createRole(request)
	}

	async batchCreateRoles(request: BatchCreateRolesRequest): Promise<Role[]> {
		return this.roleService.batchCreateRoles(request)
	}

	async getRole(roleId: string): Promise<Role | null> {
		return this.roleService.getRole(roleId)
	}

	async getRoleByName(name: string): Promise<Role | null> {
		return this.roleService.getRoleByName(name)
	}

	async getRolesForOwnedBy(ownedBy: string): Promise<Role[]> {
		return this.roleService.getRolesForOwnedBy(ownedBy)
	}

	async attachRoleTo(request: AttachRoleToRequest): Promise<RoleAttachment> {
		return this.roleService.attachRoleTo(request)
	}

	async batchAttachRolesTo(request: BatchAttachRoleToRequest): Promise<RoleAttachment[]> {
		return this.roleService.batchAttachRolesTo(request)
	}

	async detachRoleFrom(request: DetachRoleFromRequest): Promise<boolean> {
		return this.roleService.detachRoleFrom(request)
	}

	async deleteRoleAttachment(attachmentId: string): Promise<boolean> {
		return this.roleService.deleteRoleAttachment(attachmentId)
	}

	async getRolesFor(request: GetRolesForRequest): Promise<RoleAttachment[]> {
		return this.roleService.getRolesFor(request)
	}

	async batchGetRolesFor(request: BatchGetRolesForRequest): Promise<RoleAttachment[]> {
		return this.roleService.batchGetRolesFor(request)
	}

	async replaceCoreMembershipRolesForUser(
		request: ReplaceCoreMembershipRolesForUserRequest
	): Promise<ReplaceCoreMembershipRolesForUserResponse> {
		return this.roleService.replaceCoreMembershipRolesForUser(request)
	}

	/**
	 * ============================================
	 * HELPER METHODS
	 * ============================================
	 */

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

	/**
	 * Invalidate corporation permissions cache for a specific corporation
	 */
	private invalidateCorporationPermissionsCache(corporationId: string): void {
		this.corporationPermissionsCache.delete(corporationId)
		// Also clear user permissions cache since corporation permissions are included in getUserPermissions
		// We don't know which users belong to this corporation without expensive queries, so clear all
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

	private async isUserSiteAdmin(userId: string): Promise<boolean> {
		const user = await this.coreDb.query.users.findFirst({
			where: eq(coreSchema.users.id, userId),
			columns: { is_admin: true },
		})
		return user?.is_admin ?? false
	}

	private async getGroupMemberCount(groupId: string): Promise<number> {
		const result = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(groupMembers)
			.where(eq(groupMembers.groupId, groupId))
		return result[0]?.count ?? 0
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
	 * Cancel all pending invitations for a user in a specific group.
	 * This should be called whenever a user joins a group through any method
	 * (direct join, request approval, or invitation acceptance) to prevent
	 * showing stale invitations to users and admins.
	 */
	private async cancelPendingInvitations(groupId: string, userId: string): Promise<void> {
		await this.db
			.update(groupInvitations)
			.set({
				status: 'cancelled',
				respondedAt: new Date(),
			})
			.where(
				and(
					eq(groupInvitations.groupId, groupId),
					eq(groupInvitations.inviteeUserId, userId),
					eq(groupInvitations.status, 'pending')
				)
			)
	}

	/**
	 * ============================================
	 * MAPPING FUNCTIONS
	 * ============================================
	 */

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
