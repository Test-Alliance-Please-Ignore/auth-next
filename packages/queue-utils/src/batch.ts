import type { BatchOptions, BatchProcessingResult } from './types'

/**
 * Default batch processing options
 */
export const defaultBatchOptions: Required<BatchOptions> = {
	concurrency: 10,
	stopOnError: false,
}

/**
 * Process items in parallel with concurrency control
 *
 * @param items - Items to process
 * @param handler - Function to process each item
 * @param concurrency - Maximum number of concurrent operations
 */
export async function processConcurrently<T, R>(
	items: readonly T[],
	handler: (item: T, index: number) => Promise<R>,
	concurrency: number = 10
): Promise<R[]> {
	const results: R[] = new Array(items.length)
	const executing = new Set<Promise<void>>()
	let hasError: Error | null = null

	for (let index = 0; index < items.length; index++) {
		const item = items[index]

		// Create a promise for this item
		const promise = (async () => {
			try {
				results[index] = await handler(item, index)
			} catch (error) {
				hasError = error instanceof Error ? error : new Error(String(error))
				throw error
			}
		})()

		// Wrap promise to remove itself from executing set when done
		const wrappedPromise = promise.finally(() => {
			executing.delete(wrappedPromise)
		})

		// Add to executing set
		executing.add(wrappedPromise)

		// If we've reached concurrency limit, wait for one to complete
		if (executing.size >= concurrency) {
			await Promise.race(executing)
			// If an error occurred, stop processing and propagate it
			if (hasError) {
				throw hasError
			}
		}
	}

	// Wait for all remaining promises
	await Promise.all(executing)

	// Check for errors one more time
	if (hasError) {
		throw hasError
	}

	return results
}

/**
 * Process items sequentially
 *
 * @param items - Items to process
 * @param handler - Function to process each item
 */
export async function processSequentially<T, R>(
	items: readonly T[],
	handler: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = []

	for (let index = 0; index < items.length; index++) {
		const item = items[index]
		results[index] = await handler(item, index)
	}

	return results
}

/**
 * Process items with error handling and result tracking
 *
 * @param items - Items to process
 * @param handler - Function to process each item
 * @param options - Batch processing options
 */
export async function processBatch<T>(
	items: readonly T[],
	handler: (item: T, index: number) => Promise<void>,
	options: BatchOptions = {}
): Promise<BatchProcessingResult> {
	const { concurrency = 10, stopOnError = false } = options

	const result: BatchProcessingResult = {
		total: items.length,
		successful: 0,
		failed: 0,
		retried: 0,
		errors: [],
	}

	if (stopOnError) {
		// Sequential processing with early exit on error
		for (let index = 0; index < items.length; index++) {
			try {
				await handler(items[index], index)
				result.successful++
			} catch (error) {
				result.failed++
				result.errors.push({
					error: error instanceof Error ? error : new Error(String(error)),
					messageId: String(index),
				})
				break // Stop on first error
			}
		}
	} else {
		// Concurrent processing with error collection
		await processConcurrently(
			items,
			async (item, index) => {
				try {
					await handler(item, index)
					result.successful++
				} catch (error) {
					result.failed++
					result.errors.push({
						error: error instanceof Error ? error : new Error(String(error)),
						messageId: String(index),
					})
				}
			},
			concurrency
		)
	}

	return result
}

/**
 * Chunk an array into smaller arrays
 *
 * @param items - Items to chunk
 * @param size - Size of each chunk
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []

	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size) as T[])
	}

	return chunks
}

