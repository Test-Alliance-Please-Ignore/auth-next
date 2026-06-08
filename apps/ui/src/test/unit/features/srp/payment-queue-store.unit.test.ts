import { beforeEach, describe, expect, it } from 'vitest'

import {
	__resetPaymentQueueStoreForTests,
	dismissPaymentQueueRequest,
	getPaymentQueueState,
	prunePaymentQueueDismissals,
	resetPaymentQueueDismissals,
} from '@/features/srp/state/payment-queue-store'

describe('payment queue store', () => {
	beforeEach(() => {
		__resetPaymentQueueStoreForTests()
	})

	it('tracks dismissed request ids', () => {
		dismissPaymentQueueRequest('1')
		dismissPaymentQueueRequest('2')
		expect(getPaymentQueueState().dismissedRequestIds).toEqual(['1', '2'])
	})

	it('restores dismissed request ids', () => {
		dismissPaymentQueueRequest('1')
		resetPaymentQueueDismissals()
		expect(getPaymentQueueState().dismissedRequestIds).toEqual([])
	})

	it('prunes dismissals to active ids', () => {
		dismissPaymentQueueRequest('1')
		dismissPaymentQueueRequest('2')
		prunePaymentQueueDismissals(['2'])
		expect(getPaymentQueueState().dismissedRequestIds).toEqual(['2'])
	})

	it('resets dismissals', () => {
		dismissPaymentQueueRequest('1')
		resetPaymentQueueDismissals()
		expect(getPaymentQueueState().dismissedRequestIds).toEqual([])
	})
})
