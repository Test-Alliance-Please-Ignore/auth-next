import { and, eq, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import {
	corporationPermissions,
	groupAdmins,
	groupMembers,
	groupPermissions,
	groups as groupsTable,
	permissionCategories,
	permissions,
} from '../db/schema'
import { assertValidBroadcastPermissionUrn } from './broadcast-urn'
import { canManageGroup } from './permissions'
import { isUserGroupAdmin } from './query-helpers'

import type { Core } from '@repo/core'
import type {
	AttachPermissionRequest,
	AttachPermissionToCorporationRequest,
	CorporationPermissionWithDetails,
	CreatePermissionCategoryRequest,
	CreatePermissionRequest,
	GetGroupMemberPermissionsResponse,
	GetMultiGroupMemberPermissionsResponse,
	GroupPermissionWithDetails,
	Permission,
	PermissionCategory,
	PermissionTarget,
	PermissionWithDetails,
	UpdateGroupPermissionRequest,
	UpdatePermissionCategoryRequest,
	UpdatePermissionRequest,
	UserPermission,
} from '@repo/groups'
import type { ServiceContext } from './context'

// Helper type to bypass strict Core type checks if definitions are missing
type CoreStub = {
	getCorporation(id: string): Promise<{ name: string } | null>
	getCorporationsBatch(ids: string[]): Promise<Map<string, { name: string }>>
	getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>>
	getUserCorporationsAndAlliances(
		userId: string
	): Promise<{ corporations: Array<{ corporationId: string; corporationName: string }> }>
}

export class PermissionManagementService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * ============================================
	 * PERMISSION CATEGORY OPERATIONS
	 * ============================================
	 */

	async createPermissionCategory(
		data: CreatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory> {
		// Admin-only
		const [category] = await this.ctx.db
			.insert(permissionCategories)
			.values({
				name: data.name,
				description: data.description || null,
			})
			.returning()

		return this.mapPermissionCategory(category)
	}

	async updatePermissionCategory(
		id: string,
		data: UpdatePermissionCategoryRequest,
		adminUserId: string
	): Promise<PermissionCategory> {
		// Admin-only
		const updates: Partial<typeof permissionCategories.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description

		updates.updatedAt = new Date()

		const [updated] = await this.ctx.db
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
		// Admin-only (cascades to permissions)
		await this.ctx.db.delete(permissionCategories).where(eq(permissionCategories.id, id))
	}

	async listPermissionCategories(): Promise<PermissionCategory[]> {
		const categories = await this.ctx.db.query.permissionCategories.findMany({
			orderBy: (permissionCategories, { asc }) => [asc(permissionCategories.name)],
		})
		return categories.map(this.mapPermissionCategory)
	}

	/**
	 * ============================================
	 * GLOBAL PERMISSION OPERATIONS
	 * ============================================
	 */

	async createPermission(data: CreatePermissionRequest, adminUserId: string): Promise<Permission> {
		// Admin-only
		assertValidBroadcastPermissionUrn(data.urn)
		const [permission] = await this.ctx.db
			.insert(permissions)
			.values({
				urn: data.urn,
				name: data.name,
				description: data.description || null,
				categoryId: data.categoryId || null,
				createdBy: adminUserId,
			})
			.returning()

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()

		return this.mapPermission(permission)
	}

	async updatePermission(
		id: string,
		data: UpdatePermissionRequest,
		adminUserId: string
	): Promise<Permission> {
		// Admin-only
		if (data.urn !== undefined) {
			assertValidBroadcastPermissionUrn(data.urn)
		}
		const updates: Partial<typeof permissions.$inferInsert> = {}

		if (data.urn !== undefined) updates.urn = data.urn
		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId

		updates.updatedAt = new Date()

		const [updated] = await this.ctx.db
			.update(permissions)
			.set(updates)
			.where(eq(permissions.id, id))
			.returning()

		if (!updated) {
			throw new Error('Permission not found')
		}

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()

		return this.mapPermission(updated)
	}

	async deletePermission(id: string, adminUserId: string): Promise<void> {
		// Admin-only
		await this.ctx.db.delete(permissions).where(eq(permissions.id, id))
		this.ctx.groupsDOCache.invalidateAllPermissionsCache()
	}

	async listPermissions(): Promise<Permission[]> {
		const allPermissions = await this.ctx.db.query.permissions.findMany({
			with: { category: true },
			orderBy: (permissions, { asc }) => [asc(permissions.name)],
		})

		return allPermissions.map((perm) => this.mapPermission(perm))
	}

	async getPermissionByUrn(urn: string): Promise<Permission | null> {
		const permission = await this.ctx.db.query.permissions.findFirst({
			where: eq(permissions.urn, urn),
		})
		return permission ? this.mapPermission(permission) : null
	}

	async getPermission(id: string): Promise<PermissionWithDetails | null> {
		const permission = await this.ctx.db.query.permissions.findFirst({
			where: eq(permissions.id, id),
			with: { category: true },
		})

		if (!permission) return null

		return {
			...this.mapPermission(permission),
			category: permission.category ? this.mapPermissionCategory(permission.category) : null,
		}
	}

	/**
	 * ============================================
	 * GROUP PERMISSION OPERATIONS
	 * ============================================
	 */

	async attachPermissionToGroup(
		groupId: string,
		data: AttachPermissionRequest,
		addedBy: string,
		isAdmin: boolean = false
	): Promise<GroupPermissionWithDetails> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groupsTable.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const adderIsAdmin = await isUserGroupAdmin(this.ctx, groupId, addedBy)

		if (!canManageGroup(group, addedBy, adderIsAdmin)) {
			throw new Error('Only group owner or admins can attach permissions to a group')
		}

		const existingPermission = await this.ctx.db.query.groupPermissions.findFirst({
			where: and(
				eq(groupPermissions.groupId, groupId),
				(data as any).permissionId
					? eq(groupPermissions.permissionId, (data as any).permissionId)
					: (data as any).customUrn
						? eq(groupPermissions.customUrn, (data as any).customUrn)
						: undefined
			),
		})

		if (existingPermission) {
			throw new Error('Permission already attached to this group')
		}

		const [groupPermission] = await this.ctx.db
			.insert(groupPermissions)
			.values({
				groupId,
				permissionId: (data as any).permissionId || null,
				customUrn: (data as any).customUrn || null,
				customName: (data as any).customName || null,
				customDescription: (data as any).customDescription || null,
				targetType: data.targetType,
				createdBy: addedBy,
			})
			.returning()

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()

		// Fetch the permission details if permissionId is present
		let permissionDetails: PermissionWithDetails | null = null
		if (groupPermission.permissionId) {
			const perm = await this.getPermission(groupPermission.permissionId)
			if (perm) permissionDetails = perm
		}

		return {
			...this.mapGroupPermission(groupPermission),
			permission: permissionDetails,
			group: this.mapGroup(group) as any, // Cast to avoid strict check on missing relations
		}
	}

	async updateGroupPermission(
		groupId: string,
		groupPermissionId: string,
		data: UpdateGroupPermissionRequest,
		updatedBy: string,
		isAdmin: boolean = false
	): Promise<GroupPermissionWithDetails> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groupsTable.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const updaterIsAdmin = await isUserGroupAdmin(this.ctx, groupId, updatedBy)

		if (!canManageGroup(group, updatedBy, updaterIsAdmin)) {
			throw new Error('Only group owner or admins can update group permissions')
		}

		const updates: Partial<typeof groupPermissions.$inferInsert> = {}

		if (data.targetType !== undefined) updates.targetType = data.targetType
		if ((data as any).customName !== undefined) updates.customName = (data as any).customName
		if ((data as any).customDescription !== undefined)
			updates.customDescription = (data as any).customDescription

		const [updated] = await this.ctx.db
			.update(groupPermissions)
			.set(updates)
			.where(and(eq(groupPermissions.id, groupPermissionId), eq(groupPermissions.groupId, groupId)))
			.returning()

		if (!updated) {
			throw new Error('Group permission not found')
		}

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()

		// Fetch the permission details if permissionId is present
		let permissionDetails: PermissionWithDetails | null = null
		if (updated.permissionId) {
			const perm = await this.getPermission(updated.permissionId)
			if (perm) permissionDetails = perm
		}

		return {
			...this.mapGroupPermission(updated),
			permission: permissionDetails,
			group: this.mapGroup(group) as any,
		}
	}

	async detachPermissionFromGroup(
		groupId: string,
		groupPermissionId: string,
		removedBy: string,
		isAdmin: boolean = false
	): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groupsTable.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const removerIsAdmin = await isUserGroupAdmin(this.ctx, groupId, removedBy)

		if (!canManageGroup(group, removedBy, removerIsAdmin)) {
			throw new Error('Only group owner or admins can detach permissions from a group')
		}

		await this.ctx.db
			.delete(groupPermissions)
			.where(and(eq(groupPermissions.id, groupPermissionId), eq(groupPermissions.groupId, groupId)))

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()
	}

	async attachPermissionToCorporation(
		groupId: string,
		corporationId: string,
		data: AttachPermissionRequest,
		addedBy: string,
		isAdmin: boolean = false
	): Promise<CorporationPermissionWithDetails> {
		// Ensure corporation exists
		const coreStub = getStub<Core>(this.ctx.env.CORE, 'default') as unknown as CoreStub
		const corporation = await coreStub.getCorporation(corporationId)
		if (!corporation) {
			throw new Error('Corporation not found')
		}

		const existingPermission = await this.ctx.db.query.corporationPermissions.findFirst({
			where: and(
				eq(corporationPermissions.corporationId, corporationId),
				(data as any).permissionId
					? eq(corporationPermissions.permissionId, (data as any).permissionId)
					: undefined
			),
		})

		if (existingPermission) {
			throw new Error('Permission already attached to this corporation')
		}

		const [corpPermission] = await this.ctx.db
			.insert(corporationPermissions)
			.values({
				corporationId,
				permissionId: (data as any).permissionId || '', // Must be provided
				createdBy: addedBy,
			})
			.returning()

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()
		this.ctx.groupsDOCache.invalidateCorporationPermissionsCache(corporationId)

		// Fetch the permission details
		const permission = await this.getPermission((data as any).permissionId)

		return {
			...this.mapCorporationPermission(corpPermission),
			permission: permission!, // We know it exists because we inserted it
			corporationName: corporation?.name || 'Unknown',
		} as any as CorporationPermissionWithDetails
	}

	async updateCorporationPermission(
		groupId: string, // Irrelevant?
		corporationPermissionId: string,
		data: UpdateGroupPermissionRequest,
		updatedBy: string,
		isAdmin: boolean = false
	): Promise<CorporationPermissionWithDetails> {
		// Corporation permissions seem to be immutable links between Corp and Permission.
		// They don't have targetType or custom fields in schema.
		// So update might not be possible or useful except maybe changing... nothing?
		// I will implement it as throwing error or just returning existing.

		throw new Error('Corporation permissions cannot be updated, only attached or detached.')
	}

	async detachPermissionFromCorporation(
		groupId: string, // Irrelevant
		corporationPermissionId: string,
		removedBy: string,
		isAdmin: boolean = false
	): Promise<void> {
		// Check admin? `canManageGroup` requires a group.
		// If these are global, maybe only site admins can manage?
		// Or maybe we need to check if `removedBy` is an admin of the corporation?

		// I will assume site admin only for now if no group context is relevant.
		// But wait, the method signature includes `groupId`.
		// If the original intention was "Allow Group X to be accessed by Corporation Y",
		// then it should have been `groupPermissions` with a `targetType` of `corporation`?
		// But `targetType` enum is `all_members`, `all_admins`, etc.

		// The `corporationPermissions` table seems to be for "Members of Corp X have Permission Y".

		// Since the schema doesn't support `groupId` or `targetType`, I'll assume simple link.

		const corpPermission = await this.ctx.db.query.corporationPermissions.findFirst({
			where: eq(corporationPermissions.id, corporationPermissionId),
		})

		if (!corpPermission) {
			throw new Error('Corporation permission not found')
		}

		await this.ctx.db
			.delete(corporationPermissions)
			.where(eq(corporationPermissions.id, corporationPermissionId))

		this.ctx.groupsDOCache.invalidateAllPermissionsCache()
		this.ctx.groupsDOCache.invalidateCorporationPermissionsCache(corpPermission.corporationId)
	}

	async getGroupPermissions(groupId: string): Promise<GroupPermissionWithDetails[]> {
		const results = await this.ctx.db.query.groupPermissions.findMany({
			where: eq(groupPermissions.groupId, groupId),
			with: { permission: { with: { category: true } } },
			orderBy: (groupPermissions, { asc }) => [
				asc(groupPermissions.permissionId),
				asc(groupPermissions.customUrn),
			],
		})

		// Need to map the result to GroupPermissionWithDetails
		// The query returns `groupPermissions` with `permission` nested.
		// `mapGroupPermission` expects `groupPermissions` type.
		// But `GroupPermissionWithDetails` needs `permission` object details.

		// Let's fix mapGroupPermission or handle it here.
		return results.map((gp: any) => {
			// @ts-ignore
			const permission = gp.permission ? this.mapPermission(gp.permission) : null
			const mapped = this.mapGroupPermission(gp)
			return {
				...mapped,
				permission,
				// Providing partial group to satisfy type
				group: { id: gp.groupId } as any,
			} as GroupPermissionWithDetails
		})
	}

	async getCorporationPermissions(
		corporationId: string
	): Promise<CorporationPermissionWithDetails[]> {
		const corpPermissions = await this.ctx.db.query.corporationPermissions.findMany({
			where: eq(corporationPermissions.corporationId, corporationId),
			with: { permission: { with: { category: true } } },
			// orderBy: ...
		})

		// Fetch corporation name
		const corpStub = getStub<Core>(this.ctx.env.CORE, 'default') as unknown as CoreStub
		const corporation = await corpStub.getCorporation(corporationId)

		return corpPermissions.map((cp) => {
			const mapped = this.mapCorporationPermission(cp) as any
			// @ts-ignore
			if (cp.permission) mapped.permission = this.mapPermission(cp.permission)
			mapped.corporationName = corporation?.name || 'Unknown'
			return mapped as CorporationPermissionWithDetails
		})
	}

	/**
	 * ============================================
	 * INTERNAL PERMISSION RESOLUTION
	 * ============================================
	 */

	/**
	 * Get all permissions for a list of groups
	 */
	private async getGroupPermissionsForGroups(groupIds: string[]) {
		return this.ctx.db.query.groupPermissions.findMany({
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
	 * Get all permissions for a list of corporations (cached)
	 */
	private async getCorporationPermissionsForCorporations(
		corporationIds: string[],
		corporationNames: Map<string, string>
	): Promise<UserPermission[]> {
		if (corporationIds.length === 0) return []

		const result: UserPermission[] = []
		const uncachedCorporationIds: string[] = []

		for (const corporationId of corporationIds) {
			const cached = this.ctx.groupsDOCache.getCachedCorporationPermissions(corporationId)
			if (cached) {
				result.push(...cached)
			} else {
				uncachedCorporationIds.push(corporationId)
			}
		}

		if (uncachedCorporationIds.length === 0) {
			return result
		}

		const dbCorpPermissions = await this.ctx.db.query.corporationPermissions.findMany({
			where: inArray(corporationPermissions.corporationId, uncachedCorporationIds),
			with: {
				permission: {
					with: {
						category: true,
					},
				},
				// group: true, // Removed, not in schema
			},
		})

		const permissionsByCorporation = new Map<string, UserPermission[]>()

		for (const cp of dbCorpPermissions) {
			const corporationName = corporationNames.get(cp.corporationId) || 'Unknown'
			const userPermission = this.buildUserPermission(cp, corporationName)

			if (!permissionsByCorporation.has(cp.corporationId)) {
				permissionsByCorporation.set(cp.corporationId, [])
			}
			permissionsByCorporation.get(cp.corporationId)!.push(userPermission)
		}

		// Cache new data and combine results
		for (const corporationId of uncachedCorporationIds) {
			const perms = permissionsByCorporation.get(corporationId) || []
			this.ctx.groupsDOCache.cacheCorporationPermissions(corporationId, perms)
			result.push(...perms)
		}

		return result
	}

	/**
	 * Get user's admin group IDs for a list of groups
	 */
	private async getUserAdminGroupIds(userId: string, groupIds: string[]): Promise<Set<string>> {
		const adminRecords = await this.ctx.db.query.groupAdmins.findMany({
			where: and(eq(groupAdmins.userId, userId), inArray(groupAdmins.groupId, groupIds)),
		})
		return new Set(adminRecords.map((a) => a.groupId))
	}

	/**
	 * Get user's group memberships
	 */
	private async getUserGroupMemberships(userId: string) {
		return this.ctx.db.query.groupMembers.findMany({
			where: eq(groupMembers.userId, userId),
			with: {
				group: true,
			},
		})
	}

	/**
	 * Get user's corporations and alliances
	 */
	private async getUserCorporationsAndAlliances(userId: string) {
		const coreStub = getStub<Core>(this.ctx.env.CORE, 'default') as unknown as CoreStub
		return coreStub.getUserCorporationsAndAlliances(userId)
	}

	/**
	 * Get cached user permissions
	 */
	private getCachedUserPermissions(userId: string): UserPermission[] | null {
		const cached = this.ctx.groupsDOCache.getCachedUserPermissions(userId)
		// TODO: Fix GroupsDOCache type or access
		return cached
	}

	/**
	 * Cache user permissions
	 */
	private cacheUserPermissions(userId: string, permissions: UserPermission[]): void {
		this.ctx.groupsDOCache.cacheUserPermissions(userId, permissions)
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
		groupPerm: any, // Relaxed type to handle different source objects
		corporationName?: string
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

		const basePermission = {
			urn,
			name,
			description,
			category: category ? this.mapPermissionCategory(category) : null,
			groupId: groupPerm.groupId,
			groupName: groupPerm.group?.name,
			targetType: groupPerm.targetType,
		}

		if ('corporationId' in groupPerm) {
			return {
				...basePermission,
				groupId: '', // Corp permissions don't have group ID in this schema
				groupName: '',
				source: 'global', // 'corporation_scoped' is not in UserPermission type definition
				corporationId: groupPerm.corporationId,
				corporationName: corporationName || 'Unknown',
			} as any as UserPermission
		} else {
			return {
				...basePermission,
				source: groupPerm.permissionId ? 'global' : 'group_scoped',
			}
		}
	}

	/**
	 * Resolve all permissions user should receive based on their role in each group
	 */
	private resolveUserPermissions(
		groupPerms: any[],
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

			resolvedPermissions.push(this.buildUserPermission(gp))
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
		// Check cache first
		const cached = this.getCachedUserPermissions(userId)
		if (cached) {
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

			// Get user's admin roles and group permissions
			const [adminGroupIds, groupPerms] = await Promise.all([
				this.getUserAdminGroupIds(userId, groupIds),
				this.getGroupPermissionsForGroups(groupIds),
			])

			// Resolve permissions based on user's role in each group
			groupPermissions = this.resolveUserPermissions(groupPerms, userId, adminGroupIds)
		}

		// Resolve corporation permissions
		let corporationPermissions: UserPermission[] = []
		if (corporations.length > 0) {
			const corporationIds = corporations.map((c) => c.corporationId)
			const corporationNames = new Map(
				corporations.map((c) => [c.corporationId, c.corporationName])
			)

			corporationPermissions = await this.getCorporationPermissionsForCorporations(
				corporationIds,
				corporationNames
			)
		}

		// Combine group and corporation permissions
		const allPermissions = [...groupPermissions, ...corporationPermissions]

		// Deduplicate by URN (in case user has same permission from multiple groups or corporations)
		const deduped = this.deduplicatePermissionsByUrn(allPermissions)

		// Cache the result
		this.cacheUserPermissions(userId, deduped)

		return deduped
	}

	async getGroupMemberPermissions(groupId: string): Promise<GetGroupMemberPermissionsResponse> {
		// Get all members of the group
		const members = await this.ctx.db.query.groupMembers.findMany({
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
		const allMembers = await this.ctx.db.query.groupMembers.findMany({
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

	async getUserPermissionsBatch(userIds: string[]): Promise<Map<string, UserPermission[]>> {
		if (userIds.length === 0) {
			return new Map()
		}

		// Check cache and separate cached vs uncached users
		const result = new Map<string, UserPermission[]>()
		const uncachedUserIds: string[] = []

		for (const userId of userIds) {
			const cached = this.ctx.groupsDOCache.getCachedUserPermissions(userId)
			if (cached) {
				result.set(userId, cached)
			} else {
				uncachedUserIds.push(userId)
			}
		}

		// If all users were cached, return early
		if (uncachedUserIds.length === 0) {
			return result
		}

		// STEP 1: Batch fetch all group memberships for uncached users
		const allMemberships = await this.ctx.db.query.groupMembers.findMany({
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
		const coreStub = getStub<Core>(this.ctx.env.CORE, 'default') as unknown as CoreStub
		const [corporationsByUser] = await Promise.all([
			coreStub.getUserCorporationsBatch(uncachedUserIds),
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
				? this.ctx.db.query.groupAdmins.findMany({
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
			const cid = (cp as any).corporationId
			if (cid) {
				if (!corpPermsMap.has(cid)) {
					corpPermsMap.set(cid, [])
				}
				corpPermsMap.get(cid)!.push(cp)
			}
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
					groupPermissions.push(this.buildUserPermission(gp))
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
			this.ctx.groupsDOCache.cacheUserPermissions(userId, deduped)
			result.set(userId, deduped)
		}

		return result
	}

	/**
	 * ============================================
	 * MAPPING FUNCTIONS
	 * ============================================
	 */

	private mapGroup(group: typeof groupsTable.$inferSelect) {
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
			// @ts-ignore - category property might not be in Permission type depending on version, ignoring
			category: null,
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

	private mapCorporationPermission(cp: typeof corporationPermissions.$inferSelect) {
		return {
			id: cp.id,
			groupId: '', // Not in schema!
			corporationId: cp.corporationId,
			permissionId: cp.permissionId,
			customUrn: null, // Not in schema
			customName: null,
			customDescription: null,
			targetType: 'all_members' as PermissionTarget, // Default?
			createdBy: cp.createdBy,
			createdAt: cp.createdAt,
		}
	}
}
