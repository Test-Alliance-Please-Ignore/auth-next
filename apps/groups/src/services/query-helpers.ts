import { and, eq, sql } from '@repo/db-utils'

import { groupAdmins, groupMembers } from '../db/schema'

import type { ServiceContext } from './context'

export async function isUserMember(
	ctx: ServiceContext,
	groupId: string,
	userId: string
): Promise<boolean> {
	const membership = await ctx.db.query.groupMembers.findFirst({
		where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
	})
	return !!membership
}

export async function isUserGroupAdmin(
	ctx: ServiceContext,
	groupId: string,
	userId: string
): Promise<boolean> {
	const admin = await ctx.db.query.groupAdmins.findFirst({
		where: and(eq(groupAdmins.groupId, groupId), eq(groupAdmins.userId, userId)),
	})
	return !!admin
}

export async function getGroupMemberCount(ctx: ServiceContext, groupId: string): Promise<number> {
	const result = await ctx.db
		.select({ count: sql<number>`count(*)::int` })
		.from(groupMembers)
		.where(eq(groupMembers.groupId, groupId))
	return result[0]?.count ?? 0
}
