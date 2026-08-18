import { afterEach, describe, expect, it, vi } from 'vitest'

import { getApplicationProfileNavigationFromReferrer } from '@/features/applications/utils/profile-navigation'

describe('getApplicationProfileNavigationFromReferrer', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('derives application back context from a same-origin referrer', () => {
		vi.stubGlobal('window', { location: { origin: 'https://pleaseignore.app' } })
		vi.stubGlobal('document', {
			referrer: 'https://pleaseignore.app/corporations/123/applications/456?tab=messages#notes',
		} as Document)

		expect(getApplicationProfileNavigationFromReferrer()).toEqual({
			source: 'applications',
			returnTo: '/corporations/123/applications/456?tab=messages#notes',
			corporationId: '123',
		})
	})

	it('ignores cross-origin referrers', () => {
		vi.stubGlobal('window', { location: { origin: 'https://pleaseignore.app' } })
		vi.stubGlobal('document', { referrer: 'https://example.com/corporations/123/applications/456' })

		expect(getApplicationProfileNavigationFromReferrer()).toBeNull()
	})

	it('ignores referrers that are not application review pages', () => {
		vi.stubGlobal('window', { location: { origin: 'https://pleaseignore.app' } })
		vi.stubGlobal('document', { referrer: 'https://pleaseignore.app/hr/users' })

		expect(getApplicationProfileNavigationFromReferrer()).toBeNull()
	})
})
