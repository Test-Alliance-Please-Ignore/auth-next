import { and, eq, inArray } from '@repo/db-utils'

import {
	groupAdmins,
	groupInvitations,
	groupJoinRequests,
	groupMembers,
	groups,
} from '../db/schema'
import { bulkFindMainCharactersWithIdsByUserIds } from './character-lookup'
import { mapGroupMember } from './mappers'
import { canManageGroup, canModerateGroup, canViewGroupMembers } from './permissions'
import { isUserGroupAdmin, isUserMember } from './query-helpers'

import type { GroupMember, GroupMembershipSummary } from '@repo/groups'
import type { ServiceContext } from './context'

export class MembershipService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Cancel all pending join requests for a user in a specific group.
	 * This should be called whenever a user joins a group through any method
	 * (direct join, invitation acceptance, or request approval) to prevent
	 * showing stale join requests to group admins.
	 */
	private async _internalCancelPendingJoinRequests(groupId: string, userId: string): Promise<void> {
		await this.ctx.db
			.update(groupJoinRequests)
			.set({
				status: 'cancelled',
				respondedAt: new Date(),
				respondedBy: null,
			})
			.where(
				and(
					eq(groupJoinRequests.groupId, groupId),
					eq(groupJoinRequests.userId, userId),
					eq(groupJoinRequests.status, 'pending')
				)
			)
	}

	/**
	 * Cancel all pending invitations for a user in a specific group.
	 * This should be called whenever a user joins a group through any method
	 * (direct join, request approval, or invitation acceptance) to prevent
	 * showing stale invitations to users and admins.
	 */
	private async _internalCancelPendingInvitations(groupId: string, userId: string): Promise<void> {
		await this.ctx.db
			.update(groupInvitations)
			.set({
				status: 'cancelled',
				respondedAt: new Date(),
			})
			.where(
				and(
					eq(groupInvitations.groupId, groupId),
					eq(groupInvitations.inviteeUserId, userId),
					eq(groupInvitations.status, 'pending')
				)
			)
	}

	public async _cancelPendingJoinRequests(groupId: string, userId: string): Promise<void> {
		return this._internalCancelPendingJoinRequests(groupId, userId)
	}

	public async _cancelPendingInvitations(groupId: string, userId: string): Promise<void> {
		return this._internalCancelPendingInvitations(groupId, userId)
	}

	async transferOwnership(
		groupId: string,
		requestingUserId: string,
		newOwnerId: string,
		isAdmin: boolean = false
	): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
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
		const isNewOwnerMember = await isUserMember(this.ctx, groupId, newOwnerId)
		if (!isNewOwnerMember) {
			throw new Error('New owner must be a group member')
		}

		const oldOwnerId = group.ownerId

		// Remove new owner from admins list (owners don't need to be in admins table)
		await this.ctx.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, newOwnerId)))

		// Update group ownership
		await this.ctx.db.update(groups).set({ ownerId: newOwnerId }).where(eq(groups.id, groupId))

		// Always add old owner as admin after ownership transfer
		// Check if they're already in the admins table (edge case: they might have been added manually before transfer)
		const isAlreadyAdmin = await isUserGroupAdmin(this.ctx, groupId, oldOwnerId)
		if (!isAlreadyAdmin) {
			await this.ctx.db.insert(groupAdmins).values({
				groupId,
				userId: oldOwnerId,
			})
		}

		// Invalidate permissions cache for both old and new owners (their permissions may change)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(oldOwnerId)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(newOwnerId)
	}

	async joinGroup(groupId: string, userId: string): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Members must be added by a site admin.')
		}

		// Can only join open groups via this method
		if (group.joinMode !== 'open') {
			throw new Error('Group is not open for joining. Use join request or invitation.')
		}

		// Check if already a member
		const isMember = await isUserMember(this.ctx, groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add as member
		await this.ctx.db.insert(groupMembers).values({
			groupId,
			userId,
		})

		// Cancel any pending join requests from this user for this group
		await this._internalCancelPendingJoinRequests(groupId, userId)
		// Cancel any pending invitations for this user to this group
		await this._internalCancelPendingInvitations(groupId, userId)

		// Invalidate group members cache
		this.ctx.groupsDOCache.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they now have new permissions from this group)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(userId)
	}

	async leaveGroup(groupId: string, userId: string): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Members can only be removed by a site admin.')
		}

		// Owner cannot leave (must transfer ownership first)
		if (group.ownerId === userId) {
			throw new Error('Group owner cannot leave. Transfer ownership first.')
		}

		// Verify user is actually a member before attempting to remove
		const isMember = await isUserMember(this.ctx, groupId, userId)
		if (!isMember) {
			throw new Error('You are not a member of this group')
		}

		// Remove from admins if they are one
		await this.ctx.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, userId)))

		// Remove from members
		await this.ctx.db
			.delete(groupMembers)
			.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))

		// Invalidate group members cache
		this.ctx.groupsDOCache.invalidateGroupMembersCache(groupId)
		// Invalidate user's permissions cache (they lost permissions from this group)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(userId)
	}

	async removeMember(groupId: string, adminUserId: string, targetUserId: string): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await isUserGroupAdmin(this.ctx, groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can remove members')
		}

		// Cannot remove the owner
		if (group.ownerId === targetUserId) {
			throw new Error('Cannot remove the group owner')
		}

		// Remove from admins if they are one
		await this.ctx.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, targetUserId)))

		// Remove from members
		await this.ctx.db
			.delete(groupMembers)
			.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))

		// Invalidate group members cache
		this.ctx.groupsDOCache.invalidateGroupMembersCache(groupId)
		// Invalidate target user's permissions cache
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(targetUserId)
	}

	async getGroupMembers(groupId: string, userId: string, isAdmin: boolean): Promise<GroupMember[]> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isMember = await isUserMember(this.ctx, groupId, userId)
		const isGroupOwnerOrAdmin =
			group.ownerId === userId || (await isUserGroupAdmin(this.ctx, groupId, userId))

		if (!canViewGroupMembers(group, userId, isAdmin, isMember, isGroupOwnerOrAdmin)) {
			throw new Error('Not authorized to view group members')
		}

		const members = await this.ctx.db.query.groupMembers.findMany({
			where: eq(groupMembers.groupId, groupId),
			orderBy: (groupMembers, { asc }) => [asc(groupMembers.joinedAt)],
		})

		// Fetch main character names and IDs for all members
		const userIds = members.map((member) => member.userId)
		const characterData = await bulkFindMainCharactersWithIdsByUserIds(userIds, this.ctx.db)

		// Enrich members with character names and IDs
		return members.map((member) => {
			const charData = characterData.get(member.userId)
			return {
				...mapGroupMember(member),
				mainCharacterName: charData?.name,
				mainCharacterId: charData?.characterId,
			}
		})
	}

	async getUserMemberships(userId: string): Promise<GroupMembershipSummary[]> {
		const memberships = await this.ctx.db.query.groupMembers.findMany({
			where: eq(groupMembers.userId, userId),
			with: {
				group: {
					with: {
						category: true,
					},
				},
			},
		})

		if (memberships.length === 0) {
			return []
		}

		// Batch fetch all admin records for this user across all their groups
		const groupIds = memberships.map((m) => m.groupId)
		const adminRecords = await this.ctx.db.query.groupAdmins.findMany({
			where: and(eq(groupAdmins.userId, userId), inArray(groupAdmins.groupId, groupIds)),
		})
		const adminGroupIds = new Set(adminRecords.map((a) => a.groupId))

		return memberships.map((membership) => ({
			groupId: membership.groupId,
			groupName: membership.group.name,
			categoryName: membership.group.category.name,
			joinMode: membership.group.joinMode,
			isOwner: membership.group.ownerId === userId,
			isAdmin: adminGroupIds.has(membership.groupId),
			mumbleSyncEnabled: membership.group.mumbleSyncEnabled,
			mumbleTicker: membership.group.mumbleTicker,
			joinedAt: membership.joinedAt,
		}))
	}

	async addAdmin(
		groupId: string,
		ownerId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId, isGlobalAdmin)) {
			throw new Error('Only the group owner or site admins can add admins')
		}

		// Target must be a member
		const isMember = await isUserMember(this.ctx, groupId, targetUserId)
		if (!isMember) {
			throw new Error('User must be a group member to become an admin')
		}

		// Check if already an admin - if so, operation is idempotent (just return success)
		const isAlreadyAdmin = await isUserGroupAdmin(this.ctx, groupId, targetUserId)
		if (isAlreadyAdmin) {
			return // Already an admin, nothing to do
		}

		// Add as admin
		await this.ctx.db.insert(groupAdmins).values({
			groupId,
			userId: targetUserId,
		})

		// Invalidate target user's permissions cache (admin status may grant new permissions)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(targetUserId)
	}

	async removeAdmin(
		groupId: string,
		ownerId: string,
		targetUserId: string,
		isGlobalAdmin: boolean = false
	): Promise<void> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (!canManageGroup(group, ownerId, isGlobalAdmin)) {
			throw new Error('Only the group owner or site admins can remove admins')
		}

		await this.ctx.db
			.delete(groupAdmins)
			.where(and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, targetUserId)))

		// Invalidate target user's permissions cache (they may lose admin-only permissions)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(targetUserId)
	}

	async isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
		return isUserGroupAdmin(this.ctx, groupId, userId)
	}
}
