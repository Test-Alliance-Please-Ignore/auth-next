import { and, eq, inArray } from '@repo/db-utils'
import type {
	CreateJoinRequestRequest,
	GroupJoinRequest,
	GroupJoinRequestWithDetails,
} from '@repo/groups'
import { groupInvitations, groupJoinRequests, groupMembers, groups } from '../db/schema'
import { bulkFindMainCharactersByUserIds } from './character-lookup'
import { mapGroupJoinRequest } from './mappers'
import { canModerateGroup } from './permissions'
import { isUserGroupAdmin, isUserMember } from './query-helpers'

import type { MembershipService } from './membership-service' // Needs to access MembershipService for cancel methods
import type { ServiceContext } from './context'

export class JoinRequestService {
	constructor(
		private ctx: ServiceContext,
		private membershipService: MembershipService // Injected to call cancellation methods
	) {}

	async createJoinRequest(
		data: CreateJoinRequestRequest,
		userId: string
	): Promise<GroupJoinRequest> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, data.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		// Can only create join requests for approval-mode groups
		if (group.joinMode !== 'approval') {
			throw new Error('Group does not accept join requests')
		}

		// Check if already a member
		const isMember = await isUserMember(this.ctx, data.groupId, userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Check for existing pending request
		const existingRequest = await this.ctx.db.query.groupJoinRequests.findFirst({
			where: and(
				eq(groupJoinRequests.groupId, data.groupId),
				eq(groupJoinRequests.userId, userId),
				eq(groupJoinRequests.status, 'pending')
			),
		})

		if (existingRequest) {
			throw new Error('You already have a pending join request for this group')
		}

		const [request] = await this.ctx.db
			.insert(groupJoinRequests)
			.values({
				groupId: data.groupId,
				userId,
				reason: data.reason || null,
				status: 'pending',
			})
			.returning()

		return mapGroupJoinRequest(request)
	}

	async listJoinRequests(
		groupId: string,
		adminUserId: string
	): Promise<GroupJoinRequestWithDetails[]> {
		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await isUserGroupAdmin(this.ctx, groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can view join requests')
		}

		const requests = await this.ctx.db.query.groupJoinRequests.findMany({
			where: and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, 'pending')),
			orderBy: (groupJoinRequests, { desc }) => [desc(groupJoinRequests.createdAt)],
		})

		if (requests.length === 0) {
			return []
		}

		// Fetch main character names for all requesting users
		const userIds = requests.map((req) => req.userId)
		const characterNames = await bulkFindMainCharactersByUserIds(userIds, this.ctx.db)

		// Enrich requests with user character names
		return requests.map((req) => ({
			...mapGroupJoinRequest(req),
			userMainCharacterName: characterNames.get(req.userId) || undefined,
		}))
	}

	async approveJoinRequest(requestId: string, adminUserId: string): Promise<void> {
		const request = await this.ctx.db.query.groupJoinRequests.findFirst({
			where: eq(groupJoinRequests.id, requestId),
		})

		if (!request) {
			throw new Error('Join request not found')
		}

		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, request.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await isUserGroupAdmin(this.ctx, request.groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can approve join requests')
		}

		if (request.status !== 'pending') {
			throw new Error('Join request is not pending')
		}

		// Check if already a member
		const isMember = await isUserMember(this.ctx, request.groupId, request.userId)
		if (isMember) {
			throw new Error('Already a member of this group')
		}

		// Add user as member
		await this.ctx.db.insert(groupMembers).values({
			groupId: request.groupId,
			userId: request.userId,
		})

		// Update this request status to approved
		await this.ctx.db
			.update(groupJoinRequests)
			.set({
				status: 'approved',
				respondedAt: new Date(),
				respondedBy: adminUserId,
			})
			.where(eq(groupJoinRequests.id, requestId))

		// Cancel any OTHER pending join requests from this user for this group
		// (The approved one has already been updated above)
		await this.membershipService._cancelPendingJoinRequests(request.groupId, request.userId)
		// Cancel any pending invitations for this user to this group
		await this.membershipService._cancelPendingInvitations(request.groupId, request.userId)

		// Invalidate group members cache
		this.ctx.groupsDOCache.invalidateGroupMembersCache(request.groupId)
		// Invalidate user's permissions cache (they now have permissions from this group)
		this.ctx.groupsDOCache.invalidateUserPermissionsCache(request.userId)
	}

	async denyJoinRequest(requestId: string, adminUserId: string): Promise<void> {
		const request = await this.ctx.db.query.groupJoinRequests.findFirst({
			where: eq(groupJoinRequests.id, requestId),
		})

		if (!request) {
			throw new Error('Join request not found')
		}

		const group = await this.ctx.db.query.groups.findFirst({
			where: eq(groups.id, request.groupId),
		})

		if (!group) {
			throw new Error('Group not found')
		}

		const isAdmin = await isUserGroupAdmin(this.ctx, request.groupId, adminUserId)

		if (!canModerateGroup(group, adminUserId, isAdmin)) {
			throw new Error('Only group owner or admins can deny join requests')
		}

		if (request.status !== 'pending') {
			throw new Error('Join request is not pending')
		}

		// Update this request status to denied
		await this.ctx.db
			.update(groupJoinRequests)
			.set({
				status: 'rejected',
				respondedAt: new Date(),
				respondedBy: adminUserId,
			})
			.where(eq(groupJoinRequests.id, requestId))
	}
}
