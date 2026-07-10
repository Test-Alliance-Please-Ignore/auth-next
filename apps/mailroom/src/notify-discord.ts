import { forDO } from '@repo/do-utils'

import { consume } from './email'
import { awardAndAnnounce } from './markee-bonus'

import type { Discord, MessageContent } from '@repo/discord'
import type { Env } from './context'
import type { EmailHandler } from './email'

/**
 * Route handler for markeedragon@ inbound mail. The message is a Markee Dragon affiliate-sale
 * notification; its only job here is to trigger a reward. So on each one we award a random
 * prediction-market wallet a small house-funded bonus and post a celebratory announcement naming the
 * winner to a Discord channel, via the shared Discord Durable Object (`@repo/discord`, reached with
 * `forDO`). The email body itself is not posted (it was only ever shown while debugging).
 *
 * Once the post succeeds the mail is `consume`d (accepted and discarded). The award is best-effort and
 * never throws; only a missing config or the Discord send failing throws, so the framework's error
 * fallback preserves the mail (forward-to-fallback) and Sentry captures it.
 */
export const notifyDiscord: EmailHandler<Env> = async (ctx) => {
	const guildId = ctx.env.DISCORD_GUILD_ID
	const channelId = ctx.env.MARKEE_DISCORD_CHANNEL_ID
	if (!guildId || !channelId) {
		throw new Error(
			'Discord notify is not configured: set DISCORD_GUILD_ID and MARKEE_DISCORD_CHANNEL_ID'
		)
	}

	// Award a random prediction-market wallet a house-funded bonus and build the announcement naming
	// the winner. Best-effort (never throws); returns null when no one was bonused (empty house / no
	// wallets / a failure), in which case we post a plain sale notice. As Discord message content, the
	// announcement renders emoji + custom emotes and the winner mention resolves to their display name.
	const announcement = await awardAndAnnounce(ctx)

	const message: MessageContent = {
		content: announcement ?? '📣 A Markee Dragon referral sale just came in!',
		allowEveryone: false,
	}

	const discord = forDO<Discord>(ctx.env.DISCORD).singleton()
	const result = await discord.sendMessage(guildId, channelId, message)
	if (!result.success) {
		throw new Error(`Discord sendMessage failed: ${result.error ?? 'unknown error'}`)
	}

	ctx.log.info('markee bonus announcement posted to Discord', {
		from: ctx.sender,
		to: ctx.recipient,
		channelId,
		messageId: result.messageId,
		announced: announcement !== null,
	})

	// The email's purpose (trigger the bonus + announce it) is fulfilled — accept and discard.
	return consume
}
