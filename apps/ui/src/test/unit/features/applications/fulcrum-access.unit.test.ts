import { describe, expect, it } from 'vitest'

import { canViewFulcrumTab } from '@/features/applications/utils/fulcrum-access'

describe('canViewFulcrumTab', () => {
	it('allows site admins to see the tab for open applications', () => {
		expect(
			canViewFulcrumTab({
				applicationStatus: 'pending',
				isAdmin: true,
			})
		).toBe(true)
	})

	it('allows hr reviewer and hr admin roles for open applications', () => {
		expect(
			canViewFulcrumTab({
				applicationStatus: 'under_review',
				currentRole: 'hr_reviewer',
				isAdmin: false,
			})
		).toBe(true)

		expect(
			canViewFulcrumTab({
				applicationStatus: 'accepted',
				currentRole: 'hr_admin',
				isAdmin: false,
			})
		).toBe(true)
	})

	it('hides the tab for closed applications regardless of role', () => {
		expect(
			canViewFulcrumTab({
				applicationStatus: 'completed',
				currentRole: 'hr_admin',
				isAdmin: true,
			})
		).toBe(false)
	})

	it('hides the tab for open applications when the user lacks access', () => {
		expect(
			canViewFulcrumTab({
				applicationStatus: 'pending',
				currentRole: 'hr_viewer',
				isAdmin: false,
			})
		).toBe(false)
	})
})
