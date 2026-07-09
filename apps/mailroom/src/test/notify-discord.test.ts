import { describe, expect, it, vi } from 'vitest'

import { createEmailContext } from '../email'
import { notifyDiscord } from '../notify-discord'
import { emailRouter } from '../routes'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { Env } from '../context'
import type { EmailLogger } from '../email'

const log: EmailLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/** Build an Env whose DISCORD binding resolves to a stub with the given `sendMessage` mock. */
function envWith(sendMessage: ReturnType<typeof vi.fn>, overrides: Partial<Env> = {}): Env {
	return {
		DISCORD_GUILD_ID: 'guild-1',
		MARKEE_DISCORD_CHANNEL_ID: 'chan-1',
		DISCORD: { getByName: () => ({ sendMessage }) },
		...overrides,
	} as unknown as Env
}

function ctxFor(env: Env, mime?: string) {
	const message = makeMessage({
		to: 'markeedragon@pleaseignore.app',
		from: 'sender@example.com',
		mime,
	})
	return createEmailContext(message, env, fakeExecutionCtx(), log)
}

describe('notifyDiscord', () => {
	it('posts the email to the configured Discord channel and consumes it', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
		const mime =
			'From: sender@example.com\r\nTo: markeedragon@pleaseignore.app\r\nSubject: Hello Markee\r\n\r\nThe body text.'
		const disposition = await notifyDiscord(ctxFor(envWith(sendMessage), mime))

		expect(sendMessage).toHaveBeenCalledTimes(1)
		const [guildId, channelId, message] = sendMessage.mock.calls[0]
		expect(guildId).toBe('guild-1')
		expect(channelId).toBe('chan-1')
		expect(message.content).toContain('markeedragon@pleaseignore.app')
		expect(message.embeds[0].title).toBe('Hello Markee')
		expect(message.embeds[0].description).toContain('The body text.')
		expect(message.embeds[0].fields).toEqual([
			{ name: 'From', value: 'sender@example.com', inline: true },
			{ name: 'To', value: 'markeedragon@pleaseignore.app', inline: true },
		])
		expect(disposition).toEqual({ type: 'consume' })
	})

	it('throws when guild/channel are not configured', async () => {
		const sendMessage = vi.fn()
		const env = envWith(sendMessage, {
			DISCORD_GUILD_ID: undefined,
			MARKEE_DISCORD_CHANNEL_ID: undefined,
		})
		await expect(notifyDiscord(ctxFor(env))).rejects.toThrow(/not configured/)
		expect(sendMessage).not.toHaveBeenCalled()
	})

	it('throws when the Discord send fails (so the framework preserves the mail)', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'missing permissions' })
		await expect(notifyDiscord(ctxFor(envWith(sendMessage)))).rejects.toThrow(/missing permissions/)
	})

	it('is wired into the email router for markeedragon@', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
		const disposition = await emailRouter.route(ctxFor(envWith(sendMessage)))
		expect(sendMessage).toHaveBeenCalledTimes(1)
		expect(disposition).toEqual({ type: 'consume' })
	})
})
