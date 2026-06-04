export interface BatchedMailLike {
	mail_id?: string
}

export interface FetchMailContentBatchOptions<T extends BatchedMailLike, R> {
	items: T[]
	batchSize: number
	interBatchDelayMs?: number
	fetchItem: (item: T, index: number) => Promise<R>
}

export async function fetchItemsInBatches<T extends BatchedMailLike, R>({
	items,
	batchSize,
	interBatchDelayMs = 0,
	fetchItem,
}: FetchMailContentBatchOptions<T, R>): Promise<R[]> {
	if (items.length === 0) return []
	if (batchSize <= 0) throw new Error('batchSize must be greater than 0')

	const results: R[] = []

	for (let offset = 0; offset < items.length; offset += batchSize) {
		const batch = items.slice(offset, offset + batchSize)
		const batchResults = await Promise.all(
			batch.map((item, batchIndex) => fetchItem(item, offset + batchIndex)),
		)

		results.push(...batchResults)

		if (offset + batchSize < items.length && interBatchDelayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, interBatchDelayMs))
		}
	}

	return results
}
