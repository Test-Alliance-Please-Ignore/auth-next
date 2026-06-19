import type {
	Category,
	Group,
	GroupInvitation,
	GroupInviteCode,
	GroupJoinRequest,
	GroupMember,
} from '@repo/groups'
import type {
	categories,
	groupInvitations,
	groupInviteCodes,
	groupJoinRequests,
	groupMembers,
	groups,
} from '../db/schema'

export function mapCategory(cat: typeof categories.$inferSelect): Category {
	return {
		id: cat.id,
		name: cat.name,
		description: cat.description,
		visibility: cat.visibility,
		allowGroupCreation: cat.allowGroupCreation,
		createdAt: cat.createdAt,
		updatedAt: cat.updatedAt,
	}
}

export function mapGroup(group: typeof groups.$inferSelect): Group {
	return {
		id: group.id,
		categoryId: group.categoryId,
		name: group.name,
		description: group.description,
		visibility: group.visibility,
		joinMode: group.joinMode,
		mumbleSyncEnabled: group.mumbleSyncEnabled,
		ownerId: group.ownerId,
		createdAt: group.createdAt,
		updatedAt: group.updatedAt,
	}
}

export function mapGroupMember(member: typeof groupMembers.$inferSelect): GroupMember {
	return {
		id: member.id,
		groupId: member.groupId,
		userId: member.userId,
		joinedAt: member.joinedAt,
	}
}

export function mapGroupJoinRequest(req: typeof groupJoinRequests.$inferSelect): GroupJoinRequest {
	return {
		id: req.id,
		groupId: req.groupId,
		userId: req.userId,
		reason: req.reason,
		status: req.status,
		createdAt: req.createdAt,
		respondedAt: req.respondedAt,
		respondedBy: req.respondedBy,
	}
}

export function mapGroupInvitation(inv: typeof groupInvitations.$inferSelect): GroupInvitation {
	return {
		id: inv.id,
		groupId: inv.groupId,
		inviterId: inv.inviterId,
		inviteeMainCharacterId: inv.inviteeMainCharacterId,
		inviteeUserId: inv.inviteeUserId,
		status: inv.status,
		expiresAt: inv.expiresAt,
		createdAt: inv.createdAt,
		respondedAt: inv.respondedAt,
	}
}

export function mapGroupInviteCode(code: typeof groupInviteCodes.$inferSelect): GroupInviteCode {
	return {
		id: code.id,
		groupId: code.groupId,
		code: code.code,
		createdBy: code.createdBy,
		maxUses: code.maxUses,
		currentUses: code.currentUses,
		expiresAt: code.expiresAt,
		createdAt: code.createdAt,
		revokedAt: code.revokedAt,
	}
}
