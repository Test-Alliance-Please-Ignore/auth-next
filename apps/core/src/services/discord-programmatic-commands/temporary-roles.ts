import { createDb } from '../../db'
import {
	hasAllianceMemberRole,
	listSelfAssignableRolesForUser,
	removeTemporaryRole,
} from '../discord-temporary-roles.service'
import {
	ephemeralCommandResponse,
	modalCommandResponse,
	ProgrammaticCommandPermissionError,
} from './types'

import type { ProgrammaticCommandContext, ProgrammaticCommandDefinition } from './types'

const ALLIANCE_MEMBER_ACCESS = ['Alliance member']

type TemporaryRoleCommandRole = {
	roleDbId: string
	roleName: string
	displayName: string
}

const MAX_DISCORD_SELECT_LABEL_LENGTH = 100

function buildRoleSelectModalResponse(mode: 'join' | 'leave', roles: TemporaryRoleCommandRole[]) {
	if (
		roles.length > 25 ||
		roles.some(
			(role) =>
				role.displayName.length > MAX_DISCORD_SELECT_LABEL_LENGTH ||
				role.roleName.length > MAX_DISCORD_SELECT_LABEL_LENGTH
		)
	) {
		return ephemeralCommandResponse(
			roles.length > 25
				? 'Too many self-assignable roles are configured for this server.'
				: 'A configured role name is too long for Discord selection.'
		)
	}
	return modalCommandResponse(
		mode === 'join' ? 'Choose a role to join.' : 'Choose a role to leave.',
		`tmp-role:${mode}`,
		[
			{
				type: 18 as const,
				label: mode === 'join' ? 'Available roles' : 'Assigned roles',
				description: mode === 'join' ? 'Select a role to join.' : 'Select a role to leave.',
				component: {
					type: 3 as const,
					custom_id: `tmp-role:${mode}:role`,
					options: roles.map((role) => ({
						label: role.displayName,
						value: role.roleDbId,
						description: role.roleName,
					})),
					placeholder: mode === 'join' ? 'Select a role to join' : 'Select a role to leave',
					max_values: 1,
				},
			},
		]
	)
}

async function assertMemberAccess(ctx: ProgrammaticCommandContext): Promise<void> {
	if (ctx.isAdmin) return
	if (!(await hasAllianceMemberRole(ctx.env, ctx.coreUserId))) {
		throw new ProgrammaticCommandPermissionError(
			'You need alliance member permission to use this command.'
		)
	}
}

async function handleSelfAssignment(ctx: ProgrammaticCommandContext) {
	await assertMemberAccess(ctx)
	const guildId = ctx.input.guildId
	if (!guildId) throw new Error('This command can only be used in a Discord server.')
	const db = createDb(ctx.env.DATABASE_URL)
	const roles = await listSelfAssignableRolesForUser(
		ctx.env,
		db,
		guildId,
		ctx.input.discordUserId,
		'join',
		ctx.input.memberRoleIds
	)
	if (roles.length === 0) return ephemeralCommandResponse('You have no available roles to join.')
	return buildRoleSelectModalResponse('join', roles)
}

async function handleSelfRemoval(ctx: ProgrammaticCommandContext) {
	await assertMemberAccess(ctx)
	const guildId = ctx.input.guildId
	if (!guildId) throw new Error('This command can only be used in a Discord server.')
	const db = createDb(ctx.env.DATABASE_URL)
	const roles = await listSelfAssignableRolesForUser(
		ctx.env,
		db,
		guildId,
		ctx.input.discordUserId,
		'leave',
		ctx.input.memberRoleIds
	)
	if (roles.length === 0)
		return ephemeralCommandResponse('You have no self-assigned roles to leave.')
	if (roles.length > 1) return buildRoleSelectModalResponse('leave', roles)
	const role = roles[0]
	const removed = await removeTemporaryRole(ctx.env, db, {
		guildId,
		discordUserId: ctx.input.discordUserId,
		coreUserId: ctx.coreUserId,
		role,
		reason: 'part',
		onlySelf: true,
	})
	return ephemeralCommandResponse(
		removed
			? `Removed **${role.displayName}**.`
			: `You do not currently have **${role.displayName}** self-assigned.`
	)
}

export const DISCORD_JOIN_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'join',
	description: 'Assign yourself a configured self-assignable Discord role.',
	categoryName: 'Roles Management',
	immutableAccessRequirements: ALLIANCE_MEMBER_ACCESS,
	options: undefined,
	deferral: 'sync',
	handler: handleSelfAssignment,
}

export const DISCORD_PART_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'part',
	description: 'Leave a self-assigned Discord role early.',
	categoryName: 'Roles Management',
	immutableAccessRequirements: ALLIANCE_MEMBER_ACCESS,
	options: undefined,
	deferral: 'sync',
	handler: handleSelfRemoval,
}

export const DISCORD_LEAVE_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'leave',
	description: 'Leave a self-assigned Discord role early.',
	categoryName: 'Roles Management',
	immutableAccessRequirements: ALLIANCE_MEMBER_ACCESS,
	options: undefined,
	deferral: 'sync',
	handler: handleSelfRemoval,
}
