import { describe, expect, it } from 'vitest'

import { getSnapshotDeleteCount } from './snapshot-retention'

describe('getSnapshotDeleteCount', () => {
	it('deletes only the excess snapshots', () => {
		expect(getSnapshotDeleteCount(5, 3)).toBe(2)
	})

	it('does not delete snapshots at the retention limit', () => {
		expect(getSnapshotDeleteCount(3, 3)).toBe(0)
	})

	it('does not delete snapshots below the retention limit', () => {
		expect(getSnapshotDeleteCount(2, 3)).toBe(0)
	})

	it('does not delete when retention is disabled or invalid', () => {
		expect(getSnapshotDeleteCount(5, 0)).toBe(0)
		expect(getSnapshotDeleteCount(5, -1)).toBe(0)
	})
})
