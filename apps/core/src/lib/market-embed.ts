/**
 * Rendering helpers for a prediction market's Discord forum post — the outcome/pool embed and
 * the plain-text "bet placed" announcement. Pure (no I/O) so they are unit-testable and reusable
 * across create/update/bet flows.
 */

import type { DiscordEmbed } from '@repo/discord'
import type { MarketDetail } from '@repo/prediction-markets'

const STATUS_COLOR: Record<string, number> = {
	open: 0x2ecc71, // green
	closed: 0xe67e22, // orange
	resolving: 0xe67e22, // orange
	resolved: 0x3498db, // blue
	voided: 0x95a5a6, // grey
	draft: 0x95a5a6, // grey
}

/** Group an integer-string point amount with thousands separators (string-preserving). */
export function formatMarketPoints(value: string): string {
	const trimmed = value.trim()
	const negative = trimmed.startsWith('-')
	const digits = (negative ? trimmed.slice(1) : trimmed).replace(/^0+(?=\d)/, '')
	const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
	return `${negative ? '-' : ''}${grouped} points`
}

/** Truncate to `max` chars with an ellipsis (Discord field/title/name limits). */
export function truncateForEmbed(value: string, max: number): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * The public message posted to a market's forum thread when a bet lands. Names the bettor
 * (`bettor` is a Discord mention like `<@id>`, which renders the username; the caller keeps
 * allowed_mentions empty so it displays without pinging). The outcome label is truncated so a
 * long label can't blow past Discord's 2000-char message limit.
 */
export function buildBetAnnouncement(bettor: string, amount: string, outcomeLabel: string): string {
	return `🎲 ${bettor} bet **${formatMarketPoints(amount)}** on **${truncateForEmbed(
		outcomeLabel,
		256
	)}**.`
}

/** Posted to the thread when a market closes to betting (manual Close or auto-close on time). */
export function buildMarketCloseAnnouncement(): string {
	return '🔒 Betting is now closed on this market. Awaiting resolution.'
}

/** Posted to the thread when a market resolves: the winning outcome + aggregate paid-out/lost. */
export function buildMarketResolveAnnouncement(
	outcomeLabel: string,
	totalPaidOut: string,
	totalLost: string
): string {
	return (
		`✅ Market resolved: **${truncateForEmbed(outcomeLabel, 256)}**.\n` +
		`**${formatMarketPoints(totalPaidOut)}** paid out to winners · **${formatMarketPoints(totalLost)}** lost.`
	)
}

/** Posted to the thread when a market is voided (no winner): everyone's stake is refunded. */
export function buildMarketVoidAnnouncement(totalRefunded: string): string {
	return `⚖️ Market voided — no winner. All **${formatMarketPoints(totalRefunded)}** in stakes refunded.`
}

/**
 * The DM sent to one participant with the result of their wagers on a settled market. `net` is a
 * signed integer-point string (negative = net loss). `outcomeLabel` is the winning outcome, or null
 * on a void. Question/outcome are truncated to keep the DM within Discord's message limit.
 */
export function buildWagerResultDm(input: {
	question: string
	voided: boolean
	outcomeLabel: string | null
	staked: string
	returned: string
	net: string
}): string {
	const question = truncateForEmbed(input.question, 200)
	if (input.voided) {
		return `⚖️ The market “${question}” was voided — your **${formatMarketPoints(
			input.staked
		)}** stake was refunded.`
	}
	const negative = input.net.trim().startsWith('-')
	const zero = input.net.trim().replace(/^0+(?=\d)/, '') === '0'
	const emoji = zero ? '🤝' : negative ? '😔' : '🎉'
	const netDisplay = negative || zero ? formatMarketPoints(input.net) : `+${formatMarketPoints(input.net)}`
	const outcome = input.outcomeLabel ? `**${truncateForEmbed(input.outcomeLabel, 256)}**` : 'the market'
	return (
		`${emoji} “${question}” resolved: ${outcome}.\n` +
		`You staked **${formatMarketPoints(input.staked)}**, got back **${formatMarketPoints(
			input.returned
		)}** — net **${netDisplay}**.`
	)
}

/**
 * Build the market embed. `impliedOddsBps` is null on a fresh market (no bets yet) —
 * render "no bets yet", never 0% (null/100 would read as a real 0% probability).
 */
export function buildMarketEmbed(market: MarketDetail): DiscordEmbed {
	const closesUnix = Math.floor(new Date(market.closesAt).getTime() / 1000)

	// 1-based numbering doubles as the outcome picker in the resolve modal.
	const outcomeFields = market.outcomes.map((o, i) => ({
		name: truncateForEmbed(`${i + 1}. ${o.label}`, 256),
		value:
			o.impliedOddsBps === null
				? `${formatMarketPoints(o.poolAmount)} · no bets yet`
				: `${formatMarketPoints(o.poolAmount)} · ${(o.impliedOddsBps / 100).toFixed(1)}%`,
		inline: true,
	}))

	const embed: DiscordEmbed = {
		title: truncateForEmbed(market.question, 256),
		color: STATUS_COLOR[market.status] ?? STATUS_COLOR.draft,
		fields: [
			...outcomeFields,
			{ name: 'Total pool', value: formatMarketPoints(market.totalPool), inline: false },
			{ name: 'Closes', value: `<t:${closesUnix}:R>`, inline: false },
		],
		footer: { text: `Status: ${market.status}` },
	}
	if (market.description) {
		embed.description = truncateForEmbed(market.description, 4000)
	}
	return embed
}
