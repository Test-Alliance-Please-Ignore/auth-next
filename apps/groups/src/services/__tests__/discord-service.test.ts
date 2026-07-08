import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordService } from '../discord-service'

import type { ServiceContext } from '../context'

function createServiceContext() {
	const db = {
		query: {
			groups: {
				findFirst: vi.fn(),
			},
			groupAdmins: {
				findFirst: vi.fn(),
			},
			groupDiscordServers: {
				findMany: vi.fn(),
				findFirst: vi.fn(),
			},
			groupDiscordServerRoles: {
				findFirst: vi.fn(),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(),
			})),
		})),
		delete: vi.fn(),
	}

	const coreDb = {
		query: {
			discordServers: {
				findMany: vi.fn(),
				findFirst: vi.fn(),
			},
			discordRoles: {
				findMany: vi.fn(),
				findFirst: vi.fn(),
			},
		},
	}

	const groupsDOCache = {
		invalidateGroupsWithDiscordCache: vi.fn(),
	}

	return {
		db,
		coreDb,
		env: {} as any,
		state: {} as any,
		groupsDOCache,
	} as unknown as ServiceContext & {
		db: typeof db
		coreDb: typeof coreDb
		groupsDOCache: typeof groupsDOCache
	}
}

describe('DiscordService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns separate member and owner/admin role buckets for grouped Discord servers', async () => {
		const ctx = createServiceContext()
		const service = new DiscordService(ctx)

		ctx.db.query.groupDiscordServers.findMany.mockResolvedValue([
			{
				id: 'attachment-1',
				groupId: 'group-1',
				discordServerId: 'discord-server-1',
				autoInvite: true,
				autoAssignRoles: true,
				createdAt: new Date('2026-07-08T00:00:00.000Z'),
				group: { name: 'Group One' },
				roles: [
					{
						id: 'assign-member',
						discordRoleId: 'db-role-member',
						membershipType: 'member',
						roleName: 'Member role',
					},
					{
						id: 'assign-owner',
						discordRoleId: 'db-role-owner',
						membershipType: 'owner_admin',
						roleName: 'Owner role',
					},
				],
			},
		])
		ctx.coreDb.query.discordServers.findMany.mockResolvedValue([
			{
				id: 'discord-server-1',
				guildId: 'guild-1',
				guildName: 'Guild One',
				roles: [],
			},
		])
		ctx.coreDb.query.discordRoles.findMany.mockResolvedValue([
			{
				id: 'db-role-member',
				roleId: 'discord-role-member',
				roleName: 'Member role',
			},
			{
				id: 'db-role-owner',
				roleId: 'discord-role-owner',
				roleName: 'Owner role',
			},
		])

		const servers = await service.getDiscordServers('group-1')

		expect(servers).toHaveLength(1)
		expect(servers[0].roles).toEqual([
			expect.objectContaining({
				membershipType: 'member',
				discordRole: expect.objectContaining({
					roleId: 'discord-role-member',
				}),
			}),
			expect.objectContaining({
				membershipType: 'owner_admin',
				discordRole: expect.objectContaining({
					roleId: 'discord-role-owner',
				}),
			}),
		])
	})

	it('stores member role assignments by default when attaching Discord roles', async () => {
		const ctx = createServiceContext()
		const service = new DiscordService(ctx)

		ctx.db.query.groups.findFirst.mockResolvedValue({ id: 'group-1', ownerId: 'user-1' })
		ctx.db.query.groupAdmins.findFirst.mockResolvedValue(null)
		ctx.db.query.groupDiscordServers.findFirst.mockResolvedValue({
			id: 'attachment-1',
			groupId: 'group-1',
			discordServerId: 'discord-server-1',
		})
		ctx.coreDb.query.discordRoles.findFirst.mockResolvedValue({
			id: 'db-role-member',
			roleId: 'discord-role-member',
			roleName: 'Member role',
		})
		ctx.db.query.groupDiscordServerRoles.findFirst.mockResolvedValue(null)
		const values = vi.fn(() => ({
			returning: vi.fn().mockResolvedValue([
				{
					id: 'assignment-1',
					groupDiscordServerId: 'attachment-1',
					discordRoleId: 'db-role-member',
					membershipType: 'member',
					roleName: 'Member role',
				},
			]),
		}))
		ctx.db.insert.mockReturnValue({
			values,
		})

		const result = await service.attachDiscordRole(
			'group-1',
			'discord-server-1',
			'db-role-member',
			'Member role',
			'user-1'
		)

		expect(values).toHaveBeenCalledWith({
			groupDiscordServerId: 'attachment-1',
			discordRoleId: 'db-role-member',
			membershipType: 'member',
			roleName: 'Member role',
		})
		expect(result).toBeUndefined()
	})

	it('stores owner/admin role assignments when explicitly requested', async () => {
		const ctx = createServiceContext()
		const service = new DiscordService(ctx)

		ctx.db.query.groups.findFirst.mockResolvedValue({ id: 'group-1', ownerId: 'user-1' })
		ctx.db.query.groupAdmins.findFirst.mockResolvedValue(null)
		ctx.db.query.groupDiscordServers.findFirst.mockResolvedValue({
			id: 'attachment-1',
			groupId: 'group-1',
			discordServerId: 'discord-server-1',
		})
		ctx.coreDb.query.discordRoles.findFirst.mockResolvedValue({
			id: 'db-role-owner',
			roleId: 'discord-role-owner',
			roleName: 'Owner role',
		})
		ctx.db.query.groupDiscordServerRoles.findFirst.mockResolvedValue(null)
		const values = vi.fn(() => ({
			returning: vi.fn().mockResolvedValue([
				{
					id: 'assignment-2',
					groupDiscordServerId: 'attachment-1',
					discordRoleId: 'db-role-owner',
					membershipType: 'owner_admin',
					roleName: 'Owner role',
				},
			]),
		}))
		ctx.db.insert.mockReturnValue({
			values,
		})

		const result = await service.attachDiscordRole(
			'group-1',
			'discord-server-1',
			'db-role-owner',
			'Owner role',
			'user-1',
			'owner_admin'
		)

		expect(values).toHaveBeenCalledWith({
			groupDiscordServerId: 'attachment-1',
			discordRoleId: 'db-role-owner',
			membershipType: 'owner_admin',
			roleName: 'Owner role',
		})
		expect(result).toBeUndefined()
	})
})
