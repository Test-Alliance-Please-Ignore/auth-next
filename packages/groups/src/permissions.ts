/**
 * @repo/groups - Permission Types
 *
 * Types and interfaces for the groups permissions system.
 * Supports both global (reusable) and group-scoped permissions.
 */

/**
 * Permission target type - defines who receives the permission
 */
export type PermissionTarget = 'all_members' | 'all_admins' | 'owner_only' | 'owner_and_admins'

/**
 * Permission Categories
 *
 * Organize permissions into logical categories for better management
 */
export interface PermissionCategory {
	id: string
	name: string
	description: string | null
	createdAt: Date
	updatedAt: Date
}

/**
 * Global Permission Definition
 *
 * Reusable permission definitions that can be attached to multiple groups
 */
export interface Permission {
	id: string
	/** URN identifier (e.g., "urn:corporations:dreddit:member") */
	urn: string
	/** Human-readable display name */
	name: string
	description: string | null
	categoryId: string | null
	createdBy: string
	createdAt: Date
	updatedAt: Date
}

/**
 * Permission with Category Details
 */
export interface PermissionWithDetails extends Permission {
	category: PermissionCategory | null
}

/**
 * Group Permission Attachment
 *
 * Links a permission to a group with a specific target type.
 * Can reference a global permission OR define a group-scoped custom permission.
 */
export interface GroupPermission {
	id: string
	groupId: string
	/** Reference to global permission (null for group-scoped) */
	permissionId: string | null
	/** Custom URN for group-scoped permissions */
	customUrn: string | null
	/** Custom name for group-scoped permissions */
	customName: string | null
	/** Custom description for group-scoped permissions */
	customDescription: string | null
	/** Who receives this permission */
	targetType: PermissionTarget
	createdBy: string
	createdAt: Date
}

/**
 * Group Permission with Full Details
 *
 * Includes the global permission definition and category if applicable
 */
export interface GroupPermissionWithDetails extends GroupPermission {
	/** Global permission details (null for group-scoped) */
	permission: PermissionWithDetails | null
	/** The group this permission is attached to */
	group: {
		id: string
		name: string
	}
}

/**
 * User Permission Result
 *
 * Resolved permission for a specific user, including context about
 * which group it came from and what role they have in that group.
 */
export interface UserPermission {
	/** URN identifier */
	urn: string
	/** Human-readable name */
	name: string
	description: string | null
	/** Permission category if available */
	category: PermissionCategory | null
	/** Group ID this permission came from */
	groupId: string
	/** Group name for display */
	groupName: string
	/** What role/status grants this permission */
	targetType: PermissionTarget
	/** Whether this is a global or group-scoped permission */
	source: 'global' | 'group_scoped'
}

/**
 * Request Types
 */

export interface CreatePermissionCategoryRequest {
	name: string
	description?: string
}

export interface UpdatePermissionCategoryRequest {
	name?: string
	description?: string
}

export interface CreatePermissionRequest {
	urn: string
	name: string
	description?: string
	categoryId?: string
}

export interface UpdatePermissionRequest {
	urn?: string
	name?: string
	description?: string
	categoryId?: string | null
}

export interface AttachPermissionRequest {
	groupId: string
	permissionId: string
	targetType: PermissionTarget
}

export interface CreateGroupScopedPermissionRequest {
	groupId: string
	urn: string
	name: string
	description?: string
	targetType: PermissionTarget
}

export interface UpdateGroupPermissionRequest {
	targetType?: PermissionTarget
	/** For group-scoped permissions only */
	customUrn?: string
	customName?: string
	customDescription?: string
}

/**
 * Response Types
 */

export interface GetGroupMemberPermissionsResponse {
	/** Map of userId to their permissions */
	userPermissions: Record<string, UserPermission[]>
}

export interface GetMultiGroupMemberPermissionsResponse {
	/** Map of userId to their permissions across all specified groups */
	userPermissions: Record<string, UserPermission[]>
}
