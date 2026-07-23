import { describe, expect, it } from 'vitest'

import { PRICE_INSERT_BATCH_SIZE, splitIntoBatches } from '../../utils/batching'

describe('splitIntoBatches', () => {
	it('returns no batches for an empty array', () => {
		expect(splitIntoBatches([], PRICE_INSERT_BATCH_SIZE)).toEqual([])
	})

	it('keeps small inputs in a single batch', () => {
		expect(splitIntoBatches([1, 2, 3], PRICE_INSERT_BATCH_SIZE)).toEqual([[1, 2, 3]])
	})

	it('splits larger inputs into fixed-size batches', () => {
		const items = Array.from({ length: PRICE_INSERT_BATCH_SIZE + 3 }, (_, index) => index + 1)

		expect(splitIntoBatches(items, PRICE_INSERT_BATCH_SIZE)).toEqual([
			items.slice(0, PRICE_INSERT_BATCH_SIZE),
			items.slice(PRICE_INSERT_BATCH_SIZE),
		])
	})

	it('rejects invalid batch sizes', () => {
		expect(() => splitIntoBatches([1, 2, 3], 0)).toThrow(
			'batchSize must be greater than 0, got 0'
		)
	})
})
