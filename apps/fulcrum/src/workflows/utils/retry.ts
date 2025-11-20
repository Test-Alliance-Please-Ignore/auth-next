/**
 * Retry utility with exponential backoff
 * Used for handling rate limits (420/429) and transient errors in workflows
 */

/**
 * Check if an error is a rate limit error (420 or 429)
 */
export function isRateLimitError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}
	const message = error.message.toLowerCase()
	return message.includes('420') || message.includes('429') || message.includes('rate limit')
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number
		initialDelayMs?: number
		maxDelayMs?: number
		backoffMultiplier?: number
		onRetry?: (attempt: number, error: Error, delayMs: number) => void
	} = {}
): Promise<T> {
	const {
		maxRetries = 5,
		initialDelayMs = 1000,
		maxDelayMs = 60000, // 60 seconds max
		backoffMultiplier = 2,
		onRetry,
	} = options

	let lastError: Error
	let delay = initialDelayMs

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			// Don't retry on last attempt
			if (attempt >= maxRetries) {
				throw lastError
			}

			// Only retry rate limit errors
			if (!isRateLimitError(error)) {
				throw lastError
			}

			// Calculate exponential backoff delay
			const currentDelay = Math.min(delay, maxDelayMs)

			if (onRetry) {
				onRetry(attempt + 1, lastError, currentDelay)
			}

			// Wait before retrying
			await new Promise((resolve) => setTimeout(resolve, currentDelay))

			// Increase delay for next retry
			delay = Math.min(delay * backoffMultiplier, maxDelayMs)
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError!
}

