import { describe, expect, it } from 'vitest'

import {
	classifySsoError,
	isPermanentRefreshFailure,
	isRefreshBackstopExpired,
	shouldForcePermanentByInvalidAge,
} from './token-health'

describe('token-health helpers', () => {
	it('detects refresh backstop expiry after 24h', () => {
		const now = Date.now()
		expect(isRefreshBackstopExpired(new Date(now - 25 * 60 * 60 * 1000), now)).toBe(true)
		expect(isRefreshBackstopExpired(new Date(now - 23 * 60 * 60 * 1000), now)).toBe(false)
	})

	it('detects 7-day invalid-state permanence threshold', () => {
		const now = Date.now()
		expect(shouldForcePermanentByInvalidAge(new Date(now - 8 * 24 * 60 * 60 * 1000), now)).toBe(
			true
		)
		expect(shouldForcePermanentByInvalidAge(new Date(now - 6 * 24 * 60 * 60 * 1000), now)).toBe(
			false
		)
		expect(shouldForcePermanentByInvalidAge(null, now)).toBe(false)
	})

	it('classifies SSO auth failures as invalid_token', () => {
		expect(classifySsoError('Token refresh failed (status: 401): invalid_grant')).toBe(
			'invalid_token'
		)
		expect(classifySsoError('Token refresh failed (status: 400): invalid token')).toBe(
			'invalid_token'
		)
	})

	it('classifies non-auth errors as transient_error', () => {
		expect(classifySsoError('Network timeout while refreshing token')).toBe('transient_error')
	})

	it('flags permanent refresh failures', () => {
		expect(isPermanentRefreshFailure('invalid_grant')).toBe(true)
		expect(isPermanentRefreshFailure('invalid refresh token')).toBe(true)
		expect(isPermanentRefreshFailure('token missing/expired')).toBe(true)
		expect(isPermanentRefreshFailure('429 Too Many Requests')).toBe(false)
	})
})
