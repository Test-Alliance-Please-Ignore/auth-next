import { describe, expect, it } from 'vitest'

import { resolveEsiBadgeState } from '@/features/applications/routes/hr-member-profile'

describe('resolveEsiBadgeState', () => {
	it('shows valid for linked in-corp member with valid token', () => {
		const result = resolveEsiBadgeState({
			isInCorp: true,
			member: {
				hasAuthAccount: true,
				hasValidToken: true,
			} as any,
		})

		expect(result).toEqual({
			show: true,
			label: 'ESI Valid',
			variant: 'success',
		})
	})

	it('shows invalid for linked in-corp member with invalid token', () => {
		const result = resolveEsiBadgeState({
			isInCorp: true,
			member: {
				hasAuthAccount: true,
				hasValidToken: false,
			} as any,
		})

		expect(result).toEqual({
			show: true,
			label: 'ESI Invalid',
			variant: 'destructive',
		})
	})

	it('shows unknown for linked in-corp member with unknown token state', () => {
		const result = resolveEsiBadgeState({
			isInCorp: true,
			member: {
				hasAuthAccount: true,
				hasValidToken: null,
			} as any,
		})

		expect(result).toEqual({
			show: true,
			label: 'ESI Unknown',
			variant: 'warning',
		})
	})

	it('shows badge for external character and uses fulcrum token validity', () => {
		const result = resolveEsiBadgeState({
			isInCorp: false,
			hr: {
				hasValidToken: false,
			} as any,
		})

		expect(result).toEqual({
			show: true,
			label: 'ESI Invalid',
			variant: 'destructive',
		})
	})

	it('hides badge when character is in-corp but not linked', () => {
		const result = resolveEsiBadgeState({
			isInCorp: true,
			member: {
				hasAuthAccount: false,
				hasValidToken: null,
			} as any,
		})

		expect(result.show).toBe(false)
		expect(result.label).toBe('ESI Unknown')
	})
})
