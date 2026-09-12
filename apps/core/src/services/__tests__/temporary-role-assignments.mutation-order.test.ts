import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TemporaryRoleAssignmentsDO } from '../../temporary-role-assignments-do'

const { discordStub } = vi.hoisted(() => ({
	discordStub: {
		addGuildMemberRole: vi.fn(),
		removeGuildMemberRole: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({ getStub: vi.fn(() => discordStub) }))

type DurableObjectRows = Array<Record<string, unknown>>

function makeDurableObject(rows: DurableObjectRows[]) {
	const sql = {
		exec: vi.fn((query: string) => ({
			toArray: () =>
				query.startsWith('SELECT * FROM temporary_role_assignments') ? (rows.shift() ?? []) : [],
		})),
	}
	const state = {
		storage: {
			get: vi.fn().mockResolvedValue('guild-1'),
			put: vi.fn(),
			sql,
		},
	}
	const instance = Object.create(TemporaryRoleAssignmentsDO.prototype) as TemporaryRoleAssignmentsDO
	Object.assign(instance, { state, env: { DISCORD: {} } })
	return instance
}

describe('temporary role mutation ordering', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('applies a newer assignment after an older removal finishes', async () => {
		discordStub.removeGuildMemberRole
			.mockResolvedValueOnce({ success: false, error: 'transient failure' })
			.mockResolvedValueOnce({ success: true })
		discordStub.addGuildMemberRole.mockResolvedValue({ success: true })
		const instance = makeDurableObject([
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 6,
					status: 'active',
				},
			],
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 6,
					status: 'active',
				},
			],
		])

		await expect(
			instance.applyRoleMutation('guild-1', {
				assignmentId: 'assignment-1',
				roleId: 'role-1',
				discordUserId: 'user-1',
				action: 'remove',
				revision: 5,
			})
		).resolves.toEqual({ success: true })
		expect(discordStub.removeGuildMemberRole).toHaveBeenCalledTimes(1)
		expect(discordStub.addGuildMemberRole).toHaveBeenCalledTimes(1)
	})

	it('retries a failed mutation only once when no newer revision exists', async () => {
		discordStub.removeGuildMemberRole.mockReset()
		discordStub.removeGuildMemberRole.mockResolvedValue({
			success: false,
			error: 'Discord unavailable',
		})
		const instance = makeDurableObject([
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 5,
					status: 'removal_pending',
				},
			],
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 5,
					status: 'removal_pending',
				},
			],
		])

		await expect(
			instance.applyRoleMutation('guild-1', {
				assignmentId: 'assignment-1',
				roleId: 'role-1',
				discordUserId: 'user-1',
				action: 'remove',
				revision: 5,
			})
		).resolves.toEqual({ success: false, error: 'Discord unavailable' })
		expect(discordStub.removeGuildMemberRole).toHaveBeenCalledTimes(2)
	})

	it('observes a removal tombstone after an older assignment mutation', async () => {
		discordStub.addGuildMemberRole.mockResolvedValue({ success: true })
		discordStub.removeGuildMemberRole.mockResolvedValue({ success: true })
		const instance = makeDurableObject([
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 6,
					status: 'failed',
					failure_message: 'removed',
				},
			],
			[
				{
					guild_id: 'guild-1',
					role_id: 'role-1',
					discord_user_id: 'user-1',
					revision: 6,
					status: 'failed',
					failure_message: 'removed',
				},
			],
		])

		await instance.applyRoleMutation('guild-1', {
			assignmentId: 'assignment-1',
			roleId: 'role-1',
			discordUserId: 'user-1',
			action: 'add',
			revision: 5,
		})
		expect(discordStub.addGuildMemberRole).toHaveBeenCalledTimes(1)
		expect(discordStub.removeGuildMemberRole).toHaveBeenCalledTimes(1)
	})

	it('delegates alarm processing to the shared expiry queue', async () => {
		const alarm = vi.fn().mockRejectedValue(new Error('storage unavailable'))
		const instance = Object.create(
			TemporaryRoleAssignmentsDO.prototype
		) as TemporaryRoleAssignmentsDO
		Object.assign(instance, {
			queue: { alarm },
			env: { DISCORD: {} },
		})

		await expect(instance.alarm()).rejects.toThrow('storage unavailable')
		expect(alarm).toHaveBeenCalledOnce()
	})

	it('rebuilds queue entries from the SQL source of truth', async () => {
		const replace = vi.fn().mockResolvedValue(undefined)
		const rows = [
			[
				{
					id: 'assignment-1',
					guild_id: 'guild-1',
					role_id: 'role-1',
					role_name: 'Role',
					discord_user_id: 'user-1',
					assignment_source: 'self',
					assigned_at: 1,
					expires_at: 10_000,
					status: 'active',
					revision: 4,
					attempt_count: 0,
				},
			],
		]
		const instance = makeDurableObject(rows)
		Object.assign(instance, { queue: { replace } })

		await instance.reschedule('guild-1')

		expect(replace).toHaveBeenCalledWith([
			{
				id: 'assignment-1',
				dueAt: 10_000,
				payload: { assignmentId: 'assignment-1', revision: 4 },
			},
		])
	})
})
