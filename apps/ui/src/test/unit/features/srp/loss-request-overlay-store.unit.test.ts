import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetLossRequestOverlayStoreForTests,
	mergeLossesWithOverlay,
	mergeRequestsWithOverlay,
	reconcileOverlayFromServerLosses,
	removeOverlayByRequestId,
	updateOverlayRequestStatus,
	upsertLossRequestOverlay,
} from '@/features/srp/state/loss-request-overlay-store'

describe('loss request overlay store', () => {
	beforeEach(() => {
		__resetLossRequestOverlayStoreForTests()
	})

	it('overlays losses with request linkage immediately', () => {
		upsertLossRequestOverlay({
			killmailId: '123',
			requestId: '123',
			requestStatus: 'pending',
		})
		const merged = mergeLossesWithOverlay([
			{ killmailId: '123', hasSRPRequest: false },
			{ killmailId: '456', hasSRPRequest: false },
		])
		expect(merged?.[0]).toMatchObject({
			killmailId: '123',
			hasSRPRequest: true,
			srpRequestId: '123',
			srpRequestStatus: 'pending',
		})
		expect(merged?.[1]).toEqual({ killmailId: '456', hasSRPRequest: false })
	})

	it('propagates request status updates into merged requests', () => {
		upsertLossRequestOverlay({
			killmailId: '888',
			requestId: '888',
			requestStatus: 'pending',
		})
		updateOverlayRequestStatus({
			requestId: '888',
			requestStatus: 'approved',
		})
		const merged = mergeRequestsWithOverlay([
			{ id: '888', requestStatus: 'pending' },
			{ id: '777', requestStatus: 'pending' },
		])
		expect(merged[0]?.requestStatus).toBe('approved')
		expect(merged[1]?.requestStatus).toBe('pending')
	})

	it('reconciles away stale overlay entries when server reports no request', () => {
		upsertLossRequestOverlay({
			killmailId: '444',
			requestId: '444',
			requestStatus: 'pending',
		})
		reconcileOverlayFromServerLosses([
			{
				killmailId: '444',
				hasSRPRequest: false,
			},
		])
		const merged = mergeLossesWithOverlay([
			{ killmailId: '444', hasSRPRequest: false },
		])
		expect(merged?.[0]).toEqual({ killmailId: '444', hasSRPRequest: false })
	})

	it('removes overlay mapping by request id', () => {
		upsertLossRequestOverlay({
			killmailId: '999',
			requestId: '999',
			requestStatus: 'pending',
		})
		removeOverlayByRequestId('999')
		const merged = mergeLossesWithOverlay([
			{ killmailId: '999', hasSRPRequest: false },
		])
		expect(merged?.[0]).toEqual({ killmailId: '999', hasSRPRequest: false })
	})
})
