import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetReviewQueueSnapshotStoreForTests,
	getReviewQueueUiState,
	restoreReviewQueueStateFromRollback,
	setReviewQueueActiveTab,
	setReviewQueuePage,
	setReviewQueuePageSize,
	setReviewQueueSnapshot,
	snapshotReviewQueueStateForRollback,
	transitionRequestStatusAcrossReviewQueueSnapshots,
	toggleReviewQueueSort,
	updateReviewQueueFilters,
} from '@/features/srp/state/review-queue-snapshot-store'

import type { SRPRequestResponse } from '@/features/srp/types'

function makeRequest(
	id: string,
	requestStatus: SRPRequestResponse['requestStatus']
): SRPRequestResponse {
	return {
		id,
		userId: 'u1',
		characterId: 'c1',
		characterName: 'Char One',
		corporationId: 'corp1',
		corporationName: 'Corp One',
		killmailHash: 'hash',
		killmailUrl: `https://zkillboard.com/kill/${id}/`,
		lossDate: '2026-01-01T00:00:00.000Z',
		shipTypeId: '587',
		shipTypeName: 'Rifter',
		shipValue: '1000000',
		requestStatus,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe('srp review queue snapshot store', () => {
	beforeEach(() => {
		__resetReviewQueueSnapshotStoreForTests()
	})

	it('tracks active tab, resets page, and uses the tab default sort direction', () => {
		setReviewQueuePage(4)
		setReviewQueueActiveTab('approved')
		const state = getReviewQueueUiState()
		expect(state.activeTab).toBe('approved')
		expect(state.page).toBe(1)
		expect(state.sortDirection).toBe('desc')
	})

	it('resets page when filters change', () => {
		setReviewQueuePage(3)
		updateReviewQueueFilters({ characterName: 'Alpha' })
		expect(getReviewQueueUiState().page).toBe(1)
		expect(getReviewQueueUiState().filters.characterName).toBe('Alpha')
	})

	it('keeps page size changes and resets page', () => {
		setReviewQueuePage(4)
		setReviewQueuePageSize(50)
		expect(getReviewQueueUiState().page).toBe(1)
		expect(getReviewQueueUiState().pageSize).toBe(50)
	})

	it('stores snapshots and transitions request status across them', () => {
		const pending = makeRequest('111', 'pending')
		setReviewQueueSnapshot(
			'pending',
			{ limit: 25, offset: 0 },
			{ requests: [pending], total: 1, limit: 25, offset: 0 }
		)
		setReviewQueueSnapshot(
			'approved',
			{ limit: 25, offset: 0 },
			{ requests: [], total: 0, limit: 25, offset: 0 }
		)
		transitionRequestStatusAcrossReviewQueueSnapshots('111', 'approved')
		const state = snapshotReviewQueueStateForRollback()
		expect(Object.values(state.snapshots).find((entry) => entry.status === 'pending')?.data.requests).toHaveLength(0)
		expect(
			Object.values(state.snapshots).find((entry) => entry.status === 'approved')?.data.requests[0]?.requestStatus
		).toBe('approved')
		expect(state.entities['111']?.requestStatus).toBe('approved')
	})

	it('supports rollback and restore of the review queue store state', () => {
		setReviewQueueActiveTab('rejected')
		updateReviewQueueFilters({ characterName: 'Bravo' })
		const rollback = snapshotReviewQueueStateForRollback()
		setReviewQueueActiveTab('paid')
		restoreReviewQueueStateFromRollback(rollback)
		expect(getReviewQueueUiState().activeTab).toBe('rejected')
		expect(getReviewQueueUiState().filters.characterName).toBe('Bravo')
	})

	it('toggles sort direction for the active tab', () => {
		toggleReviewQueueSort('loss')
		expect(getReviewQueueUiState().sortBy).toBe('loss')
		expect(getReviewQueueUiState().sortDirection).toBe('asc')
		toggleReviewQueueSort('loss')
		expect(getReviewQueueUiState().sortDirection).toBe('desc')
	})
})
