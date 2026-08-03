import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeDiscordComponent, executeDiscordModalSubmit } from '../discord-components.service'

import type { ExecuteComponentInput, ExecuteModalSubmitInput } from '../discord-components.service'

const hoisted = vi.hoisted(() => ({
	findCommandRoleById: vi.fn(),
	listSelfAssignableRolesForUser: vi.fn(),
	assignTemporaryRole: vi.fn(),
	removeTemporaryRole: vi.fn(),
	hasAllianceMemberRole: vi.fn(),
	getStub: vi.fn(),
	getDiscordStub: vi.fn(),
}))

vi.mock('../discord-temporary-roles.service', () => ({
	findCommandRoleById: hoisted.findCommandRoleById,
	listSelfAssignableRolesForUser: hoisted.listSelfAssignableRolesForUser,
	assignTemporaryRole: hoisted.assignTemporaryRole,
	removeTemporaryRole: hoisted.removeTemporaryRole,
	hasAllianceMemberRole: hoisted.hasAllianceMemberRole,
}))

vi.mock('@repo/do-utils', () => ({
	getStub: hoisted.getStub,
}))

vi.mock('@repo/discord', () => ({
	getDiscordStub: hoisted.getDiscordStub,
}))

const role = {
	roleDbId: 'role-db-1',
	roleId: 'role-1',
	roleName: 'Fleet Member',
	displayName: 'Fleet Member',
	defaultDurationSeconds: 3600,
}

const assignmentStub = {
	listActiveAssignments: vi.fn(),
}

const db = {
	query: {
		users: {
			findFirst: vi.fn(),
		},
	},
} as any

const env = {
	DISCORD: {},
	TEMPORARY_ROLE_ASSIGNMENTS: {},
	GROUPS: {},
	PREDICTION_MARKETS: {},
	PM_FORUM_GUILD_ID: null,
} as const

function modalInput(overrides: Partial<ExecuteModalSubmitInput> = {}): ExecuteModalSubmitInput {
	return {
		customId: 'tmp-role:join',
		discordUserId: 'admin-discord',
		guildId: 'guild-1',
		channelId: 'channel-1',
		interactionId: 'interaction-1',
		fields: {},
		selectValues: {
			'tmp-role:join:role': ['role-db-1'],
		},
		...overrides,
	}
}

function componentInput(overrides: Partial<ExecuteComponentInput> = {}): ExecuteComponentInput {
	return {
		customId: 'tmp-role:join:role',
		discordUserId: 'admin-discord',
		guildId: 'guild-1',
		channelId: 'channel-1',
		interactionId: 'interaction-1',
		values: ['role-db-1'],
		...overrides,
	}
}

describe('temporary role component/modal flow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.getStub.mockReturnValue(assignmentStub)
		hoisted.getDiscordStub.mockReturnValue({
			getGuildMemberByDiscordUserId: vi.fn().mockResolvedValue({ isMember: true, roleIds: [] }),
		})
		hoisted.findCommandRoleById.mockResolvedValue(role)
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue([role])
		hoisted.assignTemporaryRole.mockResolvedValue({
			...role,
			expiresAt: Date.now() + 302400000,
		})
		hoisted.removeTemporaryRole.mockResolvedValue(true)
		assignmentStub.listActiveAssignments.mockResolvedValue([])
		db.query.users.findFirst.mockResolvedValue({ id: 'core-admin', is_admin: true })
		hoisted.hasAllianceMemberRole.mockResolvedValue(true)
	})

	it('uses the shared join command behavior when a panel button is clicked', async () => {
		const result = await executeDiscordComponent(
			db,
			env as never,
			componentInput({ customId: 'tmp-role-panel:join', values: [] })
		)

		expect(result.reason).toBe('role-selection')
		expect(result.response.type).toBe(9)
		expect(result.response.data.components).toHaveLength(1)
		expect(hoisted.listSelfAssignableRolesForUser).toHaveBeenCalledWith(
			env,
			db,
			'guild-1',
			'admin-discord',
			'join',
			undefined
		)
	})

	it('uses the shared leave command behavior for a single panel role', async () => {
		hoisted.listSelfAssignableRolesForUser.mockResolvedValue([role])

		const result = await executeDiscordComponent(
			db,
			env as never,
			componentInput({ customId: 'tmp-role-panel:leave', values: [] })
		)

		expect(result.reason).toBe('ok')
		expect(result.response.data.content).toContain('Removed')
		expect(hoisted.removeTemporaryRole).toHaveBeenCalledWith(
			env,
			db,
			expect.objectContaining({
				guildId: 'guild-1',
				discordUserId: 'admin-discord',
				coreUserId: 'core-admin',
				role,
				reason: 'part',
				onlySelf: true,
			})
		)
	})

	it('assigns a selected self-assignable role from the join modal submission', async () => {
		const result = await executeDiscordModalSubmit(db, env as never, modalInput())

		expect(result.reason).toBe('ok')
		expect(hoisted.findCommandRoleById).toHaveBeenCalledWith(
			expect.anything(),
			'guild-1',
			'role-db-1',
			true
		)
		expect(hoisted.assignTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				guildId: 'guild-1',
				discordUserId: 'admin-discord',
				assignmentSource: 'self',
				assignedByCoreUserId: 'core-admin',
			})
		)
		expect(result.response.type).toBe(4)
		expect(result.response.data.content).toContain('Joined')
	})

	it('explains that a replayed failed interaction must be submitted again', async () => {
		hoisted.assignTemporaryRole.mockRejectedValue(new Error('TEMPORARY_ROLE_INTERACTION_REPLAY'))

		const result = await executeDiscordModalSubmit(db, env as never, modalInput())

		expect(result.reason).toBe('role-error')
		expect(result.response.data.content).toContain('already failed')
		expect(result.response.data.content).toContain('run the command again')
	})

	it('rejects non-members before handling the join modal submission', async () => {
		db.query.users.findFirst.mockResolvedValue({ id: 'core-user', is_admin: false })
		hoisted.hasAllianceMemberRole.mockResolvedValue(false)

		const result = await executeDiscordModalSubmit(db, env as never, modalInput())

		expect(result.reason).toBe('permission')
		expect(result.response.data.content).toContain('alliance member')
		expect(hoisted.findCommandRoleById).not.toHaveBeenCalled()
	})

	it('assigns a selected self-assignable role to the target user with the parsed duration', async () => {
		const result = await executeDiscordComponent(db, env as never, componentInput())

		expect(result.reason).toBe('ok')
		expect(hoisted.findCommandRoleById).toHaveBeenCalledWith(
			expect.anything(),
			'guild-1',
			'role-db-1',
			true
		)
		expect(hoisted.assignTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				guildId: 'guild-1',
				discordUserId: 'admin-discord',
				assignmentSource: 'self',
				assignedByCoreUserId: 'core-admin',
			})
		)
	})

	it('removes a selected self-assigned role from the target user', async () => {
		assignmentStub.listActiveAssignments.mockResolvedValue([
			{ roleId: 'role-1', assignmentSource: 'self' },
		])
		hoisted.getDiscordStub.mockReturnValue({
			getGuildMemberByDiscordUserId: vi
				.fn()
				.mockResolvedValue({ isMember: true, roleIds: ['role-1'] }),
		})
		const result = await executeDiscordComponent(
			db,
			env as never,
			componentInput({
				customId: 'tmp-role:leave:role',
				values: ['role-db-1'],
			})
		)

		expect(result.reason).toBe('ok')
		expect(hoisted.removeTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				guildId: 'guild-1',
				discordUserId: 'admin-discord',
				role,
				coreUserId: 'core-admin',
				reason: 'part',
				onlySelf: true,
			})
		)
	})

	it('removes a selected self-assigned role from the leave modal submission', async () => {
		assignmentStub.listActiveAssignments.mockResolvedValue([
			{ roleId: 'role-1', assignmentSource: 'self' },
		])
		hoisted.getDiscordStub.mockReturnValue({
			getGuildMemberByDiscordUserId: vi
				.fn()
				.mockResolvedValue({ isMember: true, roleIds: ['role-1'] }),
		})

		const result = await executeDiscordModalSubmit(
			db,
			env as never,
			modalInput({
				customId: 'tmp-role:leave',
				selectValues: {
					'tmp-role:leave:role': ['role-db-1'],
				},
			})
		)

		expect(result.reason).toBe('ok')
		expect(hoisted.removeTemporaryRole).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				guildId: 'guild-1',
				discordUserId: 'admin-discord',
				role,
				coreUserId: 'core-admin',
				reason: 'part',
				onlySelf: true,
			})
		)
	})
})
