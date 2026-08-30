import { describe, expect, it } from 'vitest'

import { canEditTimerboard, canViewTimerboard } from '@/features/timerboard/permissions'

describe('Timerboard permission helpers', () => {
	it('shows Timerboard navigation for view, edit, manage, or site-admin access', () => {
		expect(canViewTimerboard(['urn:timerboard:view'], false)).toBe(true)
		expect(canViewTimerboard(['urn:timerboard:edit'], false)).toBe(true)
		expect(canViewTimerboard(['urn:timerboard:manage'], false)).toBe(true)
		expect(canViewTimerboard([], true)).toBe(true)
		expect(canViewTimerboard([], false)).toBe(false)
	})

	it('limits creation and editing to edit, manage, or site-admin access', () => {
		expect(canEditTimerboard(['urn:timerboard:view'], false)).toBe(false)
		expect(canEditTimerboard(['urn:timerboard:edit'], false)).toBe(true)
		expect(canEditTimerboard(['urn:timerboard:manage'], false)).toBe(true)
		expect(canEditTimerboard([], true)).toBe(true)
	})
})
