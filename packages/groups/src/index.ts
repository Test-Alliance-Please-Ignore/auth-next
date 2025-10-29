/**
 * @repo/groups
 *
 * Shared types and interfaces for the Groups Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Re-export permission types
 */
export * from './permissions'

/**
 * Enums matching database schema
 */

export type Visibility = 'public' | 'hidden' | 'system'
export type CategoryPermission = 'anyone' | 'admin_only'
export type JoinMode = 'open' | 'approval' | 'invitation_only'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired'
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

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
	mainCharacterId?: string
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
	inviteeMainCharacterId: string
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
	adminUserIds?: string[]
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
	categoryId?: string
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

export interface GroupByInviteCodeResponse {
	group: GroupWithDetails
	inviteCode: {
		isValid: boolean
		isExpired: boolean
		isRevoked: boolean
		hasRemainingUses: boolean
		expiresAt: Date
	}
	canJoin: boolean
	errorMessage?: string
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
	getCategory(id: string, userId: string, isAdmin: boolean): Promise<CategoryWithGroups | null>

	/** Update a category (admin only) */
	updateCategory(id: string, data: UpdateCategoryRequest, adminUserId: string): Promise<Category>

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
	getGroupMembers(groupId: string, userId: string, isAdmin: boolean): Promise<GroupMember[]>

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
	listJoinRequests(groupId: string, adminUserId: string): Promise<GroupJoinRequestWithDetails[]>

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
		userId: string,
		isAdmin?: boolean
	): Promise<CreateInviteCodeResponse>

	/** List invite codes for a group (owner/admin/global admin only) */
	listInviteCodes(
		groupId: string,
		userId: string,
		isGlobalAdmin?: boolean
	): Promise<GroupInviteCode[]>

	/** Revoke an invite code (owner/global admin only) */
	revokeInviteCode(codeId: string, userId: string, isAdmin?: boolean): Promise<void>

	/** Redeem an invite code */
	redeemInviteCode(code: string, userId: string): Promise<RedeemInviteCodeResponse>

	/** Get group information by invite code (for preview/landing page) */
	getGroupByInviteCode(code: string, userId?: string): Promise<GroupByInviteCodeResponse>

	/**
	 * Discord Server Operations
	 */

	/** Attach a Discord server from the registry to a group */
	attachDiscordServer(
		groupId: string,
		discordServerId: string,
		autoInvite: boolean,
		autoAssignRoles: boolean
	): Promise<any>

	/** Get Discord servers attached to a group */
	getDiscordServers(groupId: string): Promise<any[]>

	/** Update a Discord server attachment's settings */
	updateDiscordServerAttachment(
		attachmentId: string,
		updates: {
			autoInvite?: boolean
			autoAssignRoles?: boolean
		}
	): Promise<any>

	/** Detach a Discord server from a group */
	detachDiscordServer(attachmentId: string): Promise<void>

	/** Assign a Discord role to a group Discord server attachment */
	assignRoleToDiscordServer(
		attachmentId: string,
		discordRoleId: string
	): Promise<{ id: string; discordRoleId: string }>

	/** Unassign a Discord role from a group Discord server attachment */
	unassignRoleFromDiscordServer(roleAssignmentId: string): Promise<void>

	/** Get group member user IDs (for Discord auto-invite) */
	getGroupMemberUserIds(groupId: string): Promise<string[]>

	/** Get Discord server configuration for a specific attachment (for role refresh) */
	getDiscordServerAttachmentConfig(attachmentId: string): Promise<{
		groupId: string
		guildId: string
		roleIds: string[]
	}>

	/** Get groups with Discord auto-invite enabled */
	getGroupsWithDiscordAutoInvite(): Promise<any[]>

	/** Get groups that have a specific Discord server attached */
	getGroupsByDiscordServer(
		discordServerId: string
	): Promise<Array<{ groupId: string; groupName: string }>>

	/** Insert Discord invite audit records */
	insertDiscordInviteAuditRecords(records: any[]): Promise<void>

	/**
	 * Permission Category Operations
	 */

	/** Create a permission category (admin only) */
	createPermissionCategory(
		data: import('./permissions').CreatePermissionCategoryRequest,
		adminUserId: string
	): Promise<import('./permissions').PermissionCategory>

	/** List all permission categories */
	listPermissionCategories(): Promise<import('./permissions').PermissionCategory[]>

	/** Update a permission category (admin only) */
	updatePermissionCategory(
		id: string,
		data: import('./permissions').UpdatePermissionCategoryRequest,
		adminUserId: string
	): Promise<import('./permissions').PermissionCategory>

	/** Delete a permission category (admin only) */
	deletePermissionCategory(id: string, adminUserId: string): Promise<void>

	/**
	 * Global Permission Operations
	 */

	/** Create a global permission (admin only) */
	createPermission(
		data: import('./permissions').CreatePermissionRequest,
		adminUserId: string
	): Promise<import('./permissions').Permission>

	/** List all global permissions */
	listPermissions(categoryId?: string): Promise<import('./permissions').PermissionWithDetails[]>

	/** Get a specific global permission */
	getPermission(id: string): Promise<import('./permissions').PermissionWithDetails | null>

	/** Update a global permission (admin only) */
	updatePermission(
		id: string,
		data: import('./permissions').UpdatePermissionRequest,
		adminUserId: string
	): Promise<import('./permissions').Permission>

	/** Delete a global permission (admin only) */
	deletePermission(id: string, adminUserId: string): Promise<void>

	/**
	 * Group Permission Operations
	 */

	/** Attach a global permission to a group (admin only) */
	attachPermissionToGroup(
		data: import('./permissions').AttachPermissionRequest,
		adminUserId: string
	): Promise<import('./permissions').GroupPermissionWithDetails>

	/** Create a group-scoped permission (admin only) */
	createGroupScopedPermission(
		data: import('./permissions').CreateGroupScopedPermissionRequest,
		adminUserId: string
	): Promise<import('./permissions').GroupPermissionWithDetails>

	/** List permissions attached to a group (admin only) */
	listGroupPermissions(
		groupId: string,
		adminUserId: string
	): Promise<import('./permissions').GroupPermissionWithDetails[]>

	/** Update a group permission (admin only) */
	updateGroupPermission(
		groupPermissionId: string,
		data: import('./permissions').UpdateGroupPermissionRequest,
		adminUserId: string
	): Promise<import('./permissions').GroupPermissionWithDetails>

	/** Remove a permission from a group (admin only) */
	removePermissionFromGroup(groupPermissionId: string, adminUserId: string): Promise<void>

	/**
	 * Permission Query Operations
	 */

	/** Get all permissions for a specific user across all their groups */
	getUserPermissions(userId: string): Promise<import('./permissions').UserPermission[]>

	/** Get permissions for all members of a specific group */
	getGroupMemberPermissions(
		groupId: string
	): Promise<import('./permissions').GetGroupMemberPermissionsResponse>

	/** Get permissions for all members across multiple groups */
	getMultiGroupMemberPermissions(
		groupIds: string[]
	): Promise<import('./permissions').GetMultiGroupMemberPermissionsResponse>
}
