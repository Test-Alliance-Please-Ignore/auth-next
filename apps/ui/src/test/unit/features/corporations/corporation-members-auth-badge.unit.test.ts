import { describe, expect, it } from 'vitest'

import { getAuthStatusBadge } from '@/features/corporations/components/corporation-members-table'

describe('getAuthStatusBadge', () => {
	it('returns not linked when auth account is missing', () => {
		expect(getAuthStatusBadge({ hasAuthAccount: false, hasValidToken: null })).toEqual({
			variant: 'warning',
			label: 'Unlinked',
		})
	})

	it('returns linked valid when token is valid', () => {
		expect(getAuthStatusBadge({ hasAuthAccount: true, hasValidToken: true })).toEqual({
			variant: 'success',
			label: 'ESI Valid',
		})
	})

	it('returns linked invalid when token is invalid', () => {
		expect(getAuthStatusBadge({ hasAuthAccount: true, hasValidToken: false })).toEqual({
			variant: 'destructive',
			label: 'ESI Invalid',
		})
	})

	it('returns linked unknown when token state is unknown', () => {
		expect(getAuthStatusBadge({ hasAuthAccount: true, hasValidToken: null })).toEqual({
			variant: 'warning',
			label: 'ESI Unknown',
		})
	})
})
