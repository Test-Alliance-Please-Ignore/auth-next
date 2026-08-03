import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'
import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { buildTemporaryRolePanelMessage } from '../../lib/temporary-role-panel'
import { executeTemporaryRoleCommand } from '../temporary-role-command.service'

import type { Discord } from '@repo/discord'
import type { ProgrammaticCommandContext, ProgrammaticCommandDefinition } from './types'

const ALLIANCE_MEMBER_ACCESS = ['Alliance member']

async function handleSelfAssignment(ctx: ProgrammaticCommandContext) {
	return executeTemporaryRoleCommand({
		db: createDb(ctx.env.DATABASE_URL),
		env: ctx.env,
		guildId: ctx.input.guildId,
		discordUserId: ctx.input.discordUserId,
		coreUserId: ctx.coreUserId,
		isAdmin: ctx.isAdmin,
		memberRoleIds: ctx.input.memberRoleIds,
		mode: 'join',
	})
}

async function handleSelfRemoval(ctx: ProgrammaticCommandContext) {
	return executeTemporaryRoleCommand({
		db: createDb(ctx.env.DATABASE_URL),
		env: ctx.env,
		guildId: ctx.input.guildId,
		discordUserId: ctx.input.discordUserId,
		coreUserId: ctx.coreUserId,
		isAdmin: ctx.isAdmin,
		memberRoleIds: ctx.input.memberRoleIds,
		mode: 'leave',
	})
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

export const DISCORD_ROLES_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'roles',
	description: 'Post a temporary role selection panel in this channel.',
	categoryName: 'Roles Management',
	immutableAccessRequirements: [],
	options: [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'title',
			description: 'Optional title for the panel embed.',
			required: false,
			max_length: 256,
		},
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'message',
			description: 'Optional instructions to show in the panel.',
			required: false,
			max_length: 4000,
		},
	],
	deferral: 'sync',
	handler: async ({ optionValues, isAdmin, env, input }) => {
		if (!isAdmin) {
			return {
				type: 4,
				data: {
					content: 'Only site admins can post a temporary role panel.',
					flags: 1 << 6,
				},
			}
		}
		if (!input.guildId || !input.channelId) {
			return {
				type: 4,
				data: {
					content: 'This command can only be used in a Discord server channel.',
					flags: 1 << 6,
				},
			}
		}

		try {
			const discord = getStub<Discord>(env.DISCORD, 'default')
			const result = await discord.sendMessage(
				input.guildId,
				input.channelId,
				buildTemporaryRolePanelMessage(optionValues.title, optionValues.message)
			)
			if (!result.success) {
				return {
					type: 4,
					data: {
						content: `Could not post the temporary role panel: ${result.error ?? 'Discord rejected the message.'}`,
						flags: 1 << 6,
					},
				}
			}
			return {
				type: 4,
				data: {
					content: result.messageId
						? `Temporary role panel posted in <#${input.channelId}> (message ${result.messageId}).`
						: `Temporary role panel posted in <#${input.channelId}>.`,
					flags: 1 << 6,
				},
			}
		} catch {
			return {
				type: 4,
				data: {
					content: 'Could not post the temporary role panel. Please try again later.',
					flags: 1 << 6,
				},
			}
		}
	},
}
