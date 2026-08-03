import {
	ephemeralCommandResponse,
	modalCommandResponse,
	ProgrammaticCommandPermissionError,
} from './discord-programmatic-commands/types'
import {
	hasAllianceMemberRole,
	listSelfAssignableRolesForUser,
	removeTemporaryRole,
} from './discord-temporary-roles.service'

import type { DiscordInteractionResponse } from '@repo/discord'
import type { Env } from '../context'
import type { createDb } from '../db'

export type TemporaryRoleCommandMode = 'join' | 'leave'

export type TemporaryRoleCommandRole = {
	roleDbId: string
	roleName: string
	displayName: string
}

export type TemporaryRoleCommandEnv = Pick<Env, 'GROUPS' | 'TEMPORARY_ROLE_ASSIGNMENTS' | 'DISCORD'>

const MAX_DISCORD_SELECT_LABEL_LENGTH = 100

export function buildTemporaryRoleSelectModalResponse(
	mode: TemporaryRoleCommandMode,
	roles: TemporaryRoleCommandRole[]
): DiscordInteractionResponse {
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
				type: 18,
				label: mode === 'join' ? 'Available roles' : 'Assigned roles',
				description: mode === 'join' ? 'Select a role to join.' : 'Select a role to leave.',
				component: {
					type: 3,
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

export async function executeTemporaryRoleCommand(input: {
	db: ReturnType<typeof createDb>
	env: TemporaryRoleCommandEnv
	guildId: string | null | undefined
	discordUserId: string
	coreUserId: string
	isAdmin: boolean
	memberRoleIds?: string[]
	mode: TemporaryRoleCommandMode
}): Promise<DiscordInteractionResponse> {
	if (!input.isAdmin && !(await hasAllianceMemberRole(input.env, input.coreUserId))) {
		throw new ProgrammaticCommandPermissionError(
			'You need alliance member permission to use this command.'
		)
	}
	if (!input.guildId) throw new Error('This command can only be used in a Discord server.')

	const roles = await listSelfAssignableRolesForUser(
		input.env,
		input.db,
		input.guildId,
		input.discordUserId,
		input.mode,
		input.memberRoleIds
	)
	if (roles.length === 0) {
		return ephemeralCommandResponse(
			input.mode === 'join'
				? 'You have no available roles to join.'
				: 'You have no self-assigned roles to leave.'
		)
	}
	if (input.mode === 'join' || roles.length > 1) {
		return buildTemporaryRoleSelectModalResponse(input.mode, roles)
	}

	const role = roles[0]
	const removed = await removeTemporaryRole(input.env, input.db, {
		guildId: input.guildId,
		discordUserId: input.discordUserId,
		coreUserId: input.coreUserId,
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
