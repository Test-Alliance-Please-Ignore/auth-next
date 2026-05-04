import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetReviewQueueSnapshotStoreForTests,
	getReviewQueueSnapshot,
	restoreReviewQueueStateFromRollback,
	setReviewQueueSnapshot,
	snapshotReviewQueueStateForRollback,
	transitionRequestStatusAcrossReviewQueueSnapshots,
	upsertRequestAcrossReviewQueueSnapshots,
} from '@/features/srp/state/review-queue-snapshot-store'

import type { RequestListResponse, SRPRequestResponse } from '@/features/srp/types'

function createRequest(
	overrides: Partial<SRPRequestResponse> & { id: string; requestStatus: SRPRequestResponse['requestStatus'] }
): SRPRequestResponse {
	const { id, requestStatus, ...rest } = overrides
	return {
		id,
		requestStatus,
		characterName: rest.characterName ?? 'Pilot One',
		shipTypeName: rest.shipTypeName ?? 'Rifter',
		solarSystemName: rest.solarSystemName ?? 'GE-8JV',
		lossDate: rest.lossDate ?? '2026-05-01T00:00:00.000Z',
		createdAt: rest.createdAt ?? '2026-05-01T00:00:00.000Z',
		...rest,
	} as SRPRequestResponse
}

function createResponse(requests: SRPRequestResponse[]): RequestListResponse {
	return {
		requests,
		total: requests.length,
		limit: 50,
		offset: 0,
	}
}

describe('review queue snapshot store', () => {
	beforeEach(() => {
		__resetReviewQueueSnapshotStoreForTests()
	})

	it('moves request between status snapshots when state changes', () => {
		const request = createRequest({ id: '1001', requestStatus: 'pending' })
		setReviewQueueSnapshot('pending', { limit: 50 }, createResponse([request]))
		setReviewQueueSnapshot('approved', { limit: 50 }, createResponse([]))

		upsertRequestAcrossReviewQueueSnapshots({
			...request,
			requestStatus: 'approved',
		})

		const pending = getReviewQueueSnapshot('pending', { limit: 50 })
		const approved = getReviewQueueSnapshot('approved', { limit: 50 })

		expect(pending?.requests).toHaveLength(0)
		expect(pending?.total).toBe(0)
		expect(approved?.requests[0]?.id).toBe('1001')
		expect(approved?.requests[0]?.requestStatus).toBe('approved')
	})

	it('only prepends into matching filtered snapshots', () => {
		const matching = createRequest({
			id: '2001',
			requestStatus: 'pending',
			characterName: 'A',
		})
		const nonMatching = createRequest({
			id: '2002',
			requestStatus: 'pending',
			characterName: 'B',
		})
		setReviewQueueSnapshot('pending', { limit: 50, characterName: 'A' }, createResponse([]))
		setReviewQueueSnapshot('pending', { limit: 50, characterName: 'B' }, createResponse([]))

		upsertRequestAcrossReviewQueueSnapshots(matching)
		upsertRequestAcrossReviewQueueSnapshots(nonMatching)

		const a = getReviewQueueSnapshot('pending', { limit: 50, characterName: 'A' })
		const b = getReviewQueueSnapshot('pending', { limit: 50, characterName: 'B' })
		expect(a?.requests.map((row) => row.id)).toEqual(['2001'])
		expect(b?.requests.map((row) => row.id)).toEqual(['2002'])
	})

	it('supports rollback state restore', () => {
		const request = createRequest({ id: '3001', requestStatus: 'pending' })
		setReviewQueueSnapshot('pending', { limit: 50 }, createResponse([request]))
		const snapshot = snapshotReviewQueueStateForRollback()

		upsertRequestAcrossReviewQueueSnapshots({
			...request,
			requestStatus: 'approved',
		})
		restoreReviewQueueStateFromRollback(snapshot)

		const pending = getReviewQueueSnapshot('pending', { limit: 50 })
		expect(pending?.requests).toHaveLength(1)
		expect(pending?.requests[0]?.requestStatus).toBe('pending')
	})

	it('transitions by request id even without request detail cache', () => {
		const request = createRequest({
			id: '4001',
			requestStatus: 'approved',
			characterName: 'Queue Pilot',
		})
		setReviewQueueSnapshot('approved', { limit: 50 }, createResponse([request]))
		setReviewQueueSnapshot('paid', { limit: 50 }, createResponse([]))

		transitionRequestStatusAcrossReviewQueueSnapshots('4001', 'paid')

		const approved = getReviewQueueSnapshot('approved', { limit: 50 })
		const paid = getReviewQueueSnapshot('paid', { limit: 50 })
		expect(approved?.requests).toHaveLength(0)
		expect(approved?.total).toBe(0)
		expect(paid?.requests.map((row) => row.id)).toEqual(['4001'])
		expect(paid?.requests[0]?.requestStatus).toBe('paid')
	})
})
