import { and, eq, inArray, sql } from '@repo/db-utils'

import { categories, groupAdmins, groupJoinRequests, groupMembers, groups } from '../db/schema'
import { bulkFindMainCharactersByUserIds } from './character-lookup'
import { mapCategory, mapGroup } from './mappers'
import {
	canCreateGroupInCategory,
	canManageGroup,
	canViewCategory,
	canViewGroup,
} from './permissions'
import { getGroupMemberCount, isUserGroupAdmin, isUserMember } from './query-helpers'
import { GROUPS_WITH_DISCORD_CACHE_KEY } from './groups-do-cache'

import type {
	CreateGroupRequest,
	Group,
	GroupWithDetails,
	ListGroupsFilters,
	UpdateGroupRequest,
} from '@repo/groups'
import type { ServiceContext } from './context'

function normalizeMumbleTicker(ticker?: string | null): string | null {
	const trimmed = ticker?.trim()
	if (!trimmed) {
		return null
	}

	const normalized = trimmed.toUpperCase()
	if (!/^[A-Z0-9]{1,5}$/.test(normalized)) {
		throw new Error('Mumble ticker must be 1 to 5 alphanumeric characters')
	}

	return normalized
}

function hasMumbleSettingsInput(data: {
	mumbleSyncEnabled?: boolean
	mumbleTicker?: string | null
}): boolean {
	return data.mumbleSyncEnabled !== undefined || data.mumbleTicker !== undefined
}

function hasSiteAdminOnlyGroupSettingsInput(data: {
	joinMode?: CreateGroupRequest['joinMode'] | UpdateGroupRequest['joinMode']
}): boolean {
	return data.joinMode === 'admin_managed'
}

export class GroupService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Invalidate the groups with Discord attachment cache in DO storage
	 * Note: This duplicates logic from the DO, but we can't easily access the DO's private method.
	 * We should consider moving this to a shared cache service eventually.
	 */
	private async invalidateGroupsWithDiscordCache(): Promise<void> {
		await this.ctx.state.storage.delete(GROUPS_WITH_DISCORD_CACHE_KEY)
	}

	/**
	 * Invalidate the group members cache for a specific group
	 */
	private invalidateGroupMembersCache(groupId: string): void {
		// Accessing the cache directly from the DO would be ideal, but we can't.
		// For now, we'll leave this as a no-op and rely on the DO to handle member cache invalidation
		// via its own methods or refactor the cache into a shared service.
		// TODO: Refactor cache management
	}

	async createGroup(data: CreateGroupRequest, userId: string, isAdmin: boolean): Promise<Group> {
		// Validate category exists and user can create groups in it
		const category = await this.ctx.db.query.categories.findFirst({
			where: eq(categories.id, data.categoryId),
		})

		if (!category) {
			throw new Error('Category not found')
		}

		if (!canCreateGroupInCategory(category, userId, isAdmin)) {
			throw new Error('Not allowed to create groups in this category')
		}

		if (!isAdmin && hasMumbleSettingsInput(data)) {
			throw new Error('Only site admins can configure Mumble settings')
		}

		if (!isAdmin && hasSiteAdminOnlyGroupSettingsInput(data)) {
			throw new Error('Only site admins can configure admin-managed groups')
		}

		// Create the group
		const [group] = await this.ctx.db
			.insert(groups)
			.values({
				categoryId: data.categoryId,
				name: data.name,
				description: data.description || null,
				visibility: data.visibility || 'public',
				joinMode: data.joinMode || 'open',
				mumbleSyncEnabled: data.mumbleSyncEnabled ?? false,
				mumbleTicker: normalizeMumbleTicker(data.mumbleTicker),
				ownerId: userId,
			})
			.returning()

		// Automatically add creator as member
		await this.ctx.db.insert(groupMembers).values({
			groupId: group.id,
			userId,
		})

		// Add creator as admin (optional, but good practice for default permissions)
		await this.ctx.db.insert(groupAdmins).values({
			groupId: group.id,
			userId,
		})

		return mapGroup(group)
	}

	async listGroups(
		filters: ListGroupsFilters,
		userId: string,
		isAdmin: boolean
	): Promise<GroupWithDetails[]> {
		const { categoryId } = filters

		// 1. Get groups based on filters
		let groupsQuery = this.ctx.db.query.groups.findMany({
			with: {
				category: true,
			},
			orderBy: (groups, { asc }) => [asc(groups.name)],
			where: categoryId ? eq(groups.categoryId, categoryId) : undefined,
		})

		const allGroups = await groupsQuery

		if (allGroups.length === 0) {
			return []
		}

		// 2. Batch fetch user memberships for permission checking
		const allGroupIds = allGroups.map((g) => g.id)
		const memberships = await this.ctx.db.query.groupMembers.findMany({
			where: and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, allGroupIds)),
		})
		const memberGroupIds = new Set(memberships.map((m) => m.groupId))

		// 3. Batch fetch admin status
		const adminRecords = await this.ctx.db.query.groupAdmins.findMany({
			where: and(eq(groupAdmins.userId, userId), inArray(groupAdmins.groupId, allGroupIds)),
		})
		const adminGroupIds = new Set(adminRecords.map((a) => a.groupId))

		// 4. Batch fetch member counts
		const memberCounts = await this.ctx.db
			.select({
				groupId: groupMembers.groupId,
				count: sql<number>`count(*)::int`,
			})
			.from(groupMembers)
			.where(inArray(groupMembers.groupId, allGroupIds))
			.groupBy(groupMembers.groupId)

		const memberCountMap = new Map(memberCounts.map((r) => [r.groupId, r.count]))

		// 5. Filter and map results
		const result: GroupWithDetails[] = []
		const groupsToCheck = allGroups.filter((g) => {
			// First check if user can view the category
			return canViewCategory(g.category, userId, isAdmin)
		})

		for (const group of groupsToCheck) {
			const isMember = memberGroupIds.has(group.id)

			if (canViewGroup(group, userId, isAdmin, isMember)) {
				const isOwner = group.ownerId === userId
				const isAdminOfGroup = adminGroupIds.has(group.id)
				const memberCount = memberCountMap.get(group.id) || 0

				result.push({
					...mapGroup(group),
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

	async getGroup(id: string, userId: string, isAdmin: boolean): Promise<GroupWithDetails | null> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, id),
			with: {
				category: true,
			},
		})

		if (!group) return null

		const isMember = await isUserMember(this.ctx, id, userId)

		if (!canViewGroup(group, userId, isAdmin, isMember)) {
			return null
		}

		const isOwner = group.ownerId === userId

		// Parallelize independent queries for better performance
		const [isAdminOfGroup, memberCount, admins, characterNames, pendingRequest] = await Promise.all(
			[
				isUserGroupAdmin(this.ctx, id, userId),
				getGroupMemberCount(this.ctx, id),
				this.ctx.db.query.groupAdmins.findMany({
					where: eq(groupAdmins.groupId, id),
				}),
				bulkFindMainCharactersByUserIds([group.ownerId], this.ctx.db),
				this.ctx.db.query.groupJoinRequests.findFirst({
					where: and(
						eq(groupJoinRequests.groupId, id),
						eq(groupJoinRequests.userId, userId),
						eq(groupJoinRequests.status, 'pending')
					),
				}),
			]
		)

		const adminUserIds = admins.map((admin) => admin.userId)
		const ownerName = characterNames.get(group.ownerId)

		return {
			...mapGroup(group),
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

	async updateGroup(
		id: string,
		data: UpdateGroupRequest,
		userId: string,
		isAdmin = false
	): Promise<Group> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Site admins can update any group, otherwise must be the owner
		if (!isAdmin && !canManageGroup(group, userId)) {
			throw new Error('Only the group owner or site admins can update the group')
		}

		// Validate category exists if categoryId is being updated
		if (data.categoryId !== undefined) {
			const category = await this.ctx.db.query.categories.findFirst({
				where: eq(categories.id, data.categoryId),
			})

			if (!category) {
				throw new Error('Category not found')
			}
		}

		if (!isAdmin && hasMumbleSettingsInput(data)) {
			throw new Error('Only site admins can configure Mumble settings')
		}

		if (!isAdmin && hasSiteAdminOnlyGroupSettingsInput(data)) {
			throw new Error('Only site admins can configure admin-managed groups')
		}

		const updates: Partial<typeof groups.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.visibility !== undefined) updates.visibility = data.visibility
		if (data.joinMode !== undefined) updates.joinMode = data.joinMode
		if (data.mumbleSyncEnabled !== undefined) updates.mumbleSyncEnabled = data.mumbleSyncEnabled
		if (data.mumbleTicker !== undefined) updates.mumbleTicker = normalizeMumbleTicker(data.mumbleTicker)
		if (data.categoryId !== undefined) updates.categoryId = data.categoryId
		updates.updatedAt = new Date()

		const [updated] = await this.ctx.db
			.update(groups)
			.set(updates)
			.where(eq(groups.id, id))
			.returning()

		if (!updated) {
			throw new Error('Failed to update group')
		}

		// Invalidate cache if visibility or name changed, as it affects discord integration
		if (data.visibility || data.name) {
			await this.invalidateGroupsWithDiscordCache()
		}

		return mapGroup(updated)
	}

	async deleteGroup(id: string, userId: string, isAdmin = false): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, id),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Site admins can delete any group, otherwise must be the owner
		if (!isAdmin && !canManageGroup(group, userId)) {
			throw new Error('Only the group owner or site admins can delete the group')
		}

		// CASCADE will delete all members, admins, invitations, etc.
		await this.ctx.db.delete(groups).where(eq(groups.id, id))

		// Invalidate caches
		await this.invalidateGroupsWithDiscordCache()
		this.invalidateGroupMembersCache(id)
	}
}
