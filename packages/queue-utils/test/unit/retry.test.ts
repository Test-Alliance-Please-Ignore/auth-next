import { describe, expect, it } from 'vitest'
import {
	defaultRetryStrategy,
	exponentialBackoff,
	fixedDelay,
	linearBackoff,
	noRetry,
	shouldRetry,
	getRetryDelay,
	calculateMaxRetryTime,
} from '../../src/retry'
import { RetryableError, FatalError } from '../../src/errors'

describe('defaultRetryStrategy', () => {
	it('should have maxAttempts of 3', () => {
		expect(defaultRetryStrategy.maxAttempts).toBe(3)
	})

	it('should use exponential backoff', () => {
		expect(defaultRetryStrategy.getDelay(1)).toBe(2)
		expect(defaultRetryStrategy.getDelay(2)).toBe(4)
		expect(defaultRetryStrategy.getDelay(3)).toBe(8)
	})

	it('should have shouldRetry function', () => {
		expect(defaultRetryStrategy.shouldRetry).toBeDefined()
	})
})

describe('exponentialBackoff', () => {
	it('should create strategy with default values', () => {
		const strategy = exponentialBackoff()
		expect(strategy.maxAttempts).toBe(3)
		expect(strategy.getDelay(1)).toBe(2)
		expect(strategy.getDelay(2)).toBe(4)
		expect(strategy.getDelay(3)).toBe(8)
	})

	it('should create strategy with custom values', () => {
		const strategy = exponentialBackoff(5, 1, 10)
		expect(strategy.maxAttempts).toBe(5)
		expect(strategy.getDelay(1)).toBe(1)
		expect(strategy.getDelay(2)).toBe(2)
		expect(strategy.getDelay(3)).toBe(4)
		expect(strategy.getDelay(4)).toBe(8)
		expect(strategy.getDelay(5)).toBe(10) // capped at maxDelay
	})

	it('should cap delay at maxDelay', () => {
		const strategy = exponentialBackoff(10, 2, 16)
		expect(strategy.getDelay(1)).toBe(2)
		expect(strategy.getDelay(2)).toBe(4)
		expect(strategy.getDelay(3)).toBe(8)
		expect(strategy.getDelay(4)).toBe(16)
		expect(strategy.getDelay(5)).toBe(16) // capped
	})
})

describe('fixedDelay', () => {
	it('should create strategy with default values', () => {
		const strategy = fixedDelay()
		expect(strategy.maxAttempts).toBe(3)
		expect(strategy.getDelay(1)).toBe(5)
		expect(strategy.getDelay(2)).toBe(5)
		expect(strategy.getDelay(3)).toBe(5)
	})

	it('should create strategy with custom values', () => {
		const strategy = fixedDelay(5, 10)
		expect(strategy.maxAttempts).toBe(5)
		expect(strategy.getDelay(1)).toBe(10)
		expect(strategy.getDelay(5)).toBe(10)
	})
})

describe('linearBackoff', () => {
	it('should create strategy with default values', () => {
		const strategy = linearBackoff()
		expect(strategy.maxAttempts).toBe(3)
		expect(strategy.getDelay(1)).toBe(5)
		expect(strategy.getDelay(2)).toBe(10)
		expect(strategy.getDelay(3)).toBe(15)
	})

	it('should create strategy with custom values', () => {
		const strategy = linearBackoff(4, 10, 25)
		expect(strategy.maxAttempts).toBe(4)
		expect(strategy.getDelay(1)).toBe(10)
		expect(strategy.getDelay(2)).toBe(20)
		expect(strategy.getDelay(3)).toBe(25) // capped at maxDelay
		expect(strategy.getDelay(4)).toBe(25) // capped at maxDelay
	})

	it('should cap delay at maxDelay', () => {
		const strategy = linearBackoff(10, 5, 20)
		expect(strategy.getDelay(1)).toBe(5)
		expect(strategy.getDelay(2)).toBe(10)
		expect(strategy.getDelay(3)).toBe(15)
		expect(strategy.getDelay(4)).toBe(20) // capped
		expect(strategy.getDelay(5)).toBe(20) // capped
	})
})

describe('noRetry', () => {
	it('should create strategy with no retries', () => {
		const strategy = noRetry()
		expect(strategy.maxAttempts).toBe(0)
		expect(strategy.getDelay(1)).toBe(0)
		expect(strategy.shouldRetry!(new Error())).toBe(false)
	})
})

describe('shouldRetry', () => {
	const strategy = exponentialBackoff(3)

	it('should return false if max attempts exceeded', () => {
		const error = new RetryableError('Retry me')
		expect(shouldRetry(error, 4, strategy)).toBe(false)
	})

	it('should return false if error is not retryable', () => {
		const error = new FatalError('Fatal')
		expect(shouldRetry(error, 1, strategy)).toBe(false)
	})

	it('should return true if within attempts and retryable', () => {
		const error = new RetryableError('Retry me')
		expect(shouldRetry(error, 1, strategy)).toBe(true)
		expect(shouldRetry(error, 2, strategy)).toBe(true)
		expect(shouldRetry(error, 3, strategy)).toBe(true)
	})

	it('should use custom shouldRetry predicate', () => {
		const customStrategy = {
			maxAttempts: 3,
			getDelay: () => 5,
			shouldRetry: (error: Error) => error.message === 'custom',
		}

		expect(shouldRetry(new Error('custom'), 1, customStrategy)).toBe(true)
		expect(shouldRetry(new Error('other'), 1, customStrategy)).toBe(false)
	})
})

describe('getRetryDelay', () => {
	it('should return delay from strategy', () => {
		const strategy = fixedDelay(3, 10)
		expect(getRetryDelay(1, strategy)).toBe(10)
		expect(getRetryDelay(2, strategy)).toBe(10)
	})

	it('should return exponential delay', () => {
		const strategy = exponentialBackoff(3, 2)
		expect(getRetryDelay(1, strategy)).toBe(2)
		expect(getRetryDelay(2, strategy)).toBe(4)
		expect(getRetryDelay(3, strategy)).toBe(8)
	})
})

describe('calculateMaxRetryTime', () => {
	it('should calculate total retry time for fixed delay', () => {
		const strategy = fixedDelay(3, 10)
		expect(calculateMaxRetryTime(strategy)).toBe(30) // 10 + 10 + 10
	})

	it('should calculate total retry time for exponential backoff', () => {
		const strategy = exponentialBackoff(3, 2)
		expect(calculateMaxRetryTime(strategy)).toBe(14) // 2 + 4 + 8
	})

	it('should calculate total retry time for linear backoff', () => {
		const strategy = linearBackoff(3, 5)
		expect(calculateMaxRetryTime(strategy)).toBe(30) // 5 + 10 + 15
	})

	it('should return 0 for no retry', () => {
		const strategy = noRetry()
		expect(calculateMaxRetryTime(strategy)).toBe(0)
	})
})
