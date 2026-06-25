import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetReviewQueueSnapshotStoreForTests,
	restoreReviewQueueStateFromRollback,
	snapshotReviewQueueStateForRollback,
	setReviewQueueSnapshot,
	transitionRequestStatusAcrossReviewQueueSnapshots,
	upsertRequestAcrossReviewQueueSnapshots,
} from '@/features/srp/state/review-queue-snapshot-store'

describe('review-queue-snapshot-store', () => {
	beforeEach(() => {
		__resetReviewQueueSnapshotStoreForTests()
	})

	it('survives malformed snapshot request arrays during optimistic SRP updates', () => {
		setReviewQueueSnapshot(
			'approved',
			{},
			{
				requests: [],
				total: 0,
				limit: 25,
				offset: 0,
			}
		)

		const corrupted = snapshotReviewQueueStateForRollback()
		const snapshotKey = Object.keys(corrupted.snapshots)[0]
		if (!snapshotKey) {
			throw new Error('Expected review queue snapshot to exist')
		}
		corrupted.snapshots[snapshotKey].data.requests = undefined as unknown as never[]
		restoreReviewQueueStateFromRollback(corrupted)

		expect(() => transitionRequestStatusAcrossReviewQueueSnapshots('request-1', 'approved')).not.toThrow()
		expect(() =>
			upsertRequestAcrossReviewQueueSnapshots({
				id: 'request-1',
				requestStatus: 'approved',
				lossDate: new Date().toISOString(),
				characterName: 'Test Pilot',
				shipTypeName: 'Test Hull',
				solarSystemName: 'Test System',
			} as any)
		).not.toThrow()

		const next = snapshotReviewQueueStateForRollback()
		expect(next.snapshots[snapshotKey].data.requests).toHaveLength(1)
		expect(next.entities['request-1']).toBeDefined()
	})
})
