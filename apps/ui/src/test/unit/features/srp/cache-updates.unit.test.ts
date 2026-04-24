import { describe, expect, it } from 'vitest'

import {
	isSrpLossesQueryKey,
	isSrpMyRequestsQueryKey,
	patchLossesByRequestStatus,
	patchLossesForRequest,
	prependMyRequest,
} from '@/features/srp/state/cache-updates'

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

describe('srp cache updates', () => {
	it('matches SRP losses keys for any daysBack variant', () => {
		expect(isSrpLossesQueryKey(['srp', 'losses', 60])).toBe(true)
		expect(isSrpLossesQueryKey(['srp', 'losses', 30])).toBe(true)
		expect(isSrpLossesQueryKey(['srp', 'requests'])).toBe(false)
	})

	it('patches loss state to requested using killmail ID', () => {
		const losses = [
			{ killmailId: '111', hasSRPRequest: false },
			{ killmailId: '222', hasSRPRequest: false },
		]
		const patched = patchLossesForRequest(losses, {
			killmailId: '222',
			requestId: '222',
			requestStatus: 'pending',
		})
		expect(patched?.[0]).toEqual(losses[0])
		expect(patched?.[1]).toMatchObject({
			killmailId: '222',
			hasSRPRequest: true,
			srpRequestId: '222',
			srpRequestStatus: 'pending',
		})
	})

	it('patches loss status by request ID', () => {
		const losses = [
			{
				killmailId: '111',
				hasSRPRequest: true,
				srpRequestId: '111',
				srpRequestStatus: 'pending',
			},
		]
		const patched = patchLossesByRequestStatus(losses, '111', 'approved')
		expect(patched?.[0]?.srpRequestStatus).toBe('approved')
	})

	it('prepends created request to my-requests cache and increments total', () => {
		const data = {
			requests: [makeRequest('101', 'pending')],
			total: 1,
			limit: 10,
			offset: 0,
		}
		const next = prependMyRequest(data, makeRequest('202', 'pending'))
		expect(next?.requests[0]?.id).toBe('202')
		expect(next?.total).toBe(2)
	})

	it('matches SRP my-requests keys', () => {
		expect(isSrpMyRequestsQueryKey(['srp', 'requests', 'my', { limit: 10 }])).toBe(true)
		expect(isSrpMyRequestsQueryKey(['srp', 'requests', 'by-status', 'pending'])).toBe(false)
	})
})
