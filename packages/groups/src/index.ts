/**
 * @repo/groups
 *
 * Shared types and interfaces for the Groups Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Enums matching database schema
 */

export type Visibility = 'public' | 'hidden' | 'system'
export type CategoryPermission = 'anyone' | 'admin_only'
export type JoinMode = 'open' | 'approval' | 'invitation_only'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired'
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected'

/**
 * Data types matching database tables
 */

export interface Category {
	id: string
	name: string
	description: string | null
	visibility: Visibility
	allowGroupCreation: CategoryPermission
	createdAt: Date
	updatedAt: Date
}

export interface Group {
	id: string
	categoryId: string
	name: string
	description: string | null
	visibility: Visibility
	joinMode: JoinMode
	ownerId: string
	createdAt: Date
	updatedAt: Date
}

export interface GroupMember {
	id: string
	groupId: string
	userId: string
	joinedAt: Date
	mainCharacterName?: string
	mainCharacterId?: number
}

export interface GroupAdmin {
	id: string
	groupId: string
	userId: string
	designatedAt: Date
}

export interface GroupInvitation {
	id: string
	groupId: string
	inviterId: string
	inviteeMainCharacterId: number
	inviteeUserId: string | null
	status: InvitationStatus
	expiresAt: Date
	createdAt: Date
	respondedAt: Date | null
}

export interface GroupInviteCode {
	id: string
	groupId: string
	code: string
	createdBy: string
	maxUses: number | null
	currentUses: number
	expiresAt: Date
	createdAt: Date
	revokedAt: Date | null
}

export interface GroupInviteCodeRedemption {
	id: string
	inviteCodeId: string
	userId: string
	redeemedAt: Date
}

export interface GroupJoinRequest {
	id: string
	groupId: string
	userId: string
	reason: string | null
	status: JoinRequestStatus
	createdAt: Date
	respondedAt: Date | null
	respondedBy: string | null
}

/**
 * Extended types with relations for API responses
 */

export interface CategoryWithGroups extends Category {
	groups: Group[]
	groupCount?: number
}

export interface GroupWithDetails extends Group {
	category: Category
	memberCount?: number
	isOwner?: boolean
	isAdmin?: boolean
	isMember?: boolean
	ownerName?: string
}

export interface GroupInvitationWithDetails extends GroupInvitation {
	group: Pick<Group, 'id' | 'name' | 'description' | 'visibility'>
	inviterName?: string
	inviterCharacterName?: string
	inviteeCharacterName?: string
}

export interface GroupJoinRequestWithDetails extends GroupJoinRequest {
	userName?: string
	userMainCharacterName?: string
}

/**
 * Request/input types
 */

export interface CreateCategoryRequest {
	name: string
	description?: string
	visibility?: Visibility
	allowGroupCreation?: CategoryPermission
}

export interface UpdateCategoryRequest {
	name?: string
	description?: string
	visibility?: Visibility
	allowGroupCreation?: CategoryPermission
}

export interface CreateGroupRequest {
	categoryId: string
	name: string
	description?: string
	visibility?: Visibility
	joinMode?: JoinMode
}

export interface UpdateGroupRequest {
	name?: string
	description?: string
	visibility?: Visibility
	joinMode?: JoinMode
}

export interface CreateInvitationRequest {
	groupId: string
	characterName: string
}

export interface CreateInviteCodeRequest {
	groupId: string
	maxUses?: number | null
	expiresInDays: number // 1-30 days
}

export interface CreateJoinRequestRequest {
	groupId: string
	reason?: string
}

export interface ListGroupsFilters {
	categoryId?: string
	visibility?: Visibility
	joinMode?: JoinMode
	search?: string
	myGroups?: boolean
}

/**
 * Response types
 */

export interface CreateInviteCodeResponse {
	code: GroupInviteCode
	url?: string // Optional shareable URL
}

export interface RedeemInviteCodeResponse {
	success: boolean
	group: Group
	message?: string
}

export interface GroupMembershipSummary {
	groupId: string
	groupName: string
	categoryName: string
	isOwner: boolean
	isAdmin: boolean
	joinedAt: Date
}

/**
 * Public RPC interface for Groups Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Groups } from '@repo/groups'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Groups>(env.GROUPS, 'default')
 * const categories = await stub.listCategories(userId, isAdmin)
 * ```
 */
export interface Groups {
	/**
	 * Category Operations
	 */

	/** Create a new category (admin only) */
	createCategory(data: CreateCategoryRequest, adminUserId: string): Promise<Category>

	/** List categories visible to the user */
	listCategories(userId: string, isAdmin: boolean): Promise<Category[]>

	/** Get a specific category */
	getCategory(
		id: string,
		userId: string,
		isAdmin: boolean
	): Promise<CategoryWithGroups | null>

	/** Update a category (admin only) */
	updateCategory(
		id: string,
		data: UpdateCategoryRequest,
		adminUserId: string
	): Promise<Category>

	/** Delete a category (admin only) */
	deleteCategory(id: string, adminUserId: string): Promise<void>

	/**
	 * Group Operations
	 */

	/** Create a new group */
	createGroup(data: CreateGroupRequest, userId: string, isAdmin: boolean): Promise<Group>

	/** List groups with filters */
	listGroups(
		filters: ListGroupsFilters,
		userId: string,
		isAdmin: boolean
	): Promise<GroupWithDetails[]>

	/** Get a specific group */
	getGroup(id: string, userId: string, isAdmin: boolean): Promise<GroupWithDetails | null>

	/** Update a group (owner only) */
	updateGroup(id: string, data: UpdateGroupRequest, userId: string): Promise<Group>

	/** Delete a group (owner only) */
	deleteGroup(id: string, userId: string): Promise<void>

	/** Transfer group ownership (owner or admin) */
	transferOwnership(
		groupId: string,
		requestingUserId: string,
		newOwnerId: string,
		isAdmin?: boolean
	): Promise<void>

	/**
	 * Membership Operations
	 */

	/** Join an open group */
	joinGroup(groupId: string, userId: string): Promise<void>

	/** Leave a group */
	leaveGroup(groupId: string, userId: string): Promise<void>

	/** Remove a member (admin only) */
	removeMember(groupId: string, adminUserId: string, targetUserId: string): Promise<void>

	/** Get group members */
	getGroupMembers(
		groupId: string,
		userId: string,
		isAdmin: boolean
	): Promise<GroupMember[]>

	/** Get user's group memberships */
	getUserMemberships(userId: string): Promise<GroupMembershipSummary[]>

	/**
	 * Admin Operations
	 */

	/** Add a group admin (owner only) */
	addAdmin(groupId: string, ownerId: string, targetUserId: string): Promise<void>

	/** Remove a group admin (owner only) */
	removeAdmin(groupId: string, ownerId: string, targetUserId: string): Promise<void>

	/** Check if user is a group admin */
	isGroupAdmin(groupId: string, userId: string): Promise<boolean>

	/**
	 * Join Request Operations
	 */

	/** Create a join request */
	createJoinRequest(data: CreateJoinRequestRequest, userId: string): Promise<GroupJoinRequest>

	/** List join requests for a group (admin only) */
	listJoinRequests(
		groupId: string,
		adminUserId: string
	): Promise<GroupJoinRequestWithDetails[]>

	/** Approve a join request (admin only) */
	approveJoinRequest(requestId: string, adminUserId: string): Promise<void>

	/** Reject a join request (admin only) */
	rejectJoinRequest(requestId: string, adminUserId: string): Promise<void>

	/**
	 * Invitation Operations
	 */

	/** Create a direct invitation */
	createInvitation(data: CreateInvitationRequest, inviterId: string): Promise<GroupInvitation>

	/** List pending invitations for a user */
	listPendingInvitations(userId: string): Promise<GroupInvitationWithDetails[]>

	/** Get all pending invitations for a group (admin only) */
	getGroupInvitations(
		groupId: string,
		userId: string,
		isAdmin: boolean
	): Promise<GroupInvitationWithDetails[]>

	/** Accept an invitation */
	acceptInvitation(invitationId: string, userId: string): Promise<void>

	/** Decline an invitation */
	declineInvitation(invitationId: string, userId: string): Promise<void>

	/**
	 * Invite Code Operations
	 */

	/** Create an invite code (owner only) */
	createInviteCode(
		data: CreateInviteCodeRequest,
		ownerId: string
	): Promise<CreateInviteCodeResponse>

	/** List invite codes for a group (owner/admin only) */
	listInviteCodes(groupId: string, userId: string): Promise<GroupInviteCode[]>

	/** Revoke an invite code (owner only) */
	revokeInviteCode(codeId: string, ownerId: string): Promise<void>

	/** Redeem an invite code */
	redeemInviteCode(code: string, userId: string): Promise<RedeemInviteCodeResponse>
}
