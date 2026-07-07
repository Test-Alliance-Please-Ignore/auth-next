/**
 * Builds the Discord embed shown in a prediction market's forum post.
 * Pure (no I/O) so it is unit-testable and reusable across create/update flows.
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
 * Build the market embed. `impliedOddsBps` is null on a fresh market (no bets yet) —
 * render "no bets yet", never 0% (null/100 would read as a real 0% probability).
 */
export function buildMarketEmbed(market: MarketDetail): DiscordEmbed {
	const closesUnix = Math.floor(new Date(market.closesAt).getTime() / 1000)

	const outcomeFields = market.outcomes.map((o) => ({
		name: truncateForEmbed(o.label, 256),
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
