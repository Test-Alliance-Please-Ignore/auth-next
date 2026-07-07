/**
 * Prediction-market permission tiers (mirrors the SRP tier ladder in routes/srp.ts).
 *
 * Resolver-only actions (close / resolve / void) self-gate in the component handler on the
 * stable `urn:markets:resolver` URN — buttons are visible to everyone in the forum thread, so
 * gating must be server-side, never by hiding the button. `is_admin` bypasses the tier.
 */

import { getCachedUserPermissions } from './groups-cache'

export type MarketTier = 'resolver' | 'manager'

export const MARKET_ROLE_URNS = ['urn:markets:resolver', 'urn:markets:manager'] as const

/** URNs that satisfy `tier` (manager is a superset of resolver). */
export function getMarketTierPermissions(tier: MarketTier): string[] {
	return tier === 'manager'
		? ['urn:markets:manager']
		: ['urn:markets:resolver', 'urn:markets:manager']
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
