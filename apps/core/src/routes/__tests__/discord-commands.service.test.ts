import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import { resetDiscordCommandRegistryForTests } from '../../services/discord-command-registry.service'
import {
	executeDiscordSlashCommand,
	resetDiscordCommandRegistryCacheForTests,
} from '../../services/discord-commands.service'

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
}))

const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)

function createDbMock({
	user,
	commands,
}: {
	user: { id: string; is_admin: boolean } | null
	commands: Array<{
		id: string
		name: string
		description: string
		commandType: 'static_response' | 'programmatic'
		responseTemplate: string | null
		requiredPermissions: Array<{ permissionId: string }>
		serverAttachments: Array<{
			discordServer: {
				guildId: string
				isActive: boolean
			}
		}>
	}>
}) {
	return {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue([]),
		}),
		query: {
			users: {
				findFirst: vi.fn().mockResolvedValue(user),
			},
			discordCommands: {
				findMany: vi.fn().mockResolvedValue(commands),
			},
		},
	} as any
}

describe('executeDiscordSlashCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetDiscordCommandRegistryCacheForTests()
		resetDiscordCommandRegistryForTests()
		getCachedUserPermissionsMock.mockResolvedValue([])
	})

	it('rejects invalid command names', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({ user: null, commands: [] }),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'Invalid Name!',
				discordUserId: '12345',
			}
		)

		expect(result.reason).toBe('invalid-command')
		expect(result.authorized).toBe(false)
		expect(result.response.data?.flags).toBe(64)
	})

	it('returns not-linked when no core user matches discord user', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: null,
				commands: [
					{
							id: 'command-1',
							name: 'status',
							description: 'status',
							commandType: 'static_response',
							responseTemplate: 'ok',
						requiredPermissions: [],
						serverAttachments: [
							{
								discordServer: {
									guildId: '123',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'status',
				discordUserId: '12345',
				guildId: '123',
			}
		)

		expect(result.reason).toBe('not-linked')
		expect(result.coreUserId).toBeNull()
		expect(result.authorized).toBe(false)
		expect(result.response.data?.flags).toBe(64)
	})

	it('returns not-found when command is missing or inactive', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'user-1', is_admin: false },
				commands: [],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'status',
				discordUserId: '12345',
			}
		)

		expect(result.reason).toBe('not-found')
		expect(result.coreUserId).toBe('user-1')
		expect(result.authorized).toBe(false)
	})

	it('enforces guild attachment restrictions', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'user-1', is_admin: false },
				commands: [
					{
							id: 'command-1',
							name: 'status',
							description: 'status',
							commandType: 'static_response',
							responseTemplate: 'ok',
						requiredPermissions: [],
						serverAttachments: [
							{
								discordServer: {
									guildId: '111',
									isActive: true,
								},
							},
							{
								discordServer: {
									guildId: '222',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'status',
				discordUserId: '12345',
				guildId: '999',
			}
		)

		expect(result.reason).toBe('guild-not-allowed')
		expect(result.authorized).toBe(false)
		expect(result.response.data?.flags).toBe(64)
	})

	it('enforces required permissions for non-admin users', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([
			{
				permissionId: 'perm-other',
				urn: 'urn:test:other',
				name: 'Other',
				description: null,
				category: null,
				groupId: 'group-1',
				groupName: 'Group 1',
				targetType: 'all_members',
				source: 'global',
			},
		])

		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'user-1', is_admin: false },
				commands: [
					{
							id: 'command-1',
							name: 'status',
							description: 'status',
							commandType: 'static_response',
							responseTemplate: 'ok',
						requiredPermissions: [{ permissionId: 'perm-required' }],
						serverAttachments: [
							{
								discordServer: {
									guildId: '111',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'status',
				discordUserId: '12345',
				guildId: '111',
			}
		)

		expect(result.reason).toBe('missing-permission')
		expect(result.authorized).toBe(false)
	})

	it('renders static response template using context variables and nested option paths', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'admin-1', is_admin: true },
				commands: [
					{
						id: 'command-1',
						name: 'score',
						description: 'score',
						commandType: 'static_response',
						responseTemplate: '{{score.thing}} is {{adjective}}',
						requiredPermissions: [{ permissionId: 'perm-required' }],
						serverAttachments: [
							{
								discordServer: {
									guildId: '111',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'score',
				discordUserId: '12345',
				guildId: '111',
				options: [
					{
						name: 'score',
						options: [
							{ name: 'adjective', value: 'excellent' },
							{ name: 'thing', value: 'EVE' },
						],
					},
				],
			}
		)

		expect(result.reason).toBe('ok')
		expect(result.authorized).toBe(true)
		expect(result.coreUserId).toBe('admin-1')
		expect(result.response.data?.content).toBe('EVE is excellent')
	})

	it('executes programmatic /how command', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'admin-1', is_admin: true },
				commands: [
					{
						id: 'programmatic-how',
						name: 'how',
						description: 'How command',
						commandType: 'programmatic',
						responseTemplate: null,
						requiredPermissions: [],
						serverAttachments: [
							{
								discordServer: {
									guildId: '111',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'how',
				discordUserId: '12345',
				guildId: '111',
				options: [
					{ name: 'adjective', value: 'brave' },
					{ name: 'subject', value: 'EVE' },
				],
			}
		)

		expect(result.reason).toBe('ok')
		expect(result.authorized).toBe(true)
		expect(result.response.data?.content).toMatch(/^EVE is \d+\.\d{2}% brave$/)
	})

	it('executes programmatic /evetime command', async () => {
		const result = await executeDiscordSlashCommand(
			createDbMock({
				user: { id: 'admin-1', is_admin: true },
				commands: [
					{
						id: 'programmatic-evetime',
						name: 'evetime',
						description: 'EVE time command',
						commandType: 'programmatic',
						responseTemplate: null,
						requiredPermissions: [],
						serverAttachments: [
							{
								discordServer: {
									guildId: '111',
									isActive: true,
								},
							},
						],
					},
				],
			}),
			{ GROUPS: {}, DISCORD: {} } as any,
			{
				commandName: 'evetime',
				discordUserId: '12345',
				guildId: '111',
			}
		)

		expect(result.reason).toBe('ok')
		expect(result.authorized).toBe(true)
		expect(result.response.data?.content).toMatch(
			/^Current EVE Time: [A-Za-z]+ \d{2}, \d{4} at \d{2}:\d{2}\nYour local time: <t:\d+:f>$/
		)
	})
})
