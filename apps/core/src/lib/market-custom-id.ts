/**
 * Encode/decode Discord `custom_id` strings for prediction-market interactions.
 *
 * Scheme is `:`-delimited and carries UUIDs directly (≤100-char limit; a bet id is ~77).
 * P2 uses the bet flow; resolver ids (close/resolve/void) arrive in P3.
 */

export interface BetTarget {
	marketId: string
	outcomeId: string
}

/** Bet button (on the post): `bet:<marketId>:<outcomeId>`. Clicking opens the stake modal. */
export function encodeBetButtonId(marketId: string, outcomeId: string): string {
	return `bet:${marketId}:${outcomeId}`
}

/**
 * Stake modal (opened by the bet button): `betmodal:<marketId>:<outcomeId>`.
 * Note: the interactions worker (apps/discord) builds this same string inline when opening
 * the modal (it can't import core); keep the two in sync. `decodeBetTarget` parses both.
 */
export function encodeBetModalId(marketId: string, outcomeId: string): string {
	return `betmodal:${marketId}:${outcomeId}`
}

/** The action prefix of a custom_id (the segment before the first ':'). */
export function customIdAction(customId: string): string {
	const idx = customId.indexOf(':')
	return idx === -1 ? customId : customId.slice(0, idx)
}

/** Parse a `bet:`/`betmodal:` custom_id into its target ids; null if malformed. */
export function decodeBetTarget(customId: string): BetTarget | null {
	const parts = customId.split(':')
	if (parts.length !== 3) return null
	const [action, marketId, outcomeId] = parts
	if (action !== 'bet' && action !== 'betmodal') return null
	if (!marketId || !outcomeId) return null
	return { marketId, outcomeId }
}

/** The text-input custom_id inside the stake modal (its own 100-char budget). */
export const BET_AMOUNT_INPUT_ID = 'amount'
