import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { guildMemberAddHandler } from '../handlers/guild-member-add'

const findFirst = vi.fn()
const consumeJoinSuppression = vi.fn()

vi.mock('../../db', () => ({
	createDb: vi.fn(() => ({
		query: {
			discordUsers: {
				findFirst,
			},
		},
	})),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((_namespace: unknown, _id: string) => ({
		consumeJoinSuppression,
	})),
}))

const mockedGetStub = vi.mocked(getStub)

const DISCORD_GATEWAY_NS = Symbol('DISCORD_GATEWAY')

describe('guildMemberAddHandler', () => {
	beforeEach(() => {
		findFirst.mockReset()
		consumeJoinSuppression.mockReset()
		mockedGetStub.mockImplementation((namespace: any) => {
			if (namespace === DISCORD_GATEWAY_NS) {
				return { consumeJoinSuppression } as any
			}
			return {} as any
		})
	})

	it('syncs linked users and falls back to the pending discord refresh queue on sync failure', async () => {
		const isActiveDiscordGuild = vi.fn().mockResolvedValue(true)
		findFirst.mockResolvedValue({ coreUserId: 'core-user-1' })

		const syncUserDiscordAccess = vi.fn().mockResolvedValue({
			ok: false,
			rpcRequestId: 'rpc-1',
			method: 'syncUserDiscordAccess',
			durationMs: 12,
			error: { message: 'sync failed' },
		})
		const addPendingDiscordRefreshes = vi.fn().mockResolvedValue({
			pendingCount: 1,
			added: 1,
			skipped: 0,
		})
		consumeJoinSuppression.mockResolvedValue({
			suppressed: false,
			alreadyExpired: false,
		})

		await guildMemberAddHandler.handle({
			env: {
				DATABASE_URL: 'postgresql://example',
				DISCORD_GATEWAY: DISCORD_GATEWAY_NS,
				CORE: {
					isActiveDiscordGuild,
					syncUserDiscordAccess,
					addPendingDiscordRefreshes,
				},
			} as any,
			eventName: 'GUILD_MEMBER_ADD',
			payload: {
				guild_id: 'guild-1',
				member: {
					user: {
						id: 'discord-user-1',
					},
				},
			},
			sequence: 42,
		})

		expect(findFirst).toHaveBeenCalledTimes(1)
		expect(isActiveDiscordGuild).toHaveBeenCalledWith('guild-1')
		expect(consumeJoinSuppression).toHaveBeenCalledWith({
			discordUserId: 'discord-user-1',
			guildId: 'guild-1',
		})
		expect(syncUserDiscordAccess).toHaveBeenCalledWith('core-user-1')
		expect(addPendingDiscordRefreshes).toHaveBeenCalledWith(['core-user-1'], {
			source: 'discord-gateway-member-add',
		})
	})

	it('ignores unlinked users', async () => {
		const isActiveDiscordGuild = vi.fn().mockResolvedValue(true)
		findFirst.mockResolvedValue(null)

		const syncUserDiscordAccess = vi.fn()
		const addPendingDiscordRefreshes = vi.fn()
		consumeJoinSuppression.mockResolvedValue({
			suppressed: true,
			alreadyExpired: false,
		})

		await guildMemberAddHandler.handle({
			env: {
				DATABASE_URL: 'postgresql://example',
				DISCORD_GATEWAY: DISCORD_GATEWAY_NS,
				CORE: {
					isActiveDiscordGuild,
					syncUserDiscordAccess,
					addPendingDiscordRefreshes,
				},
			} as any,
			eventName: 'GUILD_MEMBER_ADD',
			payload: {
				guild_id: 'guild-1',
				member: {
					user: {
						id: 'discord-user-1',
					},
				},
			},
			sequence: 42,
		})

		expect(isActiveDiscordGuild).toHaveBeenCalledWith('guild-1')
		expect(findFirst).not.toHaveBeenCalled()
		expect(syncUserDiscordAccess).not.toHaveBeenCalled()
		expect(addPendingDiscordRefreshes).not.toHaveBeenCalled()
	})

	it('ignores member adds for unmanaged guilds before any downstream work', async () => {
		const isActiveDiscordGuild = vi.fn().mockResolvedValue(false)
		const syncUserDiscordAccess = vi.fn()
		const addPendingDiscordRefreshes = vi.fn()

		await guildMemberAddHandler.handle({
			env: {
				DATABASE_URL: 'postgresql://example',
				DISCORD_GATEWAY: DISCORD_GATEWAY_NS,
				CORE: {
					isActiveDiscordGuild,
					syncUserDiscordAccess,
					addPendingDiscordRefreshes,
				},
			} as any,
			eventName: 'GUILD_MEMBER_ADD',
			payload: {
				guild_id: 'guild-1',
				member: {
					user: {
						id: 'discord-user-1',
					},
				},
			},
			sequence: 42,
		})

		expect(isActiveDiscordGuild).toHaveBeenCalledWith('guild-1')
		expect(consumeJoinSuppression).not.toHaveBeenCalled()
		expect(findFirst).not.toHaveBeenCalled()
		expect(syncUserDiscordAccess).not.toHaveBeenCalled()
		expect(addPendingDiscordRefreshes).not.toHaveBeenCalled()
	})
})
