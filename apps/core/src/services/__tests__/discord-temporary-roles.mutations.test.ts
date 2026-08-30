import { beforeEach, describe, expect, it, vi } from 'vitest'

import { assignTemporaryRole, removeTemporaryRole } from '../discord-temporary-roles.service'

import type * as CoreModule from '@repo/core'

const { assignmentStub, discordStub } = vi.hoisted(() => ({
	assignmentStub: {
		listActiveAssignments: vi.fn(),
		applyRoleMutation: vi.fn(),
		upsertAssignment: vi.fn(),
		markRemovalPending: vi.fn(),
		completeRemoval: vi.fn(),
		deleteAssignment: vi.fn(),
		restoreAssignment: vi.fn(),
	},
	discordStub: {
		addGuildMemberRole: vi.fn(),
		removeGuildMemberRole: vi.fn(),
		getGuildMemberByDiscordUserId: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({ getStub: vi.fn(() => assignmentStub) }))
vi.mock('@repo/discord', () => ({ getDiscordStub: vi.fn(() => discordStub) }))
vi.mock('@repo/db-utils', () => ({ eq: vi.fn() }))
vi.mock('@repo/core', async (importOriginal) => ({
	...(await importOriginal<typeof CoreModule>()),
	ROLE_CORE_ALLIANCE_MEMBER: 'Alliance Member',
}))
vi.mock('../../lib/groups-cache', () => ({ getCachedUserRoles: vi.fn() }))

const role = {
	roleDbId: 'role-db-1',
	roleId: 'role-1',
	roleName: 'Fleet Member',
	displayName: 'Fleet Member',
	defaultDurationSeconds: 3600,
}

const env = {
	DISCORD: {},
	TEMPORARY_ROLE_ASSIGNMENTS: {},
	USER_DISCORD_REFRESH_WORKFLOW: {},
} as any

describe('temporary role direct mutations', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		assignmentStub.listActiveAssignments.mockResolvedValue([])
		assignmentStub.upsertAssignment.mockResolvedValue({
			id: 'assignment-1',
			revision: 1,
			expiresAt: Date.now() + 3600000,
			roleId: role.roleId,
		})
		assignmentStub.markRemovalPending.mockResolvedValue({ id: 'assignment-1', revision: 2 })
		discordStub.getGuildMemberByDiscordUserId.mockResolvedValue({ isMember: true, roleIds: [] })
		assignmentStub.applyRoleMutation.mockResolvedValue({ success: true })
	})

	it('adds a linked user role directly while persisting the assignment source', async () => {
		await assignTemporaryRole(env, {} as any, {
			guildId: 'guild-1',
			discordUserId: 'discord-1',
			coreUserId: 'core-1',
			role,
			durationText: '1 hour',
			defaultDurationSeconds: 3600,
			assignedByCoreUserId: 'core-1',
			assignmentSource: 'self',
		})

		expect(assignmentStub.applyRoleMutation).toHaveBeenCalledWith('guild-1', {
			assignmentId: 'assignment-1',
			roleId: 'role-1',
			discordUserId: 'discord-1',
			action: 'add',
			revision: 1,
		})
	})

	it('removes a linked user role directly and completes the durable removal', async () => {
		await removeTemporaryRole(env, {} as any, {
			guildId: 'guild-1',
			discordUserId: 'discord-1',
			coreUserId: 'core-1',
			role,
			reason: 'unset',
		})

		expect(assignmentStub.applyRoleMutation).toHaveBeenCalledWith('guild-1', {
			assignmentId: 'assignment-1',
			roleId: 'role-1',
			discordUserId: 'discord-1',
			action: 'remove',
			revision: 2,
		})
		expect(assignmentStub.completeRemoval).toHaveBeenCalledWith(
			'guild-1',
			[{ assignmentId: 'assignment-1', revision: 2 }],
			true,
			undefined
		)
	})

	it('rolls back the persisted assignment when the Discord RPC throws', async () => {
		assignmentStub.applyRoleMutation.mockRejectedValueOnce(new Error('Discord worker unavailable'))

		await expect(
			assignTemporaryRole(env, {} as any, {
				guildId: 'guild-1',
				discordUserId: 'discord-1',
				coreUserId: 'core-1',
				role,
				durationText: '1 hour',
				defaultDurationSeconds: 3600,
				assignedByCoreUserId: 'core-1',
				assignmentSource: 'self',
			})
		).rejects.toThrow('Discord worker unavailable')

		expect(assignmentStub.deleteAssignment).toHaveBeenCalledWith('guild-1', 'assignment-1', 1)
	})

	it('propagates a failed Durable Object mutation while retaining the assignment state', async () => {
		assignmentStub.applyRoleMutation.mockResolvedValueOnce({
			success: false,
			error: 'temporary Discord failure',
		})

		await expect(
			removeTemporaryRole(env, {} as any, {
				guildId: 'guild-1',
				discordUserId: 'discord-1',
				role,
				reason: 'part',
			})
		).rejects.toThrow('temporary Discord failure')

		expect(assignmentStub.applyRoleMutation).toHaveBeenCalledTimes(1)
		expect(assignmentStub.completeRemoval).toHaveBeenCalledWith(
			'guild-1',
			[{ assignmentId: 'assignment-1', revision: 2 }],
			false,
			'temporary Discord failure'
		)
	})
})
