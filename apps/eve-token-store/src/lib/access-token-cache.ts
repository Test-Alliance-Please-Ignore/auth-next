export const ACCESS_TOKEN_REFRESH_SAFETY_MARGIN_MS = 60 * 1000
export const ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

/** A cached token is usable only while it remains outside the refresh margin. */
export function isWarmAccessTokenUsable(expiresAtMs: number, nowMs = Date.now()): boolean {
	return expiresAtMs > nowMs + ACCESS_TOKEN_REFRESH_SAFETY_MARGIN_MS
}

/** Expiry cutoff used by the bounded hourly maintenance sweep. */
export function getExpiredAccessTokenCutoff(nowMs = Date.now()): number {
	return nowMs
}
