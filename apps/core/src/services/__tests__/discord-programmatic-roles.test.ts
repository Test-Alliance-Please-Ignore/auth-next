import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROGRAMMATIC_COMMAND_DEFINITIONS } from '../discord-programmatic-commands'
import {
	DISCORD_JOIN_PROGRAMMATIC_COMMAND,
	DISCORD_LEAVE_PROGRAMMATIC_COMMAND,
	DISCORD_PART_PROGRAMMATIC_COMMAND,
} from '../discord-programmatic-commands/temporary-roles'

import type {
	ProgrammaticCommandContext,
	ProgrammaticCommandEnv,
} from '../discord-programmatic-commands/types'

const hoisted = vi.hoisted(() => ({
	hasAllianceMemberRole: vi.fn(),
	listSelfAssignableRolesForUser: vi.fn(),
	assignTemporaryRole: vi.fn(),
	removeTemporaryRole: vi.fn(),
	createDb: vi.fn(() => ({})),
	getStub: vi.fn(),
}))

vi.mock('../discord-temporary-roles.service', () => ({
	hasAllianceMemberRole: hoisted.hasAllianceMemberRole,
	listSelfAssignableRolesForUser: hoisted.listSelfAssignableRolesForUser,
	assignTemporaryRole: hoisted.assignTemporaryRole,
	removeTemporaryRole: hoisted.removeTemporaryRole,
}))

vi.mock('../../db', () => ({ createDb: hoisted.createDb }))

vi.mock('@repo/do-utils', () => ({ getStub: hoisted.getStub }))

const role = {
	roleDbId: 'role-db-1',
	roleId: 'role-1',
	roleName: 'Fleet Member',
	displayName: 'Fleet Member',
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
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue([role])
		hoisted.assignTemporaryRole.mockResolvedValue({
			...role,
			expiresAt: Date.now() + 3600000,
		})
		hoisted.removeTemporaryRole.mockResolvedValue(true)
		hoisted.getStub.mockReturnValue({
			sendMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'message-1' }),
		})
	})

	it('registers every live role command', () => {
		expect(PROGRAMMATIC_COMMAND_DEFINITIONS.map((definition) => definition.name)).toEqual(
			expect.arrayContaining(['join', 'part', 'leave', 'roles'])
		)
		expect(
			[
				DISCORD_JOIN_PROGRAMMATIC_COMMAND,
				DISCORD_PART_PROGRAMMATIC_COMMAND,
				DISCORD_LEAVE_PROGRAMMATIC_COMMAND,
			].map((definition) => definition.name)
		).toEqual(expect.arrayContaining(['join', 'part', 'leave']))
	})

	it('allows only site admins to post a temporary role panel', async () => {
		const rolesCommand = PROGRAMMATIC_COMMAND_DEFINITIONS.find(
			(definition) => definition.name === 'roles'
		)
		expect(rolesCommand).toBeDefined()
		expect(rolesCommand!.options?.map((option) => option.name)).toEqual(['title', 'message'])

		const response = await rolesCommand!.handler(
			ctx({
				isAdmin: true,
				optionValues: { title: 'Fleet Roles', message: 'Pick a role.' },
				input: {
					commandName: 'roles',
					discordUserId: 'discord-1',
					guildId: 'guild-1',
					channelId: 'channel-1',
				},
			})
		)

		expect(response.data?.content).toContain('message-1')
		const sendMessage = hoisted.getStub.mock.results[0]?.value.sendMessage
		expect(sendMessage).toHaveBeenCalledWith(
			'guild-1',
			'channel-1',
			expect.objectContaining({
				embeds: [expect.objectContaining({ title: 'Fleet Roles', description: 'Pick a role.' })],
				components: [expect.objectContaining({ type: 1 })],
			})
		)

		const denied = await rolesCommand!.handler(ctx({ isAdmin: false }))
		expect(denied.data?.content).toContain('Only site admins')
	})

	it('rejects self-assignment when the caller lacks alliance member permission', async () => {
		hoisted.hasAllianceMemberRole.mockResolvedValue(false)

		await expect(DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())).rejects.toThrow(
			'alliance member'
		)
		expect(hoisted.assignTemporaryRole).not.toHaveBeenCalled()
	})

	it('allows alliance members to join only self-assignable roles', async () => {
		const response = await DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())

		expect(hoisted.hasAllianceMemberRole).toHaveBeenCalledWith(expect.anything(), 'core-1')
		expect(hoisted.listSelfAssignableRolesForUser).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			'guild-1',
			'discord-1',
			'join',
			undefined
		)
		expect(DISCORD_JOIN_PROGRAMMATIC_COMMAND.options).toBeUndefined()
		expect(response.data?.components).toHaveLength(1)
		expect(response.data?.components?.[0]).toMatchObject({
			type: 18,
		})
		expect(
			(response.data?.components?.[0] as { component?: { type?: number; custom_id?: string } })
				?.component
		).toMatchObject({
			type: 3,
			custom_id: 'tmp-role:join:role',
		})
	})

	it('rejects self-assignment menus with too many configured roles', async () => {
		const roles = Array.from({ length: 26 }, (_, index) => ({
			...role,
			roleDbId: `role-db-${index}`,
			roleName: `Role ${index}`,
		}))
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue(roles)

		const response = await DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())
		expect(response.data?.content).toContain('Too many self-assignable roles')
		expect(response.data?.components).toBeUndefined()
	})

	it('rejects role labels that Discord cannot render in a select menu', async () => {
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue([
			{ ...role, displayName: 'x'.repeat(101) },
		])

		const response = await DISCORD_JOIN_PROGRAMMATIC_COMMAND.handler(ctx())
		expect(response.data?.content).toContain('role name is too long')
		expect(response.data?.components).toBeUndefined()
	})

	it('shows the leave menu when multiple self-assigned roles are available', async () => {
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue([
			role,
			{ ...role, roleDbId: 'role-2' },
		])
		const response = await DISCORD_PART_PROGRAMMATIC_COMMAND.handler(ctx())

		expect(hoisted.removeTemporaryRole).not.toHaveBeenCalled()
		expect(response.data?.components).toHaveLength(1)
	})
})
