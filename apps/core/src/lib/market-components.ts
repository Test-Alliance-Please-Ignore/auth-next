/**
 * Builds the message-component (button) rows shown on a market's forum post.
 * P2: one "bet on <outcome>" button per outcome (open markets only).
 */

import { DISCORD_BUTTON_STYLE, DISCORD_COMPONENT_TYPE } from '@repo/discord'

import { encodeBetButtonId } from './market-custom-id'
import { truncateForEmbed } from './market-embed'

import type { DiscordActionRow, DiscordButtonComponent } from '@repo/discord'
import type { MarketDetail } from '@repo/prediction-markets'

const MAX_BUTTONS_PER_ROW = 5
const MAX_ROWS = 5
const MAX_BUTTONS = MAX_BUTTONS_PER_ROW * MAX_ROWS // Discord: 25 buttons/message

/**
 * Bet buttons for an open market (empty for closed/resolved/voided — the post shows no
 * betting controls). Outcomes are capped at 25; markets are validated to ≤20 outcomes.
 */
export function buildMarketComponents(market: MarketDetail): DiscordActionRow[] {
	if (market.status !== 'open') return []

	const buttons: DiscordButtonComponent[] = market.outcomes.slice(0, MAX_BUTTONS).map((o) => ({
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.PRIMARY,
		label: truncateForEmbed(o.label, 80),
		custom_id: encodeBetButtonId(market.id, o.id),
	}))

	const rows: DiscordActionRow[] = []
	for (let i = 0; i < buttons.length; i += MAX_BUTTONS_PER_ROW) {
		rows.push({
			type: DISCORD_COMPONENT_TYPE.ACTION_ROW,
			components: buttons.slice(i, i + MAX_BUTTONS_PER_ROW),
		})
	}
	return rows
}
