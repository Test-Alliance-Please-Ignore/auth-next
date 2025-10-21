import type { Category, CategoryPermission, Group, Visibility } from '@repo/groups'

/**
 * Permission service for groups system
 *
 * Centralized permission checking for categories and groups based on:
 * - User roles (admin, owner, member)
 * - Visibility settings (public, hidden, system)
 * - Category permissions
 */

/**
 * Check if a user can view a category based on visibility
 */
export function canViewCategory(
	category: Category,
	userId: string | undefined,
	isAdmin: boolean
): boolean {
	// System admins can view all categories
	if (isAdmin) return true

	// Must be logged in to view any categories
	if (!userId) return false

	// Public categories are visible to all logged-in users
	if (category.visibility === 'public') return true

	// Hidden and system categories are only visible to admins
	// (members of groups within these categories will see their groups separately)
	return false
}

/**
 * Check if a user can create groups in a category
 */
export function canCreateGroupInCategory(
	category: Category,
	userId: string | undefined,
	isAdmin: boolean
): boolean {
	// Must be logged in
	if (!userId) return false

	// Check category permission level
	if (category.allowGroupCreation === 'admin_only') {
		return isAdmin
	}

	// 'anyone' can create groups (all logged-in users)
	return true
}

/**
 * Check if a user can view a group based on visibility and membership
 */
export function canViewGroup(
	group: Group,
	userId: string | undefined,
	isAdmin: boolean,
	isMember: boolean
): boolean {
	// System admins can view all groups
	if (isAdmin) return true

	// Must be logged in
	if (!userId) return false

	switch (group.visibility) {
		case 'public':
			// Public groups are visible to all logged-in users
			return true

		case 'hidden':
			// Hidden groups are visible only to members
			return isMember

		case 'system':
			// System groups are visible only to owner and admins
			// (checked separately in canViewGroupMembers)
			return false

		default:
			return false
	}
}

/**
 * Check if a user can view group members
 *
 * For system visibility groups, only admins and group owner/admins can see members.
 * For public/hidden groups, members can see other members.
 */
export function canViewGroupMembers(
	group: Group,
	userId: string | undefined,
	isAdmin: boolean,
	isMember: boolean,
	isGroupOwnerOrAdmin: boolean
): boolean {
	// System admins can view all memberships
	if (isAdmin) return true

	// Must be logged in
	if (!userId) return false

	// For system visibility groups, only group owner/admins can see members
	if (group.visibility === 'system') {
		return isGroupOwnerOrAdmin
	}

	// For public and hidden groups, members and group owner/admins can see member lists
	return isMember || isGroupOwnerOrAdmin
}

/**
 * Check if a user can manage a group (owner only)
 */
export function canManageGroup(group: Group, userId: string | undefined): boolean {
	if (!userId) return false
	return group.ownerId === userId
}

/**
 * Check if a user is a group owner
 */
export function isGroupOwner(group: Group, userId: string | undefined): boolean {
	if (!userId) return false
	return group.ownerId === userId
}

/**
 * Check if a user can manage group admins (owner only)
 */
export function canManageAdmins(group: Group, userId: string | undefined): boolean {
	return canManageGroup(group, userId)
}

/**
 * Check if a user can approve join requests or remove members (owner or admin)
 */
export function canModerateGroup(
	group: Group,
	userId: string | undefined,
	isGroupAdmin: boolean
): boolean {
	if (!userId) return false
	// Owner or designated admin
	return group.ownerId === userId || isGroupAdmin
}

/**
 * Check if a user can create invitations (owner or admin)
 */
export function canInviteToGroup(
	group: Group,
	userId: string | undefined,
	isGroupAdmin: boolean
): boolean {
	return canModerateGroup(group, userId, isGroupAdmin)
}

/**
 * Check if a user can create invite codes (owner only)
 */
export function canCreateInviteCode(group: Group, userId: string | undefined): boolean {
	return canManageGroup(group, userId)
}

/**
 * Check if a user can view invite codes (owner or admin)
 */
export function canViewInviteCodes(
	group: Group,
	userId: string | undefined,
	isGroupAdmin: boolean
): boolean {
	return canModerateGroup(group, userId, isGroupAdmin)
}

/**
 * Check if a user can revoke invite codes (owner only)
 */
export function canRevokeInviteCode(group: Group, userId: string | undefined): boolean {
	return canManageGroup(group, userId)
}

/**
 * Validate category permission enum
 */
export function isValidCategoryPermission(value: string): value is CategoryPermission {
	return value === 'anyone' || value === 'admin_only'
}

/**
 * Validate visibility enum
 */
export function isValidVisibility(value: string): value is Visibility {
	return value === 'public' || value === 'hidden' || value === 'system'
}
