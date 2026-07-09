/**
 * Typed domain errors for the prediction-markets DO.
 *
 * Every user-facing rejection is a `PmError` whose `code` is one of `PmErrorCode` — so a typo is a
 * compile error rather than a silently-unhandled string — and whose `message` IS that code. Only
 * `.message` survives the Durable Object RPC boundary, and core/discord consumers string-match on it
 * (e.g. `msg === 'MARKET_NOT_FOUND'`, `msg.startsWith('RATE_LIMITED')`), so the message contract is
 * preserved exactly.
 *
 * The `expected` flag never crosses RPC; it drives the DO's OWN Sentry-paging decision. Declaring it
 * at each throw (default: expected) replaces the three hand-maintained EXPECTED_* sets + parallel
 * `isExpected*` helpers with a single source of truth per error.
 */

export type PmErrorCode =
	| 'APPROVER_MUST_DIFFER'
	| 'AT_LEAST_TWO_OUTCOMES'
	| 'CLOSES_AT_NOT_EDITABLE'
	| 'CONTESTED_VOID_REQUIRES_APPROVER'
	| 'CREATOR_CANNOT_RESOLVE'
	| 'CREATOR_IS_RESOLVER'
	| 'DESIGNATED_RESOLVER_CANNOT_BET'
	| 'DESIGNATED_RESOLVERS_INSUFFICIENT_FOR_TWO_OF_N'
	| 'DUPLICATE_OUTCOMES'
	| 'IDEMPOTENCY_KEY_CONFLICT'
	| 'INSUFFICIENT_FUNDS'
	| 'INVALID_AMOUNT'
	| 'INVALID_CHANGE_NOTE'
	| 'INVALID_CLOSES_AT'
	| 'INVALID_CREATOR_REWARD'
	| 'INVALID_MAX_STAKE'
	| 'INVALID_MIN_STAKE'
	| 'INVALID_PER_USER_CAP'
	| 'INVALID_RAKE'
	| 'INVALID_RESOLVES_ON'
	| 'INVALID_THRESHOLD'
	| 'MARKET_CLOSED'
	| 'MARKET_CREATE_FAILED'
	| 'MARKET_NOT_CLOSED'
	| 'MARKET_NOT_EDITABLE'
	| 'MARKET_NOT_FOUND'
	| 'MARKET_NOT_OPEN'
	| 'MARKET_NOT_RESOLVING'
	| 'MARKET_TERMINAL'
	| 'NOT_DESIGNATED_RESOLVER'
	| 'OUTCOME_NOT_FOUND'
	| 'PER_USER_CAP_EXCEEDED'
	| 'PROPOSAL_NOT_FOUND'
	| 'PROPOSAL_NOT_PENDING'
	| 'QUESTION_REQUIRED'
	| 'RATE_LIMITED'
	| 'REASON_REQUIRED'
	| 'RESOLVER_HAS_POSITION'
	| 'RESOLVES_ON_BEFORE_CLOSE'
	| 'SELF_TARGET_FORBIDDEN'
	| 'STAKE_ABOVE_MAX'
	| 'STAKE_BELOW_MIN'
	| 'SYSTEM_TARGET_FORBIDDEN'
	| 'THRESHOLD_WOULD_STRAND'
	| 'TOO_MANY_OUTCOMES'
	| 'VOID_REASON_REQUIRED'

export class PmError extends Error {
	readonly code: PmErrorCode
	/** True for normal user-facing rejections (surfaced but NOT paged); false for internal invariants. */
	readonly expected: boolean

	constructor(code: PmErrorCode, opts?: { expected?: boolean; detail?: string | number }) {
		// message === code (optionally `code:detail`, e.g. `RATE_LIMITED:1234`) so the existing
		// string-matching consumers across the RPC boundary keep working — the class and its extra
		// properties do NOT survive RPC serialization, only `.message` does.
		super(opts?.detail != null ? `${code}:${opts.detail}` : code)
		this.name = 'PmError'
		this.code = code
		this.expected = opts?.expected ?? true
	}
}

/** Prefix of the raw Error thrown by the state-machine's `assertTransition` (a stale-state guard). */
const TRANSITION_ERROR_PREFIX = 'prediction-markets: invalid market transition'

/**
 * True for expected (user-facing) rejections the DO should surface to the caller WITHOUT paging Sentry.
 * Replaces the former `isExpectedBetError` / `isExpectedResolverError` / `EXPECTED_MARKET_EDIT_ERRORS`
 * trio: a `PmError` carries its own verdict, and the one non-`PmError` expected throw — the
 * state-machine's `assertTransition` — is matched by its stable message prefix.
 */
export function isExpectedError(error: unknown): boolean {
	if (error instanceof PmError) return error.expected
	const msg = error instanceof Error ? error.message : String(error)
	return msg.startsWith(TRANSITION_ERROR_PREFIX)
}
