export const PRICE_INSERT_BATCH_SIZE = 100

export function splitIntoBatches<T>(items: readonly T[], batchSize: number): T[][] {
	if (batchSize <= 0) {
		throw new Error(`batchSize must be greater than 0, got ${batchSize}`)
	}

	const batches: T[][] = []
	for (let index = 0; index < items.length; index += batchSize) {
		batches.push(items.slice(index, index + batchSize))
	}

	return batches
}
