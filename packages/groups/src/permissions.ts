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
	createdByName?: string
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
	/** Global permission ID when sourced from global permissions (null/undefined for group-scoped) */
	permissionId?: string | null
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
 * Corporation Permission Types
 */

/**
 * Corporation Permission Attachment
 *
 * Links a permission to a corporation. All members of the corporation
 * automatically inherit this permission.
 */
export interface CorporationPermission {
	id: string
	corporationId: string
	permissionId: string
	createdBy: string
	createdAt: Date
}

/**
 * Corporation Permission with Full Details
 *
 * Includes the global permission definition and category
 */
export interface CorporationPermissionWithDetails extends CorporationPermission {
	/** Global permission details */
	permission: PermissionWithDetails
}

/**
 * Request to attach a permission to a corporation
 */
export interface AttachPermissionToCorporationRequest {
	corporationId: string
	permissionId: string
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

/**
 * Structure permission URNs
 *
 * Structure permissions are scoped either to all structures or to a specific corporation.
 * The scope is encoded directly into the URN so the UI and authorization helpers can
 * reason about the visibility target without needing extra lookup state.
 */
export const STRUCTURE_PERMISSION_ROLES = ['viewer', 'manager', 'sensitive'] as const
export type StructurePermissionRole = (typeof STRUCTURE_PERMISSION_ROLES)[number]

export const STRUCTURE_PERMISSION_TABS = [
	'all',
	'citadels',
	'navigation',
	'sovereignty',
	'skyhooks',
	'moon-drills',
	'mining-citadels',
] as const
export type StructurePermissionTab = (typeof STRUCTURE_PERMISSION_TABS)[number]

export const STRUCTURE_PERMISSION_SCOPE_ALL = 'all' as const
export type StructurePermissionScope = string

export interface PermissionLike {
	urn: string
}

export interface ParsedStructurePermissionUrn {
	tab: StructurePermissionTab
	scope: 'all' | 'corp'
	corporationId: string | null
	role: StructurePermissionRole
}

export const STRUCTURE_PERMISSION_URN_PREFIX = 'urn:structures:' as const

export function buildStructurePermissionUrn(
	scope: StructurePermissionScope | typeof STRUCTURE_PERMISSION_SCOPE_ALL,
	role: StructurePermissionRole
): string {
	return `${STRUCTURE_PERMISSION_URN_PREFIX}${scope}:${role}`
}

export function buildStructureTabPermissionUrn(
	tab: Exclude<StructurePermissionTab, 'all'>,
	scope: StructurePermissionScope | typeof STRUCTURE_PERMISSION_SCOPE_ALL,
	role: StructurePermissionRole
): string {
	return `${STRUCTURE_PERMISSION_URN_PREFIX}${tab}:${scope}:${role}`
}

export function isStructurePermissionUrn(value: string): boolean {
	return value.startsWith(STRUCTURE_PERMISSION_URN_PREFIX)
}

export function parseStructurePermissionUrn(value: string): ParsedStructurePermissionUrn | null {
	if (!isStructurePermissionUrn(value)) {
		return null
	}

	const remainder = value.slice(STRUCTURE_PERMISSION_URN_PREFIX.length)
	const parts = remainder.split(':')

	if (parts.length === 2) {
		const [scope, role] = parts
		if (!scope || !role) return null
		if (!STRUCTURE_PERMISSION_ROLES.includes(role as StructurePermissionRole)) {
			return null
		}

		if (scope === STRUCTURE_PERMISSION_SCOPE_ALL) {
			return {
				tab: 'all',
				scope: 'all',
				corporationId: null,
				role: role as StructurePermissionRole,
			}
		}

		return {
			tab: 'all',
			scope: 'corp',
			corporationId: scope,
			role: role as StructurePermissionRole,
		}
	}

	if (parts.length === 3) {
		const [tab, scope, role] = parts
		if (!tab || !scope || !role) return null
		if (!STRUCTURE_PERMISSION_TABS.includes(tab as StructurePermissionTab)) {
			return null
		}
		if (!STRUCTURE_PERMISSION_ROLES.includes(role as StructurePermissionRole)) {
			return null
		}

		if (scope === STRUCTURE_PERMISSION_SCOPE_ALL) {
			return {
				tab: tab as Exclude<StructurePermissionTab, 'all'>,
				scope: 'all',
				corporationId: null,
				role: role as StructurePermissionRole,
			}
		}

		return {
			tab: tab as Exclude<StructurePermissionTab, 'all'>,
			scope: 'corp',
			corporationId: scope,
			role: role as StructurePermissionRole,
		}
	}

	return null
}

export function hasAnyStructurePermission(permissions: Array<PermissionLike>): boolean {
	return permissions.some((permission) => parseStructurePermissionUrn(permission.urn) !== null)
}

export function hasStructureTabPermission(
	permissions: Array<PermissionLike>,
	tab: Exclude<StructurePermissionTab, 'all'>
): boolean {
	return permissions.some((permission) => {
		const parsed = parseStructurePermissionUrn(permission.urn)
		if (!parsed) {
			return false
		}

		return parsed.tab === 'all' || parsed.tab === tab
	})
}

export function hasStructureManagerPermission(permissions: Array<PermissionLike>): boolean {
	return permissions.some((permission) => {
		const parsed = parseStructurePermissionUrn(permission.urn)
		if (!parsed) {
			return false
		}

		return parsed.role === 'manager'
	})
}

export function hasStructureSensitivePermission(permissions: Array<PermissionLike>): boolean {
	return permissions.some((permission) => {
		const parsed = parseStructurePermissionUrn(permission.urn)
		if (!parsed) {
			return false
		}

		return parsed.role === 'manager' || parsed.role === 'sensitive'
	})
}

export function hasAllStructureManagerPermission(permissions: Array<PermissionLike>): boolean {
	return permissions.some((permission) => {
		const parsed = parseStructurePermissionUrn(permission.urn)
		if (!parsed || parsed.scope !== 'all') {
			return false
		}

		return parsed.role === 'manager'
	})
}

export function hasAllStructureSensitivePermission(permissions: Array<PermissionLike>): boolean {
	return permissions.some((permission) => {
		const parsed = parseStructurePermissionUrn(permission.urn)
		if (!parsed || parsed.scope !== 'all') {
			return false
		}

		return parsed.role === 'manager' || parsed.role === 'sensitive'
	})
}
