import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROGRAMMATIC_COMMAND_DEFINITIONS } from '../discord-programmatic-commands'
import {
	DISCORD_JOIN_PROGRAMMATIC_COMMAND,
	DISCORD_LEAVE_PROGRAMMATIC_COMMAND,
	DISCORD_LIST_ROLES_PROGRAMMATIC_COMMAND,
	DISCORD_PART_PROGRAMMATIC_COMMAND,
	DISCORD_SET_PROGRAMMATIC_COMMAND,
	DISCORD_UNSET_PROGRAMMATIC_COMMAND,
} from '../discord-programmatic-commands/temporary-roles'

import type {
	ProgrammaticCommandContext,
	ProgrammaticCommandEnv,
} from '../discord-programmatic-commands/types'

const hoisted = vi.hoisted(() => ({
	hasAllianceMemberRole: vi.fn(),
	findCommandRole: vi.fn(),
	listCommandRoles: vi.fn(),
	assignTemporaryRole: vi.fn(),
	removeTemporaryRole: vi.fn(),
	createDb: vi.fn(() => ({})),
}))

vi.mock('../discord-temporary-roles.service', () => ({
	hasAllianceMemberRole: hoisted.hasAllianceMemberRole,
	findCommandRole: hoisted.findCommandRole,
	listCommandRoles: hoisted.listCommandRoles,
	assignTemporaryRole: hoisted.assignTemporaryRole,
	removeTemporaryRole: hoisted.removeTemporaryRole,
	DEFAULT_TEMPORARY_ADMIN_SET_DURATION_SECONDS: 86400,
}))

vi.mock('../../db', () => ({ createDb: hoisted.createDb }))

const role = {
	roleDbId: 'role-db-1',
	roleId: 'role-1',
	roleName: 'Fleet Member',
	defaultDurationSeconds: 3600,
}

function ctx(overrides: Partial<ProgrammaticCommandContext> = {}): ProgrammaticCommandContext {
	return {
		optionValues: { role: 'Fleet Member', duration: '2 hours', user: 'discord-2' },
		coreUserId: 'core-1',
		isAdmin: false,
		env: {
			DATABASE_URL: 'postgres://test',
			GROUPS: {},
			DISCORD: {},
			TEMPORARY_ROLE_ASSIGNMENTS: {},
			USER_DISCORD_REFRESH_WORKFLOW: {},
		} as unknown as ProgrammaticCommandEnv,
		input: {
			commandName: 'join',
			discordUserId: 'discord-1',
			guildId: 'guild-1',
		},
		interactionId: 'interaction-1',
		...overrides,
	}
}

describe('temporary role programmatic commands', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.hasAllianceMemberRole.mockResolvedValue(true)
		hoisted.findCommandRole.mockResolvedValue(role)
		hoisted.listCommandRoles.mockResolvedValue([role])
		hoisted.assignTemporaryRole.mockResolvedValue({
			...role,
			expiresAt: Date.now() + 3600000,
		})
		hoisted.removeTemporaryRole.mockResolvedValue(true)
	})

	it('registers every role command, including both removal aliases', () => {
		expect(PROGRAMMATIC_COMMAND_DEFINITIONS.map((definition) => definition.name)).toEqual(
			expect.arrayContaining(['join', 'part', 'leave', 'listroles', 'set', 'unset'])
		)
		expect(
			[
				DISCORD_JOIN_PROGRAMMATIC_COMMAND,
				DISCORD_PART_PROGRAMMATIC_COMMAND,
				DISCORD_LEAVE_PROGRAMMATIC_COMMAND,
				DISCORD_LIST_ROLES_PROGRAMMATIC_COMMAND,
				DISCORD_SET_PROGRAMMATIC_COMMAND,
				DISCORD_UNSET_PROGRAMMATIC_COMMAND,
			].map((definition) => definition.name)
		).toEqual(expect.arrayContaining(['join', 'part', 'leave', 'listroles', 'set', 'unset']))
	})

	it('rejects self-assignment when the caller lacks alliance member permission', async () => {
		hoisted.hasAllianceMemberRole.mockResolvedValue(false)

		await expect(DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())).rejects.toThrow(
			'alliance member'
		)
		expect(hoisted.assignTemporaryRole).not.toHaveBeenCalled()
	})

	it('allows alliance members to join only self-assignable roles', async () => {
		await DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())

		expect(hoisted.hasAllianceMemberRole).toHaveBeenCalledWith(expect.anything(), 'core-1')
		expect(hoisted.findCommandRole).toHaveBeenCalledWith(
			expect.anything(),
			'guild-1',
			'Fleet Member',
			true
		)
		expect(hoisted.assignTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ assignmentSource: 'self', role, coreUserId: 'core-1' })
		)
		expect(DISCORD_JOIN_PROGRAMMATIC_COMMAND.options).toHaveLength(1)
	})

	it('allows admins to bypass alliance membership but still uses the managed-role set', async () => {
		await DISCORD_SET_PROGRAMMATIC_COMMAND.handler(ctx({ isAdmin: true }))

		expect(hoisted.hasAllianceMemberRole).not.toHaveBeenCalled()
		expect(hoisted.findCommandRole).toHaveBeenCalledWith(
			expect.anything(),
			'guild-1',
			'Fleet Member',
			false
		)
		expect(hoisted.assignTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				assignmentSource: 'admin',
				discordUserId: 'discord-2',
				defaultDurationSeconds: 86400,
				durationText: '2 hours',
			})
		)
	})

	it('uses self-assignable filtering for members and full managed roles for admins', async () => {
		await DISCORD_LIST_ROLES_PROGRAMMATIC_COMMAND.handler(ctx())
		expect(hoisted.listCommandRoles).toHaveBeenLastCalledWith(expect.anything(), 'guild-1', true)

		await DISCORD_LIST_ROLES_PROGRAMMATIC_COMMAND.handler(ctx({ isAdmin: true }))
		expect(hoisted.listCommandRoles).toHaveBeenLastCalledWith(expect.anything(), 'guild-1', false)
	})

	it('requires admin access for set and unset and lets members part/leave their own roles', async () => {
		await expect(DISCORD_SET_PROGRAMMATIC_COMMAND.handler(ctx())).rejects.toThrow('site admins')
		await expect(DISCORD_UNSET_PROGRAMMATIC_COMMAND.handler(ctx())).rejects.toThrow('site admins')

		await DISCORD_PART_PROGRAMMATIC_COMMAND.handler(ctx())
		await DISCORD_LEAVE_PROGRAMMATIC_COMMAND.handler(ctx())
		expect(hoisted.removeTemporaryRole).toHaveBeenCalledTimes(2)
		expect(hoisted.removeTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ onlySelf: true, reason: 'part' })
		)
	})
})
