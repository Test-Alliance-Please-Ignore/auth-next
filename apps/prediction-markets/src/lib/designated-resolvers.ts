/**
 * Per-market "designated resolvers" — the market maker may restrict WHICH resolvers can settle a
 * given market. This module is the pure, DB-free core of that rule (the only unit-testable seam,
 * since the settlement guards themselves run inside a live Postgres transaction).
 *
 * Semantics:
 * - A market's designated set is a (possibly empty/absent) list of core user ids.
 * - NULL / empty  => NO designation => today's GLOBAL authority (any resolver/manager/admin may act).
 *   This keystone keeps the whole feature purely additive: every legacy / in-flight market with no
 *   set behaves exactly as before, with no backfill.
 * - Non-empty     => authority is NARROWED to the listed ids (plus the admin/manager `bypass`).
 *
 * Designation NARROWS, it never GRANTS: Core still runs the coarse `urn:markets:resolver` tier gate
 * before any settlement RPC, and each designee is validated to hold that tier at create time. The DO
 * check here can only REMOVE authority from a tier-holder not on the set — it can never hand
 * settlement power to a non-resolver.
 *
 * All ids are lowercase-canonicalized (Postgres stores `uuid` lowercased; JS string compares are
 * case-sensitive) so membership comparisons can't be defeated by a case-variant uuid.
 */

/** Lowercase-canonical form of a single id (uuid compares are case-sensitive in JS, not in Postgres). */
function canon(id: string): string {
	return id.toLowerCase()
}

/**
 * Normalize a create-time designated-resolver list into the stored form: lowercase-canonicalized,
 * de-duplicated, and collapsed to `undefined` when empty. Using `undefined` (not `[]`) for "no
 * designation" makes the guard branch unambiguous — `[]` is truthy in JS, which would otherwise
 * misfire the two-of-N minimum-set check. Callers persist `undefined` as SQL NULL.
 */
export function normalizeDesignatedResolvers(
	ids: readonly string[] | null | undefined
): string[] | undefined {
	if (!ids || ids.length === 0) return undefined
	const deduped = [...new Set(ids.map(canon))]
	return deduped.length > 0 ? deduped : undefined
}

/**
 * May `actorId` settle a market carrying `designated` (as stored: lowercased, or NULL/empty)?
 * - `bypass` (admin/manager) short-circuits the MEMBERSHIP check only — the caller is still subject
 *   to every conflict-of-interest guard (creator≠resolver, no-position, 2-of-N) applied separately.
 * - NULL/empty designated set => global authority => allowed.
 * - Otherwise the actor must be a member of the set.
 */
export function canResolveDesignated(
	designated: readonly string[] | null | undefined,
	actorId: string,
	bypass: boolean
): boolean {
	if (bypass) return true
	if (!designated || designated.length === 0) return true
	return designated.includes(canon(actorId))
}

/**
 * Is `userId` a designated resolver of a market carrying `designated`? Used to block a designated
 * resolver from BETTING on the market they're designated to settle — a bet would trip the
 * `RESOLVER_HAS_POSITION` guard at settle time and (for a small/size-1 set) could strand the market.
 * Keeping designated resolvers position-free upholds the locked "resolver holds no position" rule.
 */
export function isDesignatedResolver(
	designated: readonly string[] | null | undefined,
	userId: string
): boolean {
	if (!designated || designated.length === 0) return false
	return designated.includes(canon(userId))
}

/**
 * Did `actorId` settle a market by using the admin/manager `bypass` to override a real designated
 * set they're NOT a member of? True only when a narrowing set exists AND the actor is not in it AND
 * bypass was used — i.e. an authority override worth recording in the audit trail. An undesignated
 * market (global authority) is never an "override", even for an admin.
 */
export function isDesignatedOverride(
	designated: readonly string[] | null | undefined,
	actorId: string,
	bypass: boolean
): boolean {
	return (
		bypass && !!designated && designated.length > 0 && !isDesignatedResolver(designated, actorId)
	)
}
