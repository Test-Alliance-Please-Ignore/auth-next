/**
 * Builds the message-component (button) rows shown on a market's forum post, per status:
 *   - open:      "bet on <outcome>" buttons  +  [Close, Void]      (members bet; resolvers manage)
 *   - closed:    [Resolve, Void]
 *   - resolving: [Approve, Void]              (a two-of-N proposal is pending)
 *   - resolved / voided / draft: none (terminal posts show no controls)
 *
 * Resolver buttons are visible to everyone — the handler gates them server-side on
 * `urn:markets:resolver`. Discord caps 5 rows × 5 buttons; markets are ≤20 outcomes, so
 * 20 bet buttons (4 rows) + a resolver row still fits within 5 rows.
 */

import { DISCORD_BUTTON_STYLE, DISCORD_COMPONENT_TYPE } from '@repo/discord'

import { encodeBetButtonId, encodeMarketActionId } from './market-custom-id'
import { truncateForEmbed } from './market-embed'

import type { DiscordActionRow, DiscordButtonComponent } from '@repo/discord'
import type { MarketDetail } from '@repo/prediction-markets'

const MAX_BUTTONS_PER_ROW = 5
const MAX_BET_BUTTONS = 20 // markets are validated to ≤20 outcomes

function actionRow(components: DiscordButtonComponent[]): DiscordActionRow {
	return { type: DISCORD_COMPONENT_TYPE.ACTION_ROW, components }
}

function betButtonRows(market: MarketDetail): DiscordActionRow[] {
	const buttons: DiscordButtonComponent[] = market.outcomes.slice(0, MAX_BET_BUTTONS).map((o) => ({
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.PRIMARY,
		label: truncateForEmbed(o.label, 80),
		custom_id: encodeBetButtonId(market.id, o.id),
	}))
	const rows: DiscordActionRow[] = []
	for (let i = 0; i < buttons.length; i += MAX_BUTTONS_PER_ROW) {
		rows.push(actionRow(buttons.slice(i, i + MAX_BUTTONS_PER_ROW)))
	}
	return rows
}

function resolveButton(id: string): DiscordButtonComponent {
	return {
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.SUCCESS,
		label: 'Resolve',
		custom_id: id,
	}
}
function approveButton(id: string): DiscordButtonComponent {
	return {
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.SUCCESS,
		label: 'Approve resolution',
		custom_id: id,
	}
}
function closeButton(id: string): DiscordButtonComponent {
	return {
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.SECONDARY,
		label: 'Close',
		custom_id: id,
	}
}
function voidButton(id: string): DiscordButtonComponent {
	return {
		type: DISCORD_COMPONENT_TYPE.BUTTON,
		style: DISCORD_BUTTON_STYLE.DANGER,
		label: 'Void',
		custom_id: id,
	}
}

export function buildMarketComponents(market: MarketDetail): DiscordActionRow[] {
	const close = encodeMarketActionId('close', market.id)
	const resolve = encodeMarketActionId('resolve', market.id)
	const voidId = encodeMarketActionId('void', market.id)
	const approve = encodeMarketActionId('approve', market.id)

	switch (market.status) {
		case 'open':
			return [...betButtonRows(market), actionRow([closeButton(close), voidButton(voidId)])]
		case 'closed':
			return [actionRow([resolveButton(resolve), voidButton(voidId)])]
		case 'resolving':
			return [actionRow([approveButton(approve), voidButton(voidId)])]
		default:
			// resolved / voided / draft — no controls.
			return []
	}
}
