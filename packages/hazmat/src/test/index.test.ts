import { describe, expect, it } from 'vitest'

import { generateRandomBytes, generateShardKey, getSodium } from '../index'

describe('Hazmat', () => {
	describe('generateShardKey', () => {
		it('should return a number within valid range for maxShardCount = 1', async () => {
			const result = await generateShardKey(1)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(1)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range for maxShardCount = 2', async () => {
			const result = await generateShardKey(2)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(2)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range for maxShardCount = 10', async () => {
			const result = await generateShardKey(10)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(10)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range for maxShardCount = 100', async () => {
			const result = await generateShardKey(100)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(100)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should return a number within valid range for maxShardCount = 1000', async () => {
			const result = await generateShardKey(1000)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(1000)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should produce different results on multiple calls (randomness)', async () => {
			const results = new Set()
			const maxShardCount = 100

			// Generate 50 shard keys and check they're not all the same
			for (let i = 0; i < 50; i++) {
				const result = await generateShardKey(maxShardCount)
				results.add(result)
			}

			// With 50 calls and 100 possible values, we should get some variety
			// (though it's theoretically possible to get all the same, it's very unlikely)
			expect(results.size).toBeGreaterThan(1)
		})

		it('should have reasonable distribution across the range', async () => {
			const maxShardCount = 10
			const iterations = 1000
			const distribution = new Array(maxShardCount).fill(0)

			// Generate many shard keys and count distribution
			for (let i = 0; i < iterations; i++) {
				const result = await generateShardKey(maxShardCount)
				distribution[result]++
			}

			// Check that each shard gets some hits (with some tolerance for randomness)
			// Each shard should get at least 1% of the total (10 out of 1000)
			const minExpected = Math.floor((iterations / maxShardCount) * 0.1)
			for (let i = 0; i < maxShardCount; i++) {
				expect(distribution[i]).toBeGreaterThan(minExpected)
			}
		})

		it('should handle edge case of maxShardCount = 1', async () => {
			// When maxShardCount is 1, the only valid result is 0
			const result = await generateShardKey(1)
			expect(result).toBe(0)
		})

		it('should handle large maxShardCount values', async () => {
			const largeCount = 1000000
			const result = await generateShardKey(largeCount)
			expect(typeof result).toBe('number')
			expect(result).toBeGreaterThanOrEqual(0)
			expect(result).toBeLessThan(largeCount)
			expect(Number.isInteger(result)).toBe(true)
		})

		it('should be deterministic with same input (if we could control randomness)', async () => {
			// This test verifies the function structure, though we can't control the randomness
			// We can at least verify it doesn't throw and returns a valid number
			const result1 = await generateShardKey(5)
			const result2 = await generateShardKey(5)

			expect(typeof result1).toBe('number')
			expect(typeof result2).toBe('number')
			expect(result1).toBeGreaterThanOrEqual(0)
			expect(result1).toBeLessThan(5)
			expect(result2).toBeGreaterThanOrEqual(0)
			expect(result2).toBeLessThan(5)
		})

		it('should work with concurrent calls', async () => {
			const maxShardCount = 20
			const promises = Array.from({ length: 10 }, () => generateShardKey(maxShardCount))
			const results = await Promise.all(promises)

			expect(results).toHaveLength(10)
			results.forEach((result) => {
				expect(typeof result).toBe('number')
				expect(result).toBeGreaterThanOrEqual(0)
				expect(result).toBeLessThan(maxShardCount)
				expect(Number.isInteger(result)).toBe(true)
			})
		})
	})

	describe('getSodium', () => {
		it('should return a sodium object', async () => {
			const sodium = await getSodium()
			expect(sodium).toBeDefined()
			expect(typeof sodium).toBe('object')
			expect(sodium.randombytes_buf).toBeDefined()
			expect(sodium.crypto_generichash).toBeDefined()
			expect(sodium.crypto_generichash_BYTES).toBeDefined()
		})

		it('should return the same instance on multiple calls', async () => {
			const sodium1 = await getSodium()
			const sodium2 = await getSodium()
			expect(sodium1).toBe(sodium2)
		})
	})

	describe('generateRandomBytes', () => {
		it('should generate random bytes of specified length', async () => {
			const length = 32
			const bytes = await generateRandomBytes(length)
			expect(bytes).toBeInstanceOf(Uint8Array)
			expect(bytes.length).toBe(length)
		})

		it('should generate different bytes on multiple calls', async () => {
			const length = 16
			const bytes1 = await generateRandomBytes(length)
			const bytes2 = await generateRandomBytes(length)

			expect(bytes1).toBeInstanceOf(Uint8Array)
			expect(bytes2).toBeInstanceOf(Uint8Array)
			expect(bytes1.length).toBe(length)
			expect(bytes2.length).toBe(length)

			// Very unlikely to be identical
			expect(bytes1).not.toEqual(bytes2)
		})

		it('should work with different lengths', async () => {
			const lengths = [1, 16, 32, 64, 128]

			for (const length of lengths) {
				const bytes = await generateRandomBytes(length)
				expect(bytes).toBeInstanceOf(Uint8Array)
				expect(bytes.length).toBe(length)
			}
		})
	})
})
