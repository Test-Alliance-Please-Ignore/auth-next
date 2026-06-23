import { describe, expect, it, vi } from 'vitest'

import { DiscordGatewayEventRegistry, createDiscordGatewayEventRegistry } from '../registry'

describe('DiscordGatewayEventRegistry', () => {
	it('registers and returns handlers by event name', () => {
		const handle = vi.fn().mockResolvedValue(undefined)
		const registry = new DiscordGatewayEventRegistry()

		registry.register({
			eventName: 'GUILD_MEMBER_ADD',
			handle,
		})

		expect(registry.get('GUILD_MEMBER_ADD')).toBeDefined()
		expect(registry.get('GUILD_MEMBER_REMOVE')).toBeUndefined()
		expect(registry.list()).toHaveLength(1)
	})

	it('creates a registry from an initial handler list', () => {
		const registry = createDiscordGatewayEventRegistry([
			{
				eventName: 'GUILD_MEMBER_ADD',
				handle: vi.fn().mockResolvedValue(undefined),
			},
		])

		expect(registry.get('GUILD_MEMBER_ADD')).toBeDefined()
		expect(registry.list()).toHaveLength(1)
	})
})
