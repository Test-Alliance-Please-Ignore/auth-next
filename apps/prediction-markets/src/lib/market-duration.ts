/**
 * Max market-open-duration boundary — the DB-free, unit-testable seam behind the create-time cap.
 *
 * A market's "open time" is the window from creation to `closesAt` (the betting phase). Non-admin
 * creators are capped at {@link MAX_MARKET_OPEN_DURATION_MS}; site admins are exempt (the exemption is
 * the caller's concern — this is only the boundary test). `now` is injected so the boundary is
 * deterministic under test.
 */

import { MAX_MARKET_OPEN_DURATION_MS } from '@repo/prediction-markets'

/**
 * True when a market's open window (`now` → `closesAt`) exceeds the max allowed duration. Exactly the
 * max window is allowed; one millisecond beyond it is not.
 */
export function exceedsMaxOpenDuration(closesAt: Date, now: number): boolean {
	return closesAt.getTime() - now > MAX_MARKET_OPEN_DURATION_MS
}
