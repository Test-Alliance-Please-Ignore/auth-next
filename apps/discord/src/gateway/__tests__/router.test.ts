import { describe, expect, it, vi } from 'vitest'

import { DiscordGatewayEventRegistry } from '../registry'
import { DiscordGatewayEventRouter } from '../router'

describe('DiscordGatewayEventRouter', () => {
	it('dispatches registered gateway events', async () => {
		const handle = vi.fn().mockResolvedValue(undefined)
		const registry = new DiscordGatewayEventRegistry()
		registry.register({
			eventName: 'GUILD_MEMBER_ADD',
			handle,
		})
		const router = new DiscordGatewayEventRouter(registry)

		const result = await router.route(
			{
				op: 0,
				d: { guild_id: 'guild-1' },
				s: 7,
				t: 'GUILD_MEMBER_ADD',
			},
			{
				env: {} as any,
				eventName: 'GUILD_MEMBER_ADD',
				payload: { guild_id: 'guild-1' },
				sequence: 7,
			}
		)

		expect(handle).toHaveBeenCalledTimes(1)
		expect(result).toEqual({ handled: true, eventName: 'GUILD_MEMBER_ADD' })
	})

	it('ignores unregistered gateway events', async () => {
		const registry = new DiscordGatewayEventRegistry()
		const router = new DiscordGatewayEventRouter(registry)

		const result = await router.route(
			{
				op: 0,
				d: { guild_id: 'guild-1' },
				s: 7,
				t: 'GUILD_MEMBER_REMOVE',
			},
			{
				env: {} as any,
				eventName: 'GUILD_MEMBER_REMOVE',
				payload: { guild_id: 'guild-1' },
				sequence: 7,
			}
		)

		expect(result).toEqual({ handled: false, eventName: 'GUILD_MEMBER_REMOVE' })
	})
})

