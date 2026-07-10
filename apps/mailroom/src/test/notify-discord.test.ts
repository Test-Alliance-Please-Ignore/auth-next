import { describe, expect, it, vi } from 'vitest'

import { createEmailContext } from '../email'
import { notifyDiscord } from '../notify-discord'
import { emailRouter } from '../routes'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { Env } from '../context'
import type { EmailLogger } from '../email'

const log: EmailLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const MIME_WITH_BODY =
	'From: sender@example.com\r\nTo: markeedragon@pleaseignore.app\r\nSubject: Hello Markee\r\n\r\nThe body text.'

/** A skipped-award mock (no one bonused) — the default so the post keeps its plain "new email" line. */
const skippedAward = () =>
	vi.fn().mockResolvedValue({ awarded: false, reason: 'NO_ELIGIBLE_WALLETS' })

/**
 * Build an Env whose DISCORD binding resolves (via forDO().singleton() → getByName) to a stub with the
 * given `sendMessage` + `getProfileByCoreUserId`, and whose PREDICTION_MARKETS binding resolves (via
 * getStub) to a stub with the given `awardRandomBonus`. The award/profile mocks are passed in so a test
 * can hold references and assert the wiring; the helper's own behaviour lives in markee-bonus.test.ts.
 */
function envWith(
	sendMessage: ReturnType<typeof vi.fn>,
	overrides: Partial<Env> = {},
	award: ReturnType<typeof vi.fn> = skippedAward(),
	getProfile: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null)
): Env {
	return {
		DISCORD_GUILD_ID: 'guild-1',
		MARKEE_DISCORD_CHANNEL_ID: 'chan-1',
		DISCORD: { getByName: () => ({ sendMessage, getProfileByCoreUserId: getProfile }) },
		PREDICTION_MARKETS: { idFromName: (name: string) => name, get: () => ({ awardRandomBonus: award }) },
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
	it('posts the email (default line when no one is bonused), invokes the award, and consumes', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
		const award = skippedAward()
		const disposition = await notifyDiscord(ctxFor(envWith(sendMessage, {}, award), MIME_WITH_BODY))

		expect(sendMessage).toHaveBeenCalledTimes(1)
		const [guildId, channelId, message] = sendMessage.mock.calls[0]
		expect(guildId).toBe('guild-1')
		expect(channelId).toBe('chan-1')
		// No bonus ⇒ content falls back to the plain "new email" line; the email embed is attached.
		expect(message.content).toContain('markeedragon@pleaseignore.app')
		expect(message.embeds[0].title).toBe('Hello Markee')
		expect(message.embeds[0].description).toContain('The body text.')
		expect(message.embeds[0].fields).toEqual([
			{ name: 'From', value: 'sender@example.com', inline: true },
			{ name: 'To', value: 'markeedragon@pleaseignore.app', inline: true },
		])
		// The award is actually wired in (guards against silently disconnecting the feature).
		expect(award).toHaveBeenCalledTimes(1)
		expect(award).toHaveBeenCalledWith({
			amount: '5',
			reason: 'markeedragon@ inbound email from sender@example.com',
		})
		expect(disposition).toEqual({ type: 'consume' })
	})

	it('posts a random bonus announcement naming the winner when a bonus is awarded', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
		const award = vi
			.fn()
			.mockResolvedValue({ awarded: true, userId: 'core-1', amount: '5', balanceAfter: '5' })
		const getProfile = vi
			.fn()
			.mockResolvedValue({ userId: '999', username: 'w', discriminator: '0', scopes: [] })

		const disposition = await notifyDiscord(
			ctxFor(envWith(sendMessage, {}, award, getProfile), MIME_WITH_BODY)
		)

		const [, , message] = sendMessage.mock.calls[0]
		expect(message.content).toContain('<@999>') // winner mention → renders as their display name + pings
		expect(message.content).not.toContain('New email to') // announcement replaced the default line
		expect(message.embeds[0].title).toBe('Hello Markee') // email embed still attached for context
		expect(getProfile).toHaveBeenCalledWith('core-1') // resolved by the winner's core user id
		expect(disposition).toEqual({ type: 'consume' })
	})

	it('throws when guild/channel are not configured (before any award)', async () => {
		const sendMessage = vi.fn()
		const award = skippedAward()
		const env = envWith(sendMessage, { DISCORD_GUILD_ID: undefined, MARKEE_DISCORD_CHANNEL_ID: undefined }, award)
		await expect(notifyDiscord(ctxFor(env))).rejects.toThrow(/not configured/)
		expect(sendMessage).not.toHaveBeenCalled()
		expect(award).not.toHaveBeenCalled()
	})

	it('throws when the Discord send fails (so the framework preserves the mail)', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: false, error: 'missing permissions' })
		const award = skippedAward()
		await expect(notifyDiscord(ctxFor(envWith(sendMessage, {}, award)))).rejects.toThrow(
			/missing permissions/
		)
		// The award runs BEFORE the post (the post announces the winner), so it is attempted regardless.
		expect(award).toHaveBeenCalledTimes(1)
	})

	it('is wired into the email router for markeedragon@', async () => {
		const sendMessage = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
		const disposition = await emailRouter.route(ctxFor(envWith(sendMessage)))
		expect(sendMessage).toHaveBeenCalledTimes(1)
		expect(disposition).toEqual({ type: 'consume' })
	})
})
