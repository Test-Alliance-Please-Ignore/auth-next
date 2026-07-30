import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { eq } from '@repo/db-utils'
import { getDiscordStub } from '@repo/discord'
import { getStub } from '@repo/do-utils'

import { discordRoles, users } from '../db/schema'
import { getCachedUserRoles } from '../lib/groups-cache'
import { parseDiscordDurationSeconds } from './discord-duration'

import type { DbClient } from '@repo/db-utils'
import type { Env } from '../context'
import type * as schema from '../db/schema'
import type {
	TemporaryRoleAssignment,
	TemporaryRoleAssignments,
	TemporaryRoleAssignmentSource,
} from '../temporary-role-assignments-do'

export interface TemporaryRoleCommandRole {
	roleDbId: string
	roleId: string
	roleName: string
	displayName: string
	defaultDurationSeconds: number | null
}

async function rollbackTemporaryAssignment(
	assignments: TemporaryRoleAssignments,
	guildId: string,
	assignment: TemporaryRoleAssignment,
	previousAssignment: TemporaryRoleAssignment | undefined
): Promise<void> {
	if (previousAssignment) {
		await assignments.restoreAssignment(
			guildId,
			assignment.id,
			assignment.revision,
			previousAssignment
		)
		return
	}
	await assignments.deleteAssignment(guildId, assignment.id, assignment.revision)
}

export async function hasAllianceMemberRole(
	env: Pick<Env, 'GROUPS'>,
	userId: string
): Promise<boolean> {
	const roles = await getCachedUserRoles(env, userId)
	return roles.some((attachment) => attachment.role?.name === ROLE_CORE_ALLIANCE_MEMBER)
}

export async function listCommandRoles(
	db: DbClient<typeof schema>,
	guildId: string,
	selfAssignableOnly: boolean
): Promise<TemporaryRoleCommandRole[]> {
	const roles = await db.query.discordRoles.findMany({
		where: eq(discordRoles.isActive, true),
		with: {
			discordServer: { columns: { guildId: true, isActive: true } },
			selfAssignable: true,
		},
	})
	return roles
		.filter(
			(role) =>
				role.discordServer.guildId === guildId &&
				role.discordServer.isActive &&
				(!selfAssignableOnly || role.selfAssignable !== null)
		)
		.sort((a, b) =>
			(a.selfAssignable?.displayName ?? a.roleName).localeCompare(
				b.selfAssignable?.displayName ?? b.roleName
			)
		)
		.map((role) => ({
			roleDbId: role.id,
			roleId: role.roleId,
			roleName: role.roleName,
			displayName: role.selfAssignable?.displayName ?? role.roleName,
			defaultDurationSeconds: role.selfAssignable?.defaultDurationSeconds ?? null,
		}))
}

export async function listSelfAssignableRolesForUser(
	env: Pick<Env, 'DISCORD' | 'TEMPORARY_ROLE_ASSIGNMENTS'>,
	db: DbClient<typeof schema>,
	guildId: string,
	discordUserId: string,
	mode: 'join' | 'leave',
	memberRoleIds?: string[]
): Promise<TemporaryRoleCommandRole[]> {
	const roles = await listCommandRoles(db, guildId, true)
	const assignedRoleIds = new Set(
		memberRoleIds ??
			(await getDiscordStub(env).getGuildMemberByDiscordUserId(guildId, discordUserId)).roleIds
	)
	const selfAssignedRoleIds =
		mode === 'leave'
			? new Set(
					(
						await getAssignmentStub(env, guildId).then((stub) =>
							stub.listActiveAssignments(guildId, discordUserId)
						)
					)
						.filter((assignment) => assignment.assignmentSource === 'self')
						.map((assignment) => assignment.roleId)
				)
			: new Set<string>()
	return roles.filter((role) =>
		mode === 'join'
			? !assignedRoleIds.has(role.roleId)
			: selfAssignedRoleIds.has(role.roleId) && assignedRoleIds.has(role.roleId)
	)
}

export async function findCommandRoleById(
	db: DbClient<typeof schema>,
	guildId: string,
	roleDbId: string,
	selfAssignableOnly: boolean
): Promise<TemporaryRoleCommandRole> {
	const roles = await db.query.discordRoles.findMany({
		where: eq(discordRoles.isActive, true),
		with: { discordServer: { columns: { guildId: true, isActive: true } }, selfAssignable: true },
	})
	const role = roles.find(
		(candidate) =>
			candidate.id === roleDbId &&
			candidate.discordServer.guildId === guildId &&
			candidate.discordServer.isActive &&
			(!selfAssignableOnly || candidate.selfAssignable !== null)
	)
	if (!role) {
		throw new Error(
			selfAssignableOnly
				? 'That role is no longer self-assignable on this server.'
				: 'That managed role was not found on this server.'
		)
	}
	return {
		roleDbId: role.id,
		roleId: role.roleId,
		roleName: role.roleName,
		displayName: role.selfAssignable?.displayName ?? role.roleName,
		defaultDurationSeconds: role.selfAssignable?.defaultDurationSeconds ?? null,
	}
}

function parseCommandDuration(
	value: string | undefined,
	fallbackSeconds: number | null
): number | null {
	if (value === undefined || value.trim() === '') {
		if (fallbackSeconds === null) return null
		return parseDiscordDurationSeconds(`${fallbackSeconds} seconds`)
	}
	return parseDiscordDurationSeconds(value)
}

async function getAssignmentStub(env: Pick<Env, 'TEMPORARY_ROLE_ASSIGNMENTS'>, guildId: string) {
	return getStub<TemporaryRoleAssignments>(env.TEMPORARY_ROLE_ASSIGNMENTS, guildId)
}

async function getTargetCoreUserId(
	db: DbClient<typeof schema>,
	discordUserId: string
): Promise<string | null> {
	const user = await db.query.users.findFirst({
		where: eq(users.discordUserId, discordUserId),
		columns: { id: true },
	})
	return user?.id ?? null
}

async function verifyGuildMember(
	env: Pick<Env, 'DISCORD'>,
	guildId: string,
	discordUserId: string
): Promise<void> {
	const member = await getDiscordStub(env).getGuildMemberByDiscordUserId(guildId, discordUserId)
	if (!member.isMember) throw new Error('That Discord user is not a member of this server.')
}

export async function assignTemporaryRole(
	env: Pick<Env, 'DISCORD' | 'TEMPORARY_ROLE_ASSIGNMENTS'>,
	db: DbClient<typeof schema>,
	input: {
		guildId: string
		discordUserId: string
		coreUserId?: string | null
		role: TemporaryRoleCommandRole
		durationText?: string
		defaultDurationSeconds: number | null
		assignedByCoreUserId: string
		assignmentSource: TemporaryRoleAssignmentSource
		interactionId?: string | null
	}
): Promise<TemporaryRoleAssignment> {
	await verifyGuildMember(env, input.guildId, input.discordUserId)
	const coreUserId = input.coreUserId ?? (await getTargetCoreUserId(db, input.discordUserId))
	const seconds = parseCommandDuration(input.durationText, input.defaultDurationSeconds)
	const expiresAt = seconds === null ? null : Date.now() + seconds * 1000
	const assignments = await getAssignmentStub(env, input.guildId)
	const previousAssignment = (
		await assignments.listActiveAssignments(input.guildId, input.discordUserId)
	).find((assignment) => assignment.roleId === input.role.roleId)
	const assignment = await assignments.upsertAssignment(input.guildId, {
		guildId: input.guildId,
		roleId: input.role.roleId,
		roleName: input.role.roleName,
		discordUserId: input.discordUserId,
		coreUserId,
		assignedByCoreUserId: input.assignedByCoreUserId,
		assignmentSource: input.assignmentSource,
		expiresAt,
		interactionId: input.interactionId,
	})

	let result: { success: boolean; error?: string }
	try {
		result = await assignments.applyRoleMutation(input.guildId, {
			assignmentId: assignment.id,
			roleId: input.role.roleId,
			discordUserId: input.discordUserId,
			action: 'add',
			revision: assignment.revision,
		})
	} catch (error) {
		await rollbackTemporaryAssignment(assignments, input.guildId, assignment, previousAssignment)
		throw error
	}
	if (!result.success) {
		await rollbackTemporaryAssignment(assignments, input.guildId, assignment, previousAssignment)
		throw new Error(result.error ?? 'Failed to assign the Discord role')
	}
	return assignment
}

export async function removeTemporaryRole(
	env: Pick<Env, 'DISCORD' | 'TEMPORARY_ROLE_ASSIGNMENTS'>,
	db: DbClient<any>,
	input: {
		guildId: string
		discordUserId: string
		coreUserId?: string | null
		role: TemporaryRoleCommandRole
		reason: string
		onlySelf?: boolean
	}
): Promise<boolean> {
	const assignments = await getAssignmentStub(env, input.guildId)
	const assignment = await assignments.markRemovalPending(input.guildId, {
		roleId: input.role.roleId,
		discordUserId: input.discordUserId,
		reason: input.reason,
		onlySelf: input.onlySelf,
	})
	if (!assignment) return false
	const result = await assignments.applyRoleMutation(input.guildId, {
		assignmentId: assignment.id,
		roleId: input.role.roleId,
		discordUserId: input.discordUserId,
		action: 'remove',
		revision: assignment.revision,
	})
	await assignments.completeRemoval(
		input.guildId,
		[{ assignmentId: assignment.id, revision: assignment.revision }],
		result.success,
		result.error
	)
	if (!result.success) throw new Error(result.error ?? 'Failed to remove the Discord role')
	return true
}
