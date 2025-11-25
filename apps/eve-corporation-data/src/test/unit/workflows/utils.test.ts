import { describe, expect, it } from 'vitest'

import { createShouldSyncPredicate } from '../../../workflows/utils/should-sync'
import { createSyncedDataTracker } from '../../../workflows/utils/synced-data'

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

	it('tracks synced data types immutably', () => {
		const tracker = createSyncedDataTracker()

		const first = tracker.add('members')
		const second = tracker.add('wallets')

		expect(first).toEqual(['members'])
		expect(second).toEqual(['members', 'wallets'])
		expect(tracker.get()).toEqual(['members', 'wallets'])
	})

	it('handles duplicate additions by appending entries', () => {
		const tracker = createSyncedDataTracker()
		tracker.add('members')
		tracker.add('members')

		expect(tracker.get()).toEqual(['members', 'members'])
	})
})

