import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'

import { createDb } from '../../db'
import {
	assignTemporaryRole,
	DEFAULT_TEMPORARY_ADMIN_SET_DURATION_SECONDS,
	findCommandRole,
	hasAllianceMemberRole,
	listCommandRoles,
	removeTemporaryRole,
} from '../discord-temporary-roles.service'
import { ephemeralCommandResponse, ProgrammaticCommandPermissionError } from './types'

import type { ProgrammaticCommandContext, ProgrammaticCommandDefinition } from './types'

function requireRoleName(ctx: ProgrammaticCommandContext): string {
	const roleName = ctx.optionValues.role?.trim()
	if (!roleName) throw new Error('A role name is required.')
	return roleName
}

function formatDuration(seconds: number | null): string {
	if (seconds === null) return 'forever'
	if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
	if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
	if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
	return `${seconds} seconds`
}

async function assertMemberAccess(ctx: ProgrammaticCommandContext): Promise<void> {
	if (ctx.isAdmin) return
	if (!(await hasAllianceMemberRole(ctx.env, ctx.coreUserId))) {
		throw new ProgrammaticCommandPermissionError(
			'You need alliance member permission to use this command.'
		)
	}
}

function commandOptions(includeDuration: boolean, includeUser: boolean) {
	return [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'role',
			description: 'Managed Discord role name.',
			required: true,
			max_length: 100,
		},
		...(includeUser
			? [
					{
						type: DISCORD_SLASH_COMMAND_OPTION_TYPE.USER,
						name: 'user',
						description: 'Discord user to target.',
						required: true,
					},
				]
			: []),
		...(includeDuration
			? [
					{
						type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
						name: 'duration',
						description: 'Duration such as 1 hour, 10 days, or forever.',
						required: false,
						max_length: 100,
					},
				]
			: []),
	]
}

async function handleSelfAssignment(ctx: ProgrammaticCommandContext) {
	await assertMemberAccess(ctx)
	const guildId = ctx.input.guildId
	if (!guildId) throw new Error('This command can only be used in a Discord server.')
	const db = createDb(ctx.env.DATABASE_URL)
	const role = await findCommandRole(db, guildId, requireRoleName(ctx), true)
	const assignment = await assignTemporaryRole(ctx.env, db, {
		guildId,
		discordUserId: ctx.input.discordUserId,
		coreUserId: ctx.coreUserId,
		role,
		durationText: ctx.optionValues.duration,
		defaultDurationSeconds: role.defaultDurationSeconds,
		assignedByCoreUserId: ctx.coreUserId,
		assignmentSource: 'self',
		interactionId: ctx.interactionId,
	})
	return ephemeralCommandResponse(
		`Assigned **${assignment.roleName}** ${assignment.expiresAt === null ? 'forever' : `until <t:${Math.floor(assignment.expiresAt / 1000)}:F>`}.`
	)
}

async function handleSelfRemoval(ctx: ProgrammaticCommandContext) {
	await assertMemberAccess(ctx)
	const guildId = ctx.input.guildId
	if (!guildId) throw new Error('This command can only be used in a Discord server.')
	const db = createDb(ctx.env.DATABASE_URL)
	const role = await findCommandRole(db, guildId, requireRoleName(ctx), true)
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
			? `Removed **${role.roleName}**.`
			: `You do not currently have **${role.roleName}** self-assigned.`
	)
}

export const DISCORD_JOIN_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'join',
	description: 'Assign yourself a configured self-assignable Discord role.',
	categoryName: 'Roles Management',
	options: commandOptions(false, false),
	deferral: 'defer-ephemeral',
	handler: handleSelfAssignment,
}

export const DISCORD_PART_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'part',
	description: 'Leave a self-assigned Discord role early.',
	categoryName: 'Roles Management',
	options: commandOptions(false, false),
	deferral: 'defer-ephemeral',
	handler: handleSelfRemoval,
}

export const DISCORD_LEAVE_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'leave',
	description: 'Leave a self-assigned Discord role early.',
	categoryName: 'Roles Management',
	options: commandOptions(false, false),
	deferral: 'defer-ephemeral',
	handler: handleSelfRemoval,
}

export const DISCORD_LIST_ROLES_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'listroles',
	description: 'List the Discord roles available for assignment.',
	categoryName: 'Roles Management',
	deferral: 'defer-ephemeral',
	handler: async (ctx) => {
		await assertMemberAccess(ctx)
		const guildId = ctx.input.guildId
		if (!guildId) throw new Error('This command can only be used in a Discord server.')
		const roles = await listCommandRoles(createDb(ctx.env.DATABASE_URL), guildId, !ctx.isAdmin)
		if (roles.length === 0)
			return ephemeralCommandResponse('No assignable managed roles are configured.')
		return ephemeralCommandResponse(
			roles
				.map(
					(role) =>
						`• **${role.roleName}**${role.defaultDurationSeconds !== null ? ` (${formatDuration(role.defaultDurationSeconds)})` : ''}`
				)
				.join('\n')
		)
	},
}

export const DISCORD_SET_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'set',
	description: 'Assign a managed Discord role to a user.',
	categoryName: 'Roles Management',
	options: commandOptions(true, true),
	deferral: 'defer-ephemeral',
	handler: async (ctx) => {
		if (!ctx.isAdmin) throw new Error('Only site admins can use this command.')
		const guildId = ctx.input.guildId
		const discordUserId = ctx.optionValues.user?.trim()
		if (!guildId || !discordUserId)
			throw new Error('This command can only be used with a Discord user in a server.')
		const role = await findCommandRole(
			createDb(ctx.env.DATABASE_URL),
			guildId,
			requireRoleName(ctx),
			false
		)
		const assignment = await assignTemporaryRole(ctx.env, createDb(ctx.env.DATABASE_URL), {
			guildId,
			discordUserId,
			role,
			durationText: ctx.optionValues.duration,
			defaultDurationSeconds: DEFAULT_TEMPORARY_ADMIN_SET_DURATION_SECONDS,
			assignedByCoreUserId: ctx.coreUserId,
			assignmentSource: 'admin',
			interactionId: ctx.interactionId,
		})
		return ephemeralCommandResponse(
			`Assigned **${assignment.roleName}** to <@${discordUserId}> ${assignment.expiresAt === null ? 'forever' : `until <t:${Math.floor(assignment.expiresAt / 1000)}:F>`}.`
		)
	},
}

export const DISCORD_UNSET_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'unset',
	description: 'Remove a managed Discord role from a user immediately.',
	categoryName: 'Roles Management',
	options: commandOptions(false, true),
	deferral: 'defer-ephemeral',
	handler: async (ctx) => {
		if (!ctx.isAdmin) throw new Error('Only site admins can use this command.')
		const guildId = ctx.input.guildId
		const discordUserId = ctx.optionValues.user?.trim()
		if (!guildId || !discordUserId)
			throw new Error('This command can only be used with a Discord user in a server.')
		const db = createDb(ctx.env.DATABASE_URL)
		const role = await findCommandRole(db, guildId, requireRoleName(ctx), false)
		const removed = await removeTemporaryRole(ctx.env, db, {
			guildId,
			discordUserId,
			role,
			reason: 'unset',
		})
		return ephemeralCommandResponse(
			removed
				? `Removed **${role.roleName}** from <@${discordUserId}>.`
				: `No active temporary assignment was found for <@${discordUserId}>.`
		)
	},
}
