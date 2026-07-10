import { forDO } from '@repo/do-utils'
import { parseDateOrNull } from '@repo/worker-utils'

import { consume } from './email'

import type { Discord, DiscordEmbed, MessageContent } from '@repo/discord'
import type { Env } from './context'
import type { EmailHandler } from './email'

/** Discord "blurple". */
const EMBED_COLOR = 0x5865f2
/** Discord embed field limits (characters). */
const LIMIT = { title: 256, description: 4000, fieldValue: 1024 }

/**
 * Route handler: post an inbound email to a Discord channel via the shared Discord
 * Durable Object (`@repo/discord`), reached with `forDO`.
 *
 * On success the email is `consume`d — its purpose is fulfilled by the Discord post, so it
 * is accepted and discarded. Any failure (missing config, or the send failing) throws, so
 * the framework's error fallback preserves the mail (forward-to-fallback) and Sentry
 * captures it rather than the notification being silently lost.
 */
export const notifyDiscord: EmailHandler<Env> = async (ctx) => {
	const guildId = ctx.env.DISCORD_GUILD_ID
	const channelId = ctx.env.MARKEE_DISCORD_CHANNEL_ID
	if (!guildId || !channelId) {
		throw new Error(
			'Discord notify is not configured: set DISCORD_GUILD_ID and MARKEE_DISCORD_CHANNEL_ID'
		)
	}

	const parsed = await ctx.parsed()
	const body = (parsed.text ?? htmlToText(parsed.html) ?? '').trim()
	const timestamp = parseDateOrNull(parsed.date)?.toISOString()

	const embed: DiscordEmbed = {
		title: truncate(parsed.subject ?? '(no subject)', LIMIT.title),
		description: body ? truncate(body, LIMIT.description) : '_(empty body)_',
		color: EMBED_COLOR,
		fields: [
			{ name: 'From', value: truncate(ctx.sender, LIMIT.fieldValue), inline: true },
			{ name: 'To', value: truncate(ctx.recipient, LIMIT.fieldValue), inline: true },
		],
		...(timestamp ? { timestamp } : {}),
	}

	const message: MessageContent = {
		content: `📧 New email to **${ctx.recipient}**`,
		embeds: [embed],
		allowEveryone: false,
	}

	const discord = forDO<Discord>(ctx.env.DISCORD).singleton()
	const result = await discord.sendMessage(guildId, channelId, message)
	if (!result.success) {
		throw new Error(`Discord sendMessage failed: ${result.error ?? 'unknown error'}`)
	}

	ctx.log.info('email posted to Discord', {
		from: ctx.sender,
		to: ctx.recipient,
		channelId,
		messageId: result.messageId,
	})

	// The email's purpose is fulfilled by the Discord post — accept and discard.
	return consume
}

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Rough HTML→text fallback for emails that carry only an HTML body. */
function htmlToText(html: string | null): string | null {
	if (!html) return null
	return html
		.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}
