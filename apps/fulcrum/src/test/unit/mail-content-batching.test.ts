import { describe, expect, it, vi } from 'vitest'

import { fetchItemsInBatches } from '../../workflows/steps/mails/mail-content-batching'

describe('fetchItemsInBatches', () => {
	it('limits concurrency to the batch size and preserves ordering', async () => {
		const items = [
			{ id: 'a', mail_id: 'a' },
			{ id: 'b', mail_id: 'b' },
			{ id: 'c', mail_id: 'c' },
			{ id: 'd', mail_id: 'd' },
			{ id: 'e', mail_id: 'e' },
		]
		let active = 0
		let maxActive = 0
		const fetchItem = vi.fn(async (item: { id: string; mail_id: string }) => {
			active += 1
			maxActive = Math.max(maxActive, active)
			await new Promise((resolve) => setTimeout(resolve, 10))
			active -= 1
			return item.id.toUpperCase()
		})

		const results = await fetchItemsInBatches({
			items,
			batchSize: 2,
			interBatchDelayMs: 0,
			fetchItem,
		})

		expect(results).toEqual(['A', 'B', 'C', 'D', 'E'])
		expect(maxActive).toBeLessThanOrEqual(2)
		expect(fetchItem).toHaveBeenCalledTimes(5)
	})
})
