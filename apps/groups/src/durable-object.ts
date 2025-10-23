import { DurableObject } from 'cloudflare:workers'
import { and, eq, inArray, isNull, like, or, sql } from '@repo/db-utils'
import type {
	Category,
	CategoryWithGroups,
	CreateCategoryRequest,
	CreateGroupRequest,
	CreateInvitationRequest,
	CreateInviteCodeRequest,
	CreateInviteCodeResponse,
	CreateJoinRequestRequest,
	Group,
	GroupAdmin,
	GroupInvitation,
	GroupInvitationWithDetails,
	GroupInviteCode,
	GroupJoinRequest,
	GroupJoinRequestWithDetails,
	GroupMember,
	GroupMembershipSummary,
	Groups,
	GroupWithDetails,
	ListGroupsFilters,
	RedeemInviteCodeResponse,
	UpdateCategoryRequest,
	UpdateGroupRequest,
} from '@repo/groups'

import { createDb } from './db'
import {
	categories,
	groupAdmins,
	groupInviteCodeRedemptions,
	groupInviteCodes,
	groupInvitations,
	groupJoinRequests,
	groupMembers,
	groups,
} from './db/schema'
import { generateShortInviteCode } from './services/code-generator'
import {
	canCreateGroupInCategory,
	canManageGroup,
	canModerateGroup,
	canViewCategory,
	canViewGroup,
	canViewGroupMembers,
	isGroupOwner,
} from './services/permissions'

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

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
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
		if (data.allowGroupCreation !== undefined)
			updates.allowGroupCreation = data.allowGroupCreation

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

		const updates: Partial<typeof groups.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.visibility !== undefined) updates.visibility = data.visibility
		if (data.joinMode !== undefined) updates.joinMode = data.joinMode

		updates.updatedAt = new Date()

		const [updated] = await this.db
			.update(groups)
			.set(updates)
			.where(eq(groups.id, id))
			.returning()

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

		// Update group ownership
		await this.db.update(groups).set({ ownerId: newOwnerId }).where(eq(groups.id, groupId))

		// Add old owner as admin (if not already)
		const isAlreadyAdmin = await this.isUserGroupAdmin(groupId, oldOwnerId)
		if (!isAlreadyAdmin) {
			await this.db.insert(groupAdmins).values({
				groupId,
				userId: oldOwnerId,
			})
		}

		// Remove new owner from admins list (owners don't need to be in admins table)
		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, newOwnerId)))
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
	}

	async getGroupMembers(
		groupId: string,
		userId: string,
		isAdmin: boolean
	): Promise<GroupMember[]> {
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

	async addAdmin(groupId: string, ownerId: string, targetUserId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId)) {
			throw new Error('Only the group owner can add admins')
		}

		// Target must be a member
		const isMember = await this.isUserMember(groupId, targetUserId)
		if (!isMember) {
			throw new Error('User must be a group member to become an admin')
		}

		// Check if already an admin
		const isAlreadyAdmin = await this.isUserGroupAdmin(groupId, targetUserId)
		if (isAlreadyAdmin) {
			throw new Error('User is already an admin')
		}

		// Add as admin
		await this.db.insert(groupAdmins).values({
			groupId,
			userId: targetUserId,
		})
	}

	async removeAdmin(groupId: string, ownerId: string, targetUserId: string): Promise<void> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId)) {
			throw new Error('Only the group owner can remove admins')
		}

		await this.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, targetUserId)))
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

		// Update request status
		await this.db
			.update(groupJoinRequests)
			.set({
				status: 'approved',
				respondedAt: new Date(),
				respondedBy: adminUserId,
			})
			.where(eq(groupJoinRequests.id, requestId))
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

		// Update invitation status
		await this.db
			.update(groupInvitations)
			.set({
				status: 'accepted',
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))
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
		ownerId: string
	): Promise<CreateInviteCodeResponse> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId)) {
			throw new Error('Only the group owner can create invite codes')
		}

		// Validate expiration
		if (data.expiresInDays < 1 || data.expiresInDays > 30) {
			throw new Error('Invite code expiration must be between 1 and 30 days')
		}

		// Generate unique code
		let code = generateShortInviteCode()
		let attempts = 0
		while (attempts < 10) {
			const existing = await this.db.query.groupInviteCodes.findFirst({
				where: eq(groupInviteCodes.code, code),
			})
			if (!existing) break
			code = generateShortInviteCode()
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
				createdBy: ownerId,
				maxUses: data.maxUses || null,
				currentUses: 0,
				expiresAt,
			})
			.returning()

		return {
			code: this.mapGroupInviteCode(inviteCode),
		}
	}

	async listInviteCodes(groupId: string, userId: string): Promise<GroupInviteCode[]> {
		const group = await this.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await this.isUserGroupAdmin(groupId, userId)

		if (!canModerateGroup(group, userId, isAdmin)) {
			throw new Error('Only group owner or admins can view invite codes')
		}

		const codes = await this.db.query.groupInviteCodes.findMany({
			where: and(eq(groupInviteCodes.groupId, groupId), isNull(groupInviteCodes.revokedAt)),
			orderBy: (groupInviteCodes, { desc }) => [desc(groupInviteCodes.createdAt)],
		})

		return codes.map(this.mapGroupInviteCode)
	}

	async revokeInviteCode(codeId: string, ownerId: string): Promise<void> {
		const inviteCode = await this.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.id, codeId),
			with: {
				group: true,
			},
		})

		if (!inviteCode) {
			throw new Error('Invite code not found')
		}

		if (!canManageGroup(inviteCode.group, ownerId)) {
			throw new Error('Only the group owner can revoke invite codes')
		}

		await this.db
			.update(groupInviteCodes)
			.set({ revokedAt: new Date() })
			.where(eq(groupInviteCodes.id, codeId))
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

		return {
			success: true,
			group: this.mapGroup(inviteCode.group),
			message: `Successfully joined ${inviteCode.group.name}`,
		}
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
}
