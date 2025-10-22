import type { RetryStrategy } from './types'
import { isRetryable } from './errors'

/**
 * Default retry strategy with exponential backoff
 */
export const defaultRetryStrategy: RetryStrategy = {
	maxAttempts: 3,
	getDelay: (attempt: number) => {
		// Exponential backoff: 2^attempt seconds
		// attempt 1: 2s, attempt 2: 4s, attempt 3: 8s
		return Math.pow(2, attempt)
	},
	shouldRetry: isRetryable,
}

/**
 * Create exponential backoff retry strategy
 *
 * @param maxAttempts - Maximum number of retry attempts
 * @param baseDelay - Base delay in seconds (default: 2)
 * @param maxDelay - Maximum delay in seconds (default: 300 = 5 minutes)
 * @param shouldRetry - Custom retry predicate
 */
export function exponentialBackoff(
	maxAttempts = 3,
	baseDelay = 2,
	maxDelay = 300,
	shouldRetry = isRetryable
): RetryStrategy {
	return {
		maxAttempts,
		getDelay: (attempt: number) => {
			const delay = baseDelay * Math.pow(2, attempt - 1)
			return Math.min(delay, maxDelay)
		},
		shouldRetry,
	}
}

/**
 * Create fixed delay retry strategy
 *
 * @param maxAttempts - Maximum number of retry attempts
 * @param delaySeconds - Fixed delay in seconds
 * @param shouldRetry - Custom retry predicate
 */
export function fixedDelay(
	maxAttempts = 3,
	delaySeconds = 5,
	shouldRetry = isRetryable
): RetryStrategy {
	return {
		maxAttempts,
		getDelay: () => delaySeconds,
		shouldRetry,
	}
}

/**
 * Create linear backoff retry strategy
 *
 * @param maxAttempts - Maximum number of retry attempts
 * @param increment - Increment in seconds per attempt
 * @param maxDelay - Maximum delay in seconds (default: 300 = 5 minutes)
 * @param shouldRetry - Custom retry predicate
 */
export function linearBackoff(
	maxAttempts = 3,
	increment = 5,
	maxDelay = 300,
	shouldRetry = isRetryable
): RetryStrategy {
	return {
		maxAttempts,
		getDelay: (attempt: number) => {
			const delay = increment * attempt
			return Math.min(delay, maxDelay)
		},
		shouldRetry,
	}
}

/**
 * Create no retry strategy
 * Messages will not be retried on error
 */
export function noRetry(): RetryStrategy {
	return {
		maxAttempts: 0,
		getDelay: () => 0,
		shouldRetry: () => false,
	}
}

/**
 * Check if a retry should be attempted
 *
 * @param error - The error that occurred
 * @param attempt - Current attempt number (starts at 1)
 * @param strategy - Retry strategy
 */
export function shouldRetry(error: Error, attempt: number, strategy: RetryStrategy): boolean {
	// Check if max attempts reached
	if (attempt > strategy.maxAttempts) {
		return false
	}

	// Check if error is retryable
	if (strategy.shouldRetry && !strategy.shouldRetry(error)) {
		return false
	}

	return true
}

/**
 * Get delay for next retry attempt
 *
 * @param attempt - Current attempt number (starts at 1)
 * @param strategy - Retry strategy
 */
export function getRetryDelay(attempt: number, strategy: RetryStrategy): number {
	return strategy.getDelay(attempt)
}

/**
 * Calculate total maximum time for all retries
 *
 * @param strategy - Retry strategy
 */
export function calculateMaxRetryTime(strategy: RetryStrategy): number {
	let totalTime = 0
	for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
		totalTime += strategy.getDelay(attempt)
	}
	return totalTime
}
