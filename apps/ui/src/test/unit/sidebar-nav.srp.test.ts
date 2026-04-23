import { describe, expect, it } from 'vitest'

import { resolveSrpNavState } from '@/components/sidebar-nav.srp'

function resolve(overrides: Partial<Parameters<typeof resolveSrpNavState>[0]> = {}) {
	return resolveSrpNavState({
		srpEnabled: true,
		isSiteAdmin: false,
		hasSrpReviewerPermission: false,
		hasSrpPayerPermission: false,
		hasSrpManagerPermission: false,
		reviewQueueCount: 4,
		paymentQueueCount: 3,
		srpAlertCount: 2,
		...overrides,
	})
}

describe('resolveSrpNavState', () => {
	it('uses external SRP link when feature flag is disabled', () => {
		const state = resolve({ srpEnabled: false })
		expect(state.navItem).toEqual({
			label: 'SRP',
			href: 'https://reimbursement.pleaseignore.com/',
			external: true,
		})
		expect(state.shouldFetchSrpReviewCount).toBe(false)
		expect(state.shouldFetchSrpPaymentCount).toBe(false)
		expect(state.shouldFetchSrpAlertCount).toBe(false)
	})

	it('shows non-staff single-link SRP nav when feature flag is enabled', () => {
		const state = resolve()
		expect(state.navItem).toEqual({
			label: 'SRP',
			href: '/srp/my-requests',
		})
		expect(state.shouldFetchSrpReviewCount).toBe(false)
		expect(state.shouldFetchSrpPaymentCount).toBe(false)
		expect(state.shouldFetchSrpAlertCount).toBe(false)
	})

	it('shows reviewer menu items and only fetches review count', () => {
		const state = resolve({ hasSrpReviewerPermission: true })
		expect(state.navItem.children?.map((child) => child.label)).toEqual([
			'My Requests',
			'Review Queue',
		])
		expect(state.navItem.children?.find((child) => child.label === 'Review Queue')?.badge).toBe(4)
		expect(state.shouldFetchSrpReviewCount).toBe(true)
		expect(state.shouldFetchSrpPaymentCount).toBe(false)
		expect(state.shouldFetchSrpAlertCount).toBe(false)
	})

	it('shows payer as higher-tier reviewer with payment queue and fetches both counts', () => {
		const state = resolve({ hasSrpPayerPermission: true })
		expect(state.navItem.children?.map((child) => child.label)).toEqual([
			'My Requests',
			'Review Queue',
			'Payment Queue',
		])
		expect(state.shouldFetchSrpReviewCount).toBe(true)
		expect(state.shouldFetchSrpPaymentCount).toBe(true)
		expect(state.shouldFetchSrpAlertCount).toBe(false)
	})

	it('shows manager with full SRP menu and all count fetches enabled', () => {
		const state = resolve({ hasSrpManagerPermission: true })
		expect(state.navItem.children?.map((child) => child.label)).toEqual([
			'My Requests',
			'Review Queue',
			'Payment Queue',
			'Alerts',
			'Configuration',
		])
		expect(state.shouldFetchSrpReviewCount).toBe(true)
		expect(state.shouldFetchSrpPaymentCount).toBe(true)
		expect(state.shouldFetchSrpAlertCount).toBe(true)
	})

	it('shows site-admin with full SRP menu and all count fetches enabled', () => {
		const state = resolve({ isSiteAdmin: true })
		expect(state.navItem.children?.map((child) => child.label)).toEqual([
			'My Requests',
			'Review Queue',
			'Payment Queue',
			'Alerts',
			'Configuration',
		])
		expect(state.shouldFetchSrpReviewCount).toBe(true)
		expect(state.shouldFetchSrpPaymentCount).toBe(true)
		expect(state.shouldFetchSrpAlertCount).toBe(true)
	})
})
