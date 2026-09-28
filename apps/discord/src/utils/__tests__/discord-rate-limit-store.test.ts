import { describe, expect, it, vi } from 'vitest'

import { createDiscordRateLimitKvStore } from '../../lib/discord-rate-limit-store'

describe('createDiscordRateLimitKvStore', () => {
	it('uses Cloudflare KV minimum TTL without changing the logical expiry', async () => {
		const kv = {
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace
		const store = createDiscordRateLimitKvStore(kv)
		const record = {
			bucket: 'bucket-1',
			expiresAt: Date.now() + 19_000,
			global: false,
			routeKey: 'GET /guilds/:id/roles',
			scope: 'shared',
		}

		await store.put('discord-rate-limit:bucket:bucket-1', record, 19)

		expect(kv.put).toHaveBeenCalledWith(
			'discord-rate-limit:bucket:bucket-1',
			JSON.stringify(record),
			{ expirationTtl: 60 }
		)
	})
})
