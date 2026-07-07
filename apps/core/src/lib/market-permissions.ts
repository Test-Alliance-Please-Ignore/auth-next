/**
 * Prediction-market permission tiers (mirrors the SRP tier ladder in routes/srp.ts).
 *
 * Resolver-only actions (close / resolve / void) self-gate in the component handler on the
 * stable `urn:markets:resolver` URN — buttons are visible to everyone in the forum thread, so
 * gating must be server-side, never by hiding the button. `is_admin` bypasses the tier.
 *
 * Tiers (each independent, `manager` is the superset of all):
 * - `creator`  — may create markets (member-facing create route).
 * - `resolver` — may close/resolve/void markets.
 * - `manager`  — full control; satisfies every tier.
 */

import { getCachedUserPermissions } from './groups-cache'

export type MarketTier = 'resolver' | 'manager' | 'creator'

export const MARKET_ROLE_URNS = [
	'urn:markets:resolver',
	'urn:markets:manager',
	'urn:markets:creator',
] as const

/** URNs that satisfy `tier` — `manager` is a superset of both `resolver` and `creator`. */
export function getMarketTierPermissions(tier: MarketTier): string[] {
	switch (tier) {
		case 'manager':
			return ['urn:markets:manager']
		case 'resolver':
			return ['urn:markets:resolver', 'urn:markets:manager']
		case 'creator':
			return ['urn:markets:creator', 'urn:markets:manager']
	}
}

export async function hasMarketPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	tier: MarketTier,
	isAdmin: boolean
): Promise<boolean> {
	if (isAdmin) return true
	const perms = await getCachedUserPermissions(env, userId)
	const allowed = new Set(getMarketTierPermissions(tier))
	return perms.some((p) => allowed.has(p.urn))
}
