import { describe, expect, it } from 'vitest'

import { createShouldSyncPredicate } from '../../../workflows/utils/should-sync'

describe('workflow utilities', () => {
	it('returns true for all data types when no filters provided', () => {
		const shouldSync = createShouldSyncPredicate()

		expect(shouldSync('members')).toBe(true)
		expect(shouldSync('wallets')).toBe(true)
	})

	it('filters sync types when specific data types provided', () => {
		const shouldSync = createShouldSyncPredicate(['members', 'wallets'])

		expect(shouldSync('members')).toBe(true)
		expect(shouldSync('wallets')).toBe(true)
		expect(shouldSync('assets')).toBe(false)
	})

	it('treats empty arrays as syncing all types', () => {
		const shouldSync = createShouldSyncPredicate([])

		expect(shouldSync('members')).toBe(true)
		expect(shouldSync('wallets')).toBe(true)
	})
})
