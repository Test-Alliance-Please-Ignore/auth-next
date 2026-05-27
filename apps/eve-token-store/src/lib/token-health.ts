import type { TokenValidationResult } from '@repo/eve-token-store'

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
export const INVALID_STALE_PERMANENT_MS = 7 * 24 * 60 * 60 * 1000

export function isRefreshBackstopExpired(expiresAt: Date, nowMs = Date.now()): boolean {
	return nowMs - expiresAt.getTime() > TWENTY_FOUR_HOURS_MS
}

export function shouldForcePermanentByInvalidAge(
	invalidSince: Date | null,
	nowMs = Date.now()
): boolean {
	if (!invalidSince) return false
	return nowMs - invalidSince.getTime() > INVALID_STALE_PERMANENT_MS
}

export function classifySsoError(errorMessage: string): TokenValidationResult['status'] {
	const normalizedError = errorMessage.toLowerCase()

	if (
		normalizedError.includes('status: 400') ||
		normalizedError.includes('status: 401') ||
		normalizedError.includes('status: 403') ||
		normalizedError.includes('invalid_grant') ||
		normalizedError.includes('invalid token')
	) {
		return 'invalid_token'
	}

	return 'transient_error'
}

export function isPermanentRefreshFailure(errorMessage: string): boolean {
	const normalizedError = errorMessage.toLowerCase()
	return (
		normalizedError.includes('invalid_grant') ||
		normalizedError.includes('invalid refresh token') ||
		normalizedError.includes('token missing/expired')
	)
}
