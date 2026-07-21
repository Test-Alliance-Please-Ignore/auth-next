import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))

import { DiscordDO } from '../../durable-object'
import { DiscordAPIError } from '@repo/discord'

describe('DiscordDO.sendDirectMessage', () => {
	it('marks missing DM permissions as non-retryable', async () => {
		const fakeClient = {
			post: vi
				.fn()
				.mockResolvedValueOnce({ id: 'dm-channel-1' })
				.mockRejectedValueOnce(new DiscordAPIError(403, { message: 'Missing permissions' })),
		}

		const fakeThis = {
			getProfileByCoreUserId: vi.fn().mockResolvedValue({
				userId: 'discord-user-1',
				username: 'pilot',
				discriminator: '1234',
				scopes: ['identify'],
			}),
			createDiscordClient: vi.fn().mockReturnValue(fakeClient),
		}

		const result = await DiscordDO.prototype.sendDirectMessage.call(
			fakeThis as never,
			'core-user-1',
			{
				content: 'hello',
			}
		)

		expect(result).toEqual({
			success: false,
			error: 'Missing permissions to send DM to this user',
			retryable: false,
		})
	})
})
