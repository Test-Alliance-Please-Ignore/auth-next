/**
 * Base error class for queue-related errors
 */
export class QueueError extends Error {
	public override readonly cause?: Error

	constructor(message: string, cause?: Error) {
		super(message)
		this.name = 'QueueError'
		this.cause = cause
		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, QueueError)
		}
	}
}

/**
 * Error thrown when message validation fails
 */
export class MessageValidationError extends QueueError {
	constructor(
		message: string,
		public readonly validationErrors: unknown,
		cause?: Error
	) {
		super(message, cause)
		this.name = 'MessageValidationError'
	}
}

/**
 * Error that indicates the message should be retried
 * These are transient errors that might succeed on retry
 */
export class RetryableError extends QueueError {
	constructor(
		message: string,
		public readonly delaySeconds?: number,
		cause?: Error
	) {
		super(message, cause)
		this.name = 'RetryableError'
	}
}

/**
 * Error that indicates the message should not be retried
 * These are permanent errors that won't succeed on retry
 */
export class FatalError extends QueueError {
	constructor(message: string, cause?: Error) {
		super(message, cause)
		this.name = 'FatalError'
	}
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: Error): boolean {
	// Explicit retryable errors
	if (error instanceof RetryableError) {
		return true
	}

	// Explicit fatal errors
	if (error instanceof FatalError) {
		return false
	}

	// Validation errors are not retryable
	if (error instanceof MessageValidationError) {
		return false
	}

	// Network/timeout errors are retryable
	if (
		error.name === 'TimeoutError' ||
		error.name === 'NetworkError' ||
		error.message.includes('timeout') ||
		error.message.includes('ETIMEDOUT') ||
		error.message.includes('ECONNREFUSED') ||
		error.message.includes('ENOTFOUND')
	) {
		return true
	}

	// Rate limit errors are retryable
	if (error.message.includes('rate limit') || error.message.includes('429')) {
		return true
	}

	// Service unavailable errors are retryable
	if (error.message.includes('503') || error.message.includes('service unavailable')) {
		return true
	}

	// Default to not retryable for safety
	return false
}

/**
 * Check if an error is fatal
 */
export function isFatal(error: Error): boolean {
	return !isRetryable(error)
}

/**
 * Classify error for handling decision
 */
export function classifyError(error: Error): 'retry' | 'fatal' {
	return isRetryable(error) ? 'retry' : 'fatal'
}

/**
 * Extract delay from retryable error if present
 */
export function getRetryDelay(error: Error): number | undefined {
	if (error instanceof RetryableError) {
		return error.delaySeconds
	}
	return undefined
}

/**
 * Create a retryable error with optional delay
 */
export function createRetryableError(
	message: string,
	delaySeconds?: number,
	cause?: Error
): RetryableError {
	return new RetryableError(message, delaySeconds, cause)
}

/**
 * Create a fatal error
 */
export function createFatalError(message: string, cause?: Error): FatalError {
	return new FatalError(message, cause)
}

/**
 * Wrap an unknown error in a QueueError
 */
export function wrapError(error: unknown, message?: string): QueueError {
	if (error instanceof QueueError) {
		return error
	}

	if (error instanceof Error) {
		return new QueueError(message || error.message, error)
	}

	return new QueueError(message || String(error))
}
