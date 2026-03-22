import { describe, expect, it, vi } from 'vitest'

import { dispatchTaxProjectionRefresh } from '../../../workflows/utils/tax-projection-dispatch'

describe('dispatchTaxProjectionRefresh', () => {
	it('fires downstream projection trigger exactly once', async () => {
		const trigger = vi.fn().mockResolvedValue(undefined)
		const clearRetryIntent = vi.fn().mockResolvedValue(undefined)
		const recordRetryIntent = vi.fn().mockResolvedValue(undefined)

		const result = await dispatchTaxProjectionRefresh({
			deps: {
				trigger,
				clearRetryIntent,
				recordRetryIntent,
			},
		})

		expect(result).toEqual({ outcome: 'triggered' })
		expect(trigger).toHaveBeenCalledTimes(1)
		expect(clearRetryIntent).toHaveBeenCalledTimes(1)
		expect(recordRetryIntent).not.toHaveBeenCalled()
	})

	it('records retry intent when trigger fails and does not clear retry intent', async () => {
		const trigger = vi.fn().mockRejectedValue(new Error('dispatch failure'))
		const clearRetryIntent = vi.fn().mockResolvedValue(undefined)
		const recordRetryIntent = vi.fn().mockResolvedValue(undefined)

		const result = await dispatchTaxProjectionRefresh({
			deps: {
				trigger,
				clearRetryIntent,
				recordRetryIntent,
			},
		})

		expect(result).toEqual({
			outcome: 'trigger_failed',
			errorMessage: 'dispatch failure',
		})
		expect(trigger).toHaveBeenCalledTimes(1)
		expect(clearRetryIntent).not.toHaveBeenCalled()
		expect(recordRetryIntent).toHaveBeenCalledTimes(1)
		expect(recordRetryIntent).toHaveBeenCalledWith('dispatch failure')
	})
})
