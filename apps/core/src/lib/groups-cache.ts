import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'

import type {
	GroupMembershipSummary,
	Groups,
	GroupWithDetails,
	RoleAttachment,
	RoleAttachmentType,
	UserPermission,
} from '@repo/groups'

/**
 * Shared caching utility for Groups Durable Object operations
 *
 * Reduces RPC calls by caching frequently accessed data with appropriate TTLs.
 * All caches are in-memory and scoped to the worker instance.
 */

// Cache TTLs (in milliseconds)
const PERMISSIONS_TTL = 15 * 1000 // 15 seconds
const MEMBERSHIPS_TTL = 30 * 1000 // 30 seconds
const GROUPS_TTL = 30 * 1000 // 30 seconds
const CHARACTER_PERMISSIONS_TTL = 15 * 1000 // 15 seconds
const ROLES_TTL = 30 * 1000 // 30 seconds

// Permission cache: userId -> UserPermission[]
const permissionsCache = new TimeCache<UserPermission[]>(PERMISSIONS_TTL)

// Membership cache: userId -> GroupMembershipSummary[]
const membershipsCache = new TimeCache<GroupMembershipSummary[]>(MEMBERSHIPS_TTL)

// Group cache: groupId:userId:isAdmin -> GroupWithDetails | null
const groupsCache = new TimeCache<GroupWithDetails | null>(GROUPS_TTL)

// Character permissions cache: characterId -> UserPermission[]
const characterPermissionsCache = new TimeCache<UserPermission[]>(CHARACTER_PERMISSIONS_TTL)

// Roles cache: userId -> RoleAttachment[]
const rolesCache = new TimeCache<RoleAttachment[]>(ROLES_TTL)

/**
 * Environment type that includes GROUPS binding
 */
type GroupsEnv = {
	GROUPS: DurableObjectNamespace
}

/**
 * Get cached user permissions or fetch from Groups DO
 */
export async function getCachedUserPermissions(
	env: GroupsEnv,
	userId: string
): Promise<UserPermission[]> {
	const cacheKey = `permissions:${userId}`
	return permissionsCache.getOrSet(cacheKey, async () => {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		return await groupsStub.getUserPermissions(userId)
	})
}

/**
 * Get cached user memberships or fetch from Groups DO
 */
export async function getCachedUserMemberships(
	env: GroupsEnv,
	userId: string
): Promise<GroupMembershipSummary[]> {
	const cacheKey = `memberships:${userId}`
	return membershipsCache.getOrSet(cacheKey, async () => {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		return await groupsStub.getUserMemberships(userId)
	})
}

/**
 * Get cached group or fetch from Groups DO
 */
export async function getCachedGroup(
	env: GroupsEnv,
	groupId: string,
	userId: string,
	isAdmin: boolean
): Promise<GroupWithDetails | null> {
	const cacheKey = `group:${groupId}:${userId}:${isAdmin}`
	return groupsCache.getOrSet(cacheKey, async () => {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		return await groupsStub.getGroup(groupId, userId, isAdmin)
	})
}

/**
 * Get cached character permissions or fetch from Groups DO
 */
export async function getCachedCharacterPermissions(
	env: GroupsEnv,
	characterId: string
): Promise<UserPermission[]> {
	const cacheKey = `character-permissions:${characterId}`
	return characterPermissionsCache.getOrSet(cacheKey, async () => {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		return await groupsStub.getCharacterPermissions(characterId)
	})
}

/**
 * Get cached user roles or fetch from Groups DO
 */
export async function getCachedUserRoles(
	env: GroupsEnv,
	userId: string
): Promise<RoleAttachment[]> {
	const cacheKey = `roles:${userId}`
	return rolesCache.getOrSet(cacheKey, async () => {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		return await groupsStub.getRolesFor({
			attachedToType: 'user' as RoleAttachmentType,
			attachedToId: userId,
		})
	})
}

/**
 * Clear all caches for a specific user
 * Call this when user joins/leaves groups or permissions change
 */
export function clearUserCache(userId: string): void {
	permissionsCache.delete(`permissions:${userId}`)
	membershipsCache.delete(`memberships:${userId}`)
	rolesCache.delete(`roles:${userId}`)
	// Note: We can't efficiently clear all group caches for a user without tracking keys
	// Group caches will expire naturally based on TTL
}

/**
 * Clear roles cache for a specific user
 * Call this when user roles change
 */
export function clearUserRolesCache(userId: string): void {
	rolesCache.delete(`roles:${userId}`)
}

/**
 * Clear group-related caches
 * Call this when group data changes
 */
export function clearGroupCache(groupId: string): void {
	// Clear all group entries for this groupId
	// Since we can't iterate efficiently, we rely on TTL expiration
	// For immediate invalidation, we'd need to track keys per group
	// This is a limitation of the current cache implementation
}

/**
 * Clear all caches (useful for testing or full reset)
 */
export function clearAllCaches(): void {
	permissionsCache.clear()
	membershipsCache.clear()
	groupsCache.clear()
	characterPermissionsCache.clear()
	rolesCache.clear()
}
