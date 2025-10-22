import { describe, expect, it } from 'vitest'
import {
	QueueError,
	MessageValidationError,
	RetryableError,
	FatalError,
	isRetryable,
	isFatal,
	classifyError,
	getRetryDelay,
	createRetryableError,
	createFatalError,
	wrapError,
} from '../../src/errors'

describe('QueueError', () => {
	it('should create a QueueError', () => {
		const error = new QueueError('Test error')
		expect(error).toBeInstanceOf(QueueError)
		expect(error).toBeInstanceOf(Error)
		expect(error.message).toBe('Test error')
		expect(error.name).toBe('QueueError')
	})

	it('should capture cause', () => {
		const cause = new Error('Cause error')
		const error = new QueueError('Test error', cause)
		expect(error.cause).toBe(cause)
	})
})

describe('MessageValidationError', () => {
	it('should create a MessageValidationError', () => {
		const error = new MessageValidationError('Validation failed', { issues: [] })
		expect(error).toBeInstanceOf(MessageValidationError)
		expect(error).toBeInstanceOf(QueueError)
		expect(error.message).toBe('Validation failed')
		expect(error.name).toBe('MessageValidationError')
		expect(error.validationErrors).toEqual({ issues: [] })
	})
})

describe('RetryableError', () => {
	it('should create a RetryableError', () => {
		const error = new RetryableError('Retry me')
		expect(error).toBeInstanceOf(RetryableError)
		expect(error).toBeInstanceOf(QueueError)
		expect(error.message).toBe('Retry me')
		expect(error.name).toBe('RetryableError')
	})

	it('should capture delay', () => {
		const error = new RetryableError('Retry me', 30)
		expect(error.delaySeconds).toBe(30)
	})
})

describe('FatalError', () => {
	it('should create a FatalError', () => {
		const error = new FatalError('Fatal error')
		expect(error).toBeInstanceOf(FatalError)
		expect(error).toBeInstanceOf(QueueError)
		expect(error.message).toBe('Fatal error')
		expect(error.name).toBe('FatalError')
	})
})

describe('isRetryable', () => {
	it('should return true for RetryableError', () => {
		const error = new RetryableError('Retry me')
		expect(isRetryable(error)).toBe(true)
	})

	it('should return false for FatalError', () => {
		const error = new FatalError('Fatal error')
		expect(isRetryable(error)).toBe(false)
	})

	it('should return false for MessageValidationError', () => {
		const error = new MessageValidationError('Validation failed', {})
		expect(isRetryable(error)).toBe(false)
	})

	it('should return true for timeout errors', () => {
		const error = new Error('Request timeout')
		expect(isRetryable(error)).toBe(true)
	})

	it('should return true for network errors', () => {
		const error = new Error('ECONNREFUSED')
		expect(isRetryable(error)).toBe(true)
	})

	it('should return true for rate limit errors', () => {
		const error = new Error('429: rate limit exceeded')
		expect(isRetryable(error)).toBe(true)
	})

	it('should return true for 503 errors', () => {
		const error = new Error('503: service unavailable')
		expect(isRetryable(error)).toBe(true)
	})

	it('should return false for unknown errors', () => {
		const error = new Error('Unknown error')
		expect(isRetryable(error)).toBe(false)
	})
})

describe('isFatal', () => {
	it('should be inverse of isRetryable', () => {
		const retryableError = new RetryableError('Retry me')
		const fatalError = new FatalError('Fatal error')

		expect(isFatal(retryableError)).toBe(false)
		expect(isFatal(fatalError)).toBe(true)
	})
})

describe('classifyError', () => {
	it('should classify RetryableError as retry', () => {
		const error = new RetryableError('Retry me')
		expect(classifyError(error)).toBe('retry')
	})

	it('should classify FatalError as fatal', () => {
		const error = new FatalError('Fatal error')
		expect(classifyError(error)).toBe('fatal')
	})

	it('should classify timeout as retry', () => {
		const error = new Error('timeout')
		expect(classifyError(error)).toBe('retry')
	})
})

describe('getRetryDelay', () => {
	it('should return delay from RetryableError', () => {
		const error = new RetryableError('Retry me', 30)
		expect(getRetryDelay(error)).toBe(30)
	})

	it('should return undefined for non-RetryableError', () => {
		const error = new Error('Some error')
		expect(getRetryDelay(error)).toBeUndefined()
	})
})

describe('createRetryableError', () => {
	it('should create a RetryableError', () => {
		const error = createRetryableError('Retry me', 30)
		expect(error).toBeInstanceOf(RetryableError)
		expect(error.message).toBe('Retry me')
		expect(error.delaySeconds).toBe(30)
	})

	it('should create with cause', () => {
		const cause = new Error('Cause')
		const error = createRetryableError('Retry me', 30, cause)
		expect(error.cause).toBe(cause)
	})
})

describe('createFatalError', () => {
	it('should create a FatalError', () => {
		const error = createFatalError('Fatal')
		expect(error).toBeInstanceOf(FatalError)
		expect(error.message).toBe('Fatal')
	})

	it('should create with cause', () => {
		const cause = new Error('Cause')
		const error = createFatalError('Fatal', cause)
		expect(error.cause).toBe(cause)
	})
})

describe('wrapError', () => {
	it('should return QueueError as-is', () => {
		const error = new QueueError('Test')
		expect(wrapError(error)).toBe(error)
	})

	it('should wrap Error in QueueError', () => {
		const error = new Error('Test')
		const wrapped = wrapError(error)
		expect(wrapped).toBeInstanceOf(QueueError)
		expect(wrapped.cause).toBe(error)
	})

	it('should wrap non-Error values', () => {
		const wrapped = wrapError('string error')
		expect(wrapped).toBeInstanceOf(QueueError)
		expect(wrapped.message).toBe('string error')
	})

	it('should use custom message', () => {
		const error = new Error('Original')
		const wrapped = wrapError(error, 'Custom message')
		expect(wrapped.message).toBe('Custom message')
	})
})
