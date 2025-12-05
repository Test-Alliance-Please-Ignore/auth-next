import type {
	AttachPermissionRequest,
	AttachPermissionToCorporationRequest,
	CorporationPermission,
	CorporationPermissionWithDetails,
	CreateGroupScopedPermissionRequest,
	CreatePermissionCategoryRequest,
	CreatePermissionRequest,
	GetGroupMemberPermissionsResponse,
	GetMultiGroupMemberPermissionsResponse,
	GroupPermissionWithDetails,
	Permission,
	PermissionCategory,
	PermissionWithDetails,
	UpdateGroupPermissionRequest,
	UpdatePermissionCategoryRequest,
	UpdatePermissionRequest,
	UserPermission,
} from './permissions'
import type {
	AttachRoleToRequest,
	BatchAttachRoleToRequest,
	BatchCreateRolesRequest,
	BatchGetRolesForRequest,
	CreateRoleRequest,
	DetachRoleFromRequest,
	GetRolesForRequest,
	Role,
	RoleAttachment,
} from './roles'

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
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'
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
	hasPendingJoinRequest?: boolean
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
	group?: Group
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

	/** Update a group (owner or site admin) */
	updateGroup(
		id: string,
		data: UpdateGroupRequest,
		userId: string,
		isAdmin?: boolean
	): Promise<Group>

	/** Delete a group (owner or site admin) */
	deleteGroup(id: string, userId: string, isAdmin?: boolean): Promise<void>

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

	/** List join requests for a group (owner, group admin, or site admin) */
	listJoinRequests(
		groupId: string,
		adminUserId: string,
		isSiteAdmin?: boolean
	): Promise<GroupJoinRequestWithDetails[]>

	/** Approve a join request (owner, group admin, or site admin) */
	approveJoinRequest(requestId: string, adminUserId: string, isSiteAdmin?: boolean): Promise<void>

	/** Reject a join request (owner, group admin, or site admin) */
	rejectJoinRequest(requestId: string, adminUserId: string, isSiteAdmin?: boolean): Promise<void>

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
	getGroupByInviteCode(code: string, userId?: string): Promise<GroupByInviteCodeResponse | null>

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
	): Promise<Array<{ groupId: string; groupName: string; id: string; autoAssignRoles: boolean }>>

	/** Insert Discord invite audit records */
	insertDiscordInviteAuditRecords(records: any[]): Promise<void>

	/**
	 * Permission Category Operations
	 */

	/** Create a permission category (admin only) */
	createPermissionCategory(
		data: CreatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory>

	/** List all permission categories */
	listPermissionCategories(): Promise<PermissionCategory[]>

	/** Update a permission category (admin only) */
	updatePermissionCategory(
		id: string,
		data: UpdatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory>

	/** Delete a permission category (admin only) */
	deletePermissionCategory(id: string, adminUserId: string): Promise<void>

	/**
	 * Global Permission Operations
	 */

	/** Create a global permission (admin only) */
	createPermission(data: CreatePermissionRequest, adminUserId: string): Promise<Permission>

	/** List all global permissions */
	listPermissions(categoryId?: string): Promise<PermissionWithDetails[]>

	/** Get a specific global permission */
	getPermission(id: string): Promise<PermissionWithDetails | null>

	/** Update a global permission (admin only) */
	updatePermission(
		id: string,
		data: UpdatePermissionRequest,
		adminUserId: string
	): Promise<Permission>

	/** Delete a global permission (admin only) */
	deletePermission(id: string, adminUserId: string): Promise<void>

	/**
	 * Group Permission Operations
	 */

	/** Attach a global permission to a group (admin only) */
	attachPermissionToGroup(
		data: AttachPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails>

	/** Create a group-scoped permission (admin only) */
	createGroupScopedPermission(
		data: CreateGroupScopedPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails>

	/** List permissions attached to a group (admin only) */
	listGroupPermissions(groupId: string, adminUserId: string): Promise<GroupPermissionWithDetails[]>

	/** Update a group permission (admin only) */
	updateGroupPermission(
		groupPermissionId: string,
		data: UpdateGroupPermissionRequest,
		adminUserId: string
	): Promise<GroupPermissionWithDetails>

	/** Remove a permission from a group (admin only) */
	removePermissionFromGroup(groupPermissionId: string, adminUserId: string): Promise<void>

	/**
	 * Permission Query Operations
	 */

	/** Get all permissions for a specific user across all their groups */
	getUserPermissions(userId: string): Promise<UserPermission[]>

	/** Get permissions for all members of a specific group */
	getGroupMemberPermissions(groupId: string): Promise<GetGroupMemberPermissionsResponse>

	/** Get permissions for all members across multiple groups */
	getMultiGroupMemberPermissions(
		groupIds: string[]
	): Promise<GetMultiGroupMemberPermissionsResponse>

	/**
	 * Corporation Permission Operations
	 */

	/** Attach a global permission to a corporation (admin only) */
	attachPermissionToCorporation(
		data: AttachPermissionToCorporationRequest,
		adminUserId: string
	): Promise<CorporationPermissionWithDetails>

	/** List permissions attached to a corporation */
	listCorporationPermissions(corporationId: string): Promise<CorporationPermissionWithDetails[]>

	/** Remove a permission from a corporation (admin only) */
	removePermissionFromCorporation(
		corporationPermissionId: string,
		adminUserId: string
	): Promise<void>

	/** Get all permissions for a character based on their corporation membership */
	getCharacterPermissions(characterId: string): Promise<UserPermission[]>

	/**
	 * Role Operations
	 */

	/** Create a new role */
	createRole(request: CreateRoleRequest): Promise<Role>

	/** Batch create roles */
	batchCreateRoles(request: BatchCreateRolesRequest): Promise<Role[]>

	/** Get a specific role */
	getRole(roleId: string): Promise<Role | null>

	/** Get a role by name */
	getRoleByName(name: string): Promise<Role | null>

	/** Get roles for a specific owner */
	getRolesForOwnedBy(ownedBy: string): Promise<Role[]>

	/** Attach a role to a specific object */
	attachRoleTo(request: AttachRoleToRequest): Promise<RoleAttachment>

	/** Batch attach roles to multiple objects */
	batchAttachRolesTo(request: BatchAttachRoleToRequest): Promise<RoleAttachment[]>

	/** Detach a role from a specific object */
	detachRoleFrom(request: DetachRoleFromRequest): Promise<boolean>

	/** Get roles for a specific object */
	getRolesFor(request: GetRolesForRequest): Promise<RoleAttachment[]>

	/** Batch get roles for multiple objects */
	batchGetRolesFor(request: BatchGetRolesForRequest): Promise<RoleAttachment[]>
}

export * from './roles'
