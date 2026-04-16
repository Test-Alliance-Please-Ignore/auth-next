import { describe, expect, it } from 'vitest'

import {
	calculateJsonSize,
	generateCleanupPrefix,
	generateR2Key,
	isEsiRateLimitError,
	isPermanentEsiFailure,
	jsonReplacer,
	parseEsiErrorMetadata,
	safeJsonParse,
	safeJsonStringify,
	shouldStoreInR2,
} from '../index'

describe('workflow-utils', () => {
	describe('JSON utilities', () => {
		describe('jsonReplacer', () => {
			it('should convert BigInt to string', () => {
				const result = jsonReplacer('key', BigInt(123456789012345678901234567890n))
				expect(result).toBe('123456789012345678901234567890')
				expect(typeof result).toBe('string')
			})

			it('should convert Date to ISO string', () => {
				const date = new Date('2024-01-15T10:30:00.000Z')
				const result = jsonReplacer('key', date)
				expect(result).toBe('2024-01-15T10:30:00.000Z')
			})

			it('should pass through other values unchanged', () => {
				expect(jsonReplacer('key', 'string')).toBe('string')
				expect(jsonReplacer('key', 123)).toBe(123)
				expect(jsonReplacer('key', true)).toBe(true)
				expect(jsonReplacer('key', null)).toBe(null)
				expect(jsonReplacer('key', { foo: 'bar' })).toEqual({ foo: 'bar' })
			})
		})

		describe('safeJsonStringify', () => {
			it('should stringify object with BigInt', () => {
				const data = { amount: BigInt(9007199254740993n) }
				const result = safeJsonStringify(data)
				expect(result).toBe('{"amount":"9007199254740993"}')
			})

			it('should stringify object with Date', () => {
				const data = { createdAt: new Date('2024-01-15T10:30:00.000Z') }
				const result = safeJsonStringify(data)
				expect(result).toBe('{"createdAt":"2024-01-15T10:30:00.000Z"}')
			})

			it('should stringify nested objects with mixed types', () => {
				const data = {
					id: 1,
					amount: BigInt(1000n),
					timestamp: new Date('2024-01-15T10:30:00.000Z'),
					nested: {
						bigValue: BigInt(999999999999999999n),
					},
				}
				const result = JSON.parse(safeJsonStringify(data))
				expect(result.id).toBe(1)
				expect(result.amount).toBe('1000')
				expect(result.timestamp).toBe('2024-01-15T10:30:00.000Z')
				expect(result.nested.bigValue).toBe('999999999999999999')
			})
		})

		describe('safeJsonParse', () => {
			it('should parse JSON string to typed object', () => {
				const json = '{"name":"test","value":123}'
				const result = safeJsonParse<{ name: string; value: number }>(json)
				expect(result.name).toBe('test')
				expect(result.value).toBe(123)
			})

			it('should parse arrays', () => {
				const json = '[1,2,3]'
				const result = safeJsonParse<number[]>(json)
				expect(result).toEqual([1, 2, 3])
			})
		})

		describe('calculateJsonSize', () => {
			it('should calculate byte size correctly', () => {
				const data = { test: 'hello' }
				const result = calculateJsonSize(data)
				// {"test":"hello"} = 16 bytes
				expect(result).toBe(16)
			})

			it('should handle unicode characters', () => {
				const data = { emoji: '🎉' }
				const result = calculateJsonSize(data)
				// {"emoji":"🎉"} - emoji is 4 bytes in UTF-8
				expect(result).toBeGreaterThan(10)
			})
		})

		describe('shouldStoreInR2', () => {
			it('should return false for small data', () => {
				expect(shouldStoreInR2(1000)).toBe(false)
				expect(shouldStoreInR2(1024 * 1024)).toBe(false) // exactly 1 MiB
			})

			it('should return true for large data', () => {
				expect(shouldStoreInR2(1024 * 1024 + 1)).toBe(true)
				expect(shouldStoreInR2(10 * 1024 * 1024)).toBe(true)
			})
		})
	})

	describe('Storage utilities', () => {
		describe('generateR2Key', () => {
			it('should generate key with prefix', () => {
				const key = generateR2Key('my-workflow-data', 'instance-123', 'fetch-users')
				expect(key).toBe('my-workflow-data/instance-123/fetch-users.json')
			})

			it('should generate key without prefix', () => {
				const key = generateR2Key('', 'instance-123', 'fetch-users')
				expect(key).toBe('instance-123/fetch-users.json')
			})

			it('should handle special characters in step IDs', () => {
				const key = generateR2Key('data', 'abc-123', 'step-with-dashes')
				expect(key).toBe('data/abc-123/step-with-dashes.json')
			})
		})

		describe('generateCleanupPrefix', () => {
			it('should generate cleanup prefix with prefix', () => {
				const prefix = generateCleanupPrefix('my-workflow-data', 'instance-123')
				expect(prefix).toBe('my-workflow-data/instance-123/')
			})

			it('should generate cleanup prefix without prefix', () => {
				const prefix = generateCleanupPrefix('', 'instance-123')
				expect(prefix).toBe('instance-123/')
			})
		})
	})

	describe('ESI retry classification', () => {
		it('parses ESI metadata from error text', () => {
			const metadata = parseEsiErrorMetadata(
				'ESI request failed: 403 Forbidden - {"error":"Forbidden"} | metadata={"status":403,"path":"/corporations/1/members"}'
			)
			expect(metadata).toMatchObject({
				status: 403,
				path: '/corporations/1/members',
			})
		})

		it('classifies permanent failures by numeric metadata status', () => {
			const error = new Error(
				'ESI request failed: Forbidden-ish text | metadata={"status":403,"path":"/x"}'
			)
			expect(isPermanentEsiFailure(error)).toBe(true)
		})

		it('classifies rate limits by numeric metadata status', () => {
			const error = new Error(
				'request failed without explicit 429 text | metadata={"status":429,"path":"/x"}'
			)
			expect(isEsiRateLimitError(error)).toBe(true)
		})
	})
})
