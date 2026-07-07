/**
 * Fixed-window rate-limit budgets + the pure window computation.
 *
 * The DO applies this as an atomic Postgres upsert (SQL mirrors `nextRateState`); this
 * module exists so the window math is unit-testable without a database.
 */

export interface RateBudget {
	/** Max allowed occurrences within the window. */
	limit: number
	windowMs: number
}

/** Per-command budgets. Bets are the spammable path; other commands aren't rate-limited yet. */
export const RATE_BUDGETS: Record<string, RateBudget> = {
	bet: { limit: 5, windowMs: 10_000 },
}

export interface RateState {
	newWindowStartMs: number
	newCount: number
	allowed: boolean
	retryAfterMs: number
}

/**
 * Given the stored window start + count and the current time, compute the post-increment
 * state: reset the window if it has expired, else increment; allow while count ≤ limit.
 */
export function nextRateState(
	windowStartMs: number,
	count: number,
	nowMs: number,
	budget: RateBudget
): RateState {
	const expired = nowMs - windowStartMs >= budget.windowMs
	const newWindowStartMs = expired ? nowMs : windowStartMs
	const newCount = expired ? 1 : count + 1
	const allowed = newCount <= budget.limit
	const retryAfterMs = allowed ? 0 : Math.max(0, newWindowStartMs + budget.windowMs - nowMs)
	return { newWindowStartMs, newCount, allowed, retryAfterMs }
}
