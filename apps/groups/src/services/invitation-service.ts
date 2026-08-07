import { and, eq } from '@repo/db-utils'

import {
	groupInvitations,
	groupInviteCodeRedemptions,
	groupInviteCodes,
	groupMembers,
	groups,
} from '../db/schema'
import { bulkFindMainCharactersByUserIds, findUserByMainCharacterName } from './character-lookup'
import { generateInviteCode } from './code-generator'
import { mapCategory, mapGroup, mapGroupInvitation, mapGroupInviteCode } from './mappers'
import { canManageGroup, canModerateGroup } from './permissions'
import { getGroupMemberCount, isUserGroupAdmin, isUserMember } from './query-helpers'

import type {
	CreateInvitationRequest,
	CreateInviteCodeRequest,
	CreateInviteCodeResponse,
	Group,
	GroupByInviteCodeResponse,
	GroupInvitation,
	GroupInvitationWithDetails,
	GroupInviteCode,
	GroupWithDetails,
	RedeemInviteCodeResponse,
} from '@repo/groups'
import type { ServiceContext } from './context'
import type { MembershipService } from './membership-service'

export class InvitationService {
	constructor(
		private ctx: ServiceContext,
		private membershipService: MembershipService
	) {}

	async createInvitation(
		data: CreateInvitationRequest,
		inviterId: string
	): Promise<GroupInvitation> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Members must be added by a site admin.')
		}

		const inviterIsAdmin = await isUserGroupAdmin(this.ctx, data.groupId, inviterId)

		if (!canModerateGroup(group, inviterId, inviterIsAdmin)) {
			throw new Error('Only group owner or admins can create invitations')
		}

		// Ensure invitee has a main character and get their user ID
		const inviteeUser = await findUserByMainCharacterName(data.characterName, this.ctx.db)
		if (!inviteeUser) {
			throw new Error('Invitee user does not have a main character')
		}
		const inviteeUserId = inviteeUser.userId
		const inviteeMainCharacterId = inviteeUser.characterId

		// Ensure invitee is not already a member
		const isMember = await isUserMember(this.ctx, data.groupId, inviteeUserId)
		if (isMember) {
			throw new Error('Invitee is already a member of this group')
		}

		// Check for existing pending invitation
		const existingInvitation = await this.ctx.db.query.groupInvitations.findFirst({
			where: and(
				eq(groupInvitations.groupId, data.groupId),
				eq(groupInvitations.inviteeUserId, inviteeUserId),
				eq(groupInvitations.status, 'pending')
			),
		})

		if (existingInvitation) {
			throw new Error('User already has a pending invitation to this group')
		}

		// Calculate expiresAt (default 7 days)
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

		const [invitation] = await this.ctx.db
			.insert(groupInvitations)
			.values({
				groupId: data.groupId,
				inviterId,
				inviteeUserId: inviteeUserId,
				inviteeMainCharacterId: inviteeMainCharacterId,
				status: 'pending',
				expiresAt,
			})
			.returning()

		return mapGroupInvitation(invitation)
	}

	async listPendingInvitations(userId: string): Promise<GroupInvitationWithDetails[]> {
		const invitations = await this.ctx.db.query.groupInvitations.findMany({
			where: and(
				eq(groupInvitations.inviteeUserId, userId),
				eq(groupInvitations.status, 'pending')
			),
			with: {
				group: true,
			},
			orderBy: (groupInvitations, { desc }) => [desc(groupInvitations.createdAt)],
		})

		if (invitations.length === 0) {
			return []
		}

		// Fetch inviter names
		const inviterIds = invitations.map((inv) => inv.inviterId)
		const inviterNames = await bulkFindMainCharactersByUserIds(inviterIds, this.ctx.db)

		return invitations.map((inv) => ({
			...mapGroupInvitation(inv),
			group: inv.group
				? {
						id: inv.group.id,
						name: inv.group.name,
						description: inv.group.description,
						visibility: inv.group.visibility,
					}
				: ({} as Pick<Group, 'id' | 'name' | 'description' | 'visibility'>), // Fallback, though 'group' should always be there due to 'with'
			inviterName: inviterNames.get(inv.inviterId),
		}))
	}

	async acceptInvitation(invitationId: string, userId: string): Promise<void> {
		const invitation = await this.ctx.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
			with: {
				group: true,
			},
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== userId) {
			throw new Error('You are not the intended recipient of this invitation')
		}

		if (invitation.status !== 'pending') {
			throw new Error('Invitation is not pending')
		}

		if (invitation.group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Members must be added by a site admin.')
		}

		if (invitation.expiresAt && invitation.expiresAt < new Date()) {
			throw new Error('Invitation has expired')
		}

		// Ensure user is not already a member (e.g. they joined directly after invite)
		const isMember = await isUserMember(this.ctx, invitation.groupId, userId)
		if (isMember) {
			// Mark invitation as accepted anyway, even if already member, to avoid confusion.
			// It's not an error to accept an invite if you're already a member.
			// We won't re-add them to the group.
			await this.ctx.db
				.update(groupInvitations)
				.set({
					status: 'accepted',
					respondedAt: new Date(),
				})
				.where(eq(groupInvitations.id, invitationId))
			return
		}

		// Add user to group
		await this.ctx.db.insert(groupMembers).values({
			groupId: invitation.groupId,
			userId,
		})

		// Update invitation status
		await this.ctx.db
			.update(groupInvitations)
			.set({
				status: 'accepted',
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))

		// Cancel any pending join requests from this user for this group
		await this.membershipService._cancelPendingJoinRequests(invitation.groupId, userId)
		// Invalidate caches
		this.ctx.groupsDOCache.invalidateGroupMembersCache(invitation.groupId)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(userId)
	}

	async denyInvitation(invitationId: string, userId: string): Promise<void> {
		const invitation = await this.ctx.db.query.groupInvitations.findFirst({
			where: eq(groupInvitations.id, invitationId),
		})

		if (!invitation) {
			throw new Error('Invitation not found')
		}

		if (invitation.inviteeUserId !== userId) {
			throw new Error('You are not the intended recipient of this invitation')
		}

		if (invitation.status !== 'pending') {
			throw new Error('Invitation is not pending')
		}

		// Update invitation status
		await this.ctx.db
			.update(groupInvitations)
			.set({
				status: 'declined', // Changed from 'denied' to 'declined'
				respondedAt: new Date(),
			})
			.where(eq(groupInvitations.id, invitationId))
	}

	async createInviteCode(
		data: CreateInviteCodeRequest,
		createdBy: string
	): Promise<CreateInviteCodeResponse> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Invite codes are disabled.')
		}

		const creatorIsAdmin = await isUserGroupAdmin(this.ctx, data.groupId, createdBy)

		if (!canManageGroup(group, createdBy, creatorIsAdmin)) {
			throw new Error('Only group owner or admins can create invite codes')
		}

		const code = generateInviteCode()
		const expiresAt = new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)

		const [inviteCode] = await this.ctx.db
			.insert(groupInviteCodes)
			.values({
				groupId: data.groupId,
				code,
				createdBy,
				maxUses: data.maxUses || null,
				expiresAt,
			})
			.returning()

		return {
			code: mapGroupInviteCode(inviteCode),
			url: `${this.ctx.env.PUBLIC_URL}/invite/${inviteCode.code}`,
		}
	}

	async listInviteCodes(groupId: string, userId: string): Promise<GroupInviteCode[]> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		if (group.joinMode === 'admin_managed') {
			throw new Error('This group is admin managed. Invite codes are disabled.')
		}

		const isAdmin = await isUserGroupAdmin(this.ctx, groupId, userId)

		if (!canManageGroup(group, userId, isAdmin)) {
			throw new Error('Only group owner or admins can view invite codes')
		}

		const inviteCodes = await this.ctx.db.query.groupInviteCodes.findMany({
			where: eq(groupInviteCodes.groupId, groupId),
			orderBy: (groupInviteCodes, { desc }) => [desc(groupInviteCodes.createdAt)],
		})

		return inviteCodes.map(mapGroupInviteCode)
	}

	async revokeInviteCode(codeId: string, revokedBy: string): Promise<void> {
		const inviteCode = await this.ctx.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.id, codeId),
		})

		if (!inviteCode) {
			throw new Error('Invite code not found')
		}

		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, inviteCode.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const revokerIsAdmin = await isUserGroupAdmin(this.ctx, group.id, revokedBy)

		if (!canManageGroup(group, revokedBy, revokerIsAdmin)) {
			throw new Error('Only group owner or admins can revoke invite codes')
		}

		await this.ctx.db
			.update(groupInviteCodes)
			.set({ revokedAt: new Date() })
			.where(eq(groupInviteCodes.id, codeId))
	}

	async getGroupByInviteCode(
		code: string,
		userId: string
	): Promise<GroupByInviteCodeResponse | null> {
		const inviteCode = await this.ctx.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.code, code),
			with: {
				group: {
					with: {
						category: true,
					},
				},
			},
		})

		if (!inviteCode) {
			return null // Return null if invite code not found
		}

		if (inviteCode.group.joinMode === 'admin_managed') {
			return {
				group: {
					...mapGroup(inviteCode.group),
					category: mapCategory(inviteCode.group.category),
					memberCount: await getGroupMemberCount(this.ctx, inviteCode.group.id),
					isOwner: userId ? inviteCode.group.ownerId === userId : false,
					isAdmin: userId ? await isUserGroupAdmin(this.ctx, inviteCode.group.id, userId) : false,
					isMember: userId ? await isUserMember(this.ctx, inviteCode.group.id, userId) : false,
				},
				inviteCode: {
					isValid: false,
					isExpired: false,
					isRevoked: false,
					hasRemainingUses: true,
					expiresAt: inviteCode.expiresAt,
				},
				canJoin: false,
				errorMessage: 'This group is admin managed and cannot be joined with an invite code',
			}
		}

		const now = new Date()
		const isExpired = inviteCode.expiresAt && inviteCode.expiresAt < now
		const isRevoked = inviteCode.revokedAt !== null
		const hasRemainingUses =
			inviteCode.maxUses === null || inviteCode.currentUses < inviteCode.maxUses
		const isValid = !isExpired && !isRevoked && hasRemainingUses

		// Build group details directly (bypass permission checks since invite code is the authorization)
		const group = inviteCode.group
		const category = inviteCode.group.category

		// Get member count
		const memberCount = await getGroupMemberCount(this.ctx, group.id)

		// Check user's relationship to the group
		let isOwner = false
		let isAdmin = false
		let isMember = false

		if (userId) {
			isOwner = group.ownerId === userId
			isAdmin = await isUserGroupAdmin(this.ctx, group.id, userId)
			isMember = await isUserMember(this.ctx, group.id, userId)
		}

		const groupDetails: GroupWithDetails = {
			...mapGroup(group),
			category: mapCategory(category),
			memberCount,
			isOwner,
			isAdmin,
			isMember,
		}

		// Check if user can join
		let canJoin = isValid
		let errorMessage: string | undefined

		if (userId) {
			if (isMember) {
				canJoin = false
				errorMessage = 'You are already a member of this group'
			}

			// Check if already redeemed this code
			const existingRedemption = await this.ctx.db.query.groupInviteCodeRedemptions.findFirst({
				where: and(
					eq(groupInviteCodeRedemptions.inviteCodeId, inviteCode.id),
					eq(groupInviteCodeRedemptions.userId, userId)
				),
			})

			if (existingRedemption) {
				canJoin = false
				errorMessage = 'You have already redeemed this invite code'
			}
		}

		if (!isValid) {
			if (isRevoked) {
				errorMessage = 'This invite code has been revoked'
			} else if (isExpired) {
				errorMessage = 'This invite code has expired'
			} else if (!hasRemainingUses) {
				errorMessage = 'This invite code has reached its usage limit'
			}
		}

		return {
			group: groupDetails,
			inviteCode: {
				isValid,
				isExpired,
				isRevoked,
				hasRemainingUses,
				expiresAt: inviteCode.expiresAt,
			},
			canJoin,
			errorMessage,
		}
	}

	async redeemInviteCode(code: string, userId: string): Promise<RedeemInviteCodeResponse> {
		const inviteCode = await this.ctx.db.query.groupInviteCodes.findFirst({
			where: eq(groupInviteCodes.code, code),
			with: {
				group: true,
			},
		})

		if (!inviteCode) {
			return { success: false, message: 'Invalid invite code' } // group is optional now
		}

		const group = inviteCode.group

		if (group.joinMode === 'admin_managed') {
			return {
				success: false,
				group: mapGroup(group),
				message: 'This group is admin managed. Members must be added by a site admin.',
			}
		}

		// Check if user is already a member
		const isMember = await isUserMember(this.ctx, group.id, userId)
		if (isMember) {
			return {
				success: false,
				group: mapGroup(group),
				message: `You are already a member of ${group.name}`,
			}
		}

		// Check code validity (should have been checked by getGroupByInviteCode already if coming from client)
		const now = new Date()
		if (inviteCode.expiresAt && inviteCode.expiresAt < now) {
			return { success: false, message: 'Invite code has expired' }
		}
		if (inviteCode.revokedAt !== null) {
			return { success: false, message: 'Invite code has been revoked' }
		}
		if (inviteCode.maxUses !== null && inviteCode.currentUses >= inviteCode.maxUses) {
			return { success: false, message: 'Invite code has reached its usage limit' }
		}

		// Check if already redeemed this code
		const existingRedemption = await this.ctx.db.query.groupInviteCodeRedemptions.findFirst({
			where: and(
				eq(groupInviteCodeRedemptions.inviteCodeId, inviteCode.id),
				eq(groupInviteCodeRedemptions.userId, userId)
			),
		})

		if (existingRedemption) {
			return { success: false, message: 'You have already redeemed this invite code' }
		}

		// Track redemption
		await this.ctx.db.insert(groupInviteCodeRedemptions).values({
			inviteCodeId: inviteCode.id,
			userId,
		})

		// Increment usage count
		await this.ctx.db
			.update(groupInviteCodes)
			.set({ currentUses: inviteCode.currentUses + 1 })
			.where(eq(groupInviteCodes.id, inviteCode.id))

		// Add user to group
		await this.ctx.db.insert(groupMembers).values({
			groupId: inviteCode.groupId,
			userId,
		})

		// Cancel any pending join requests from this user for this group
		await this.membershipService._cancelPendingJoinRequests(inviteCode.groupId, userId)
		// Cancel any pending invitations for this user to this group
		await this.membershipService._cancelPendingInvitations(inviteCode.groupId, userId)

		// Invalidate group members cache
		this.ctx.groupsDOCache.invalidateGroupMembersCache(inviteCode.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(userId)

		return {
			success: true,
			group: mapGroup(inviteCode.group),
			message: `Successfully joined ${inviteCode.group.name}`,
		}
	}
}
