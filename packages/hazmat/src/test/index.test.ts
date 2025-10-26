import { describe, expect, it } from 'vitest'

import { generateRandomBytes, generateShardKey } from '../index'

describe('Hazmat', () => {
	describe('generateShardKey', () => {
		it('should return a number within valid range [0, 0]', () => {
			const result = generateShardKey(0, 0)
			expect(typeof result).toBe('number')
			expect(result).toBe(0)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range [0, 1]', () => {
			const result = generateShardKey(0, 1)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThanOrEqual(1)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range [0, 9]', () => {
			const result = generateShardKey(0, 9)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThanOrEqual(9)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range [0, 99]', () => {
			const result = generateShardKey(0, 99)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThanOrEqual(99)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range [0, 999]', () => {
			const result = generateShardKey(0, 999)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThanOrEqual(999)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range [10001, 10007]', () => {
			const result = generateShardKey(10001, 10007)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(10001)
			expect(result).toBeLessThanOrEqual(10007)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should produce different results on multiple calls (randomness)', () => {
			const results = new Set()
			const min = 0
			const max = 99

			// Generate 50 shard keys and check they're not all the same
			for (let i = 0; i < 50; i++) {
				const result = generateShardKey(min, max)
				results.add(result)
			}

			// With 50 calls and 100 possible values, we should get some variety
			// (though it's theoretically possible to get all the same, it's very unlikely)
			expect(results.size).toBeGreaterThan(1)
		})

		it('should have reasonable distribution across the range', () => {
			const min = 0
			const max = 9
			const iterations = 1000
			const distribution = new Array(max - min + 1).fill(0)

			// Generate many shard keys and count distribution
			for (let i = 0; i < iterations; i++) {
				const result = generateShardKey(min, max)
				distribution[result - min]++
			}

			// Check that each shard gets some hits (with some tolerance for randomness)
			// Each shard should get at least 1% of the total (10 out of 1000)
			const rangeSize = max - min + 1
			const minExpected = Math.floor((iterations / rangeSize) * 0.1)
			for (let i = 0; i < rangeSize; i++) {
				expect(distribution[i]).toBeGreaterThan(minExpected)
			}
		})

		it('should handle edge case when min equals max', () => {
			// When min equals max, the only valid result is that value
			const result = generateShardKey(5, 5)
			expect(result).toBe(5)
		})

		it('should handle large range values', () => {
			const min = 0
			const max = 999999
			const result = generateShardKey(min, max)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(min)
			expect(result).toBeLessThanOrEqual(max)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return valid numbers with same range on multiple calls', () => {
			// This test verifies the function structure, though we can't control the randomness
			// We can at least verify it doesn't throw and returns valid numbers
			const result1 = generateShardKey(0, 4)
			const result2 = generateShardKey(0, 4)

			expect(typeof result1).toBe('number')
			expect(typeof result2).toBe('number')
			expect(result1).toBeGreaterThanOrEqual(0)
			expect(result1).toBeLessThanOrEqual(4)
			expect(result2).toBeGreaterThanOrEqual(0)
			expect(result2).toBeLessThanOrEqual(4)
		})

		it('should work with concurrent calls', () => {
			const min = 0
			const max = 19
			const results = Array.from({ length: 10 }, () => generateShardKey(min, max))

			expect(results).toHaveLength(10)
			results.forEach((result) => {
				expect(typeof result).toBe('number')
				expect(result).toBeGreaterThanOrEqual(min)
				expect(result).toBeLessThanOrEqual(max)
				expect(Number.isInteger(result)).toBe(true)
			})
		})

		it('should throw error when min is greater than max', () => {
			expect(() => generateShardKey(10, 5)).toThrow('min must be less than or equal to max')
		})

		it('should throw error when min is not an integer', () => {
			expect(() => generateShardKey(1.5, 10)).toThrow('min and max must be integers')
		})

		it('should throw error when max is not an integer', () => {
			expect(() => generateShardKey(1, 10.5)).toThrow('min and max must be integers')
		})
	})

	describe('generateRandomBytes', () => {
		it('should generate random bytes of specified length', () => {
			const length = 32
			const bytes = generateRandomBytes(length)
			expect(bytes).toBeInstanceOf(Uint8Array)
			expect(bytes.length).toBe(length)
		})

		it('should generate different bytes on multiple calls', () => {
			const length = 16
			const bytes1 = generateRandomBytes(length)
			const bytes2 = generateRandomBytes(length)

			expect(bytes1).toBeInstanceOf(Uint8Array)
			expect(bytes2).toBeInstanceOf(Uint8Array)
			expect(bytes1.length).toBe(length)
			expect(bytes2.length).toBe(length)

			// Very unlikely to be identical
			expect(bytes1).not.toEqual(bytes2)
		})

		it('should work with different lengths', () => {
			const lengths = [1, 16, 32, 64, 128]

			for (const length of lengths) {
				const bytes = generateRandomBytes(length)
				expect(bytes).toBeInstanceOf(Uint8Array)
				expect(bytes.length).toBe(length)
			}
		})
	})
})
