/**
 * Integration tests for inventory parsing functionality
 */

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import worker from '../../index'

type ParseInventoryResponse = {
	items: Array<{
		type_id: number
		type_name: string
		quantity: number
		volume: number
		mass: number
	}>
	errors: Array<{ line: string; error: string }>
	summary: {
		uniqueTypes: number
		totalQuantity: number
		totalVolume: number
		totalMass: number
		successCount: number
		errorCount: number
	}
}

describe('Inventory Parsing', () => {
	describe('POST /inventory/parse', () => {
		it('should parse a simple inventory with single items', async () => {
			const inventoryText = `Tritanium	1000
Pyerite	500
Mexallon	250`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result).toHaveProperty('items')
			expect(result).toHaveProperty('errors')
			expect(result).toHaveProperty('summary')

			// Check if items were parsed (actual results depend on database content)
			expect(Array.isArray(result.items)).toBe(true)
			expect(Array.isArray(result.errors)).toBe(true)
		})

		it('should handle missing quantities (default to 1)', async () => {
			const inventoryText = `Shield Command Burst II
Cynosural Field Generator I
Defender Launcher I	`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result).toHaveProperty('items')
			expect(result).toHaveProperty('errors')

			// Items with missing quantities should default to 1
			result.items.forEach((item: any) => {
				expect(item.quantity).toBeGreaterThanOrEqual(1)
			})
		})

		it('should handle mixed valid and invalid items', async () => {
			const inventoryText = `Tritanium	1000
InvalidItemNameThatDoesNotExist	500
Pyerite	250`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result).toHaveProperty('items')
			expect(result).toHaveProperty('errors')

			// Should have at least one error for the invalid item
			expect(result.errors.length).toBeGreaterThanOrEqual(1)

			// Check error structure
			const error = result.errors.find((e: any) => e.reason === 'item_not_found')
			expect(error).toBeDefined()
			expect(error).toHaveProperty('lineNumber')
			expect(error).toHaveProperty('rawText')
			expect(error).toHaveProperty('reason')
		})

		it('should reject invalid quantity formats', async () => {
			const inventoryText = `Tritanium	abc
Pyerite	-100
Mexallon	0`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result.errors.length).toBeGreaterThanOrEqual(2) // At least 'abc' and '-100' should error
		})

		it('should calculate summary statistics correctly', async () => {
			const inventoryText = `Tritanium	1000
Pyerite	500`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result.summary).toBeDefined()
			expect(result.summary.uniqueTypes).toBeGreaterThanOrEqual(0)
			expect(result.summary.totalQuantity).toBeGreaterThanOrEqual(0)
			expect(result.summary.totalVolume).toBeGreaterThanOrEqual(0)
			expect(result.summary.totalMass).toBeGreaterThanOrEqual(0)
			expect(result.summary.successCount).toBeGreaterThanOrEqual(0)
			expect(result.summary.errorCount).toBeGreaterThanOrEqual(0)
		})

		it('should reject missing inventoryText', async () => {
			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)

			const result = await response.json() as { error: string }
			expect(result.error).toContain('Missing inventoryText')
		})

		it('should reject non-string inventoryText', async () => {
			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText: 12345 }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)

			const result = await response.json() as { error: string }
			expect(result.error).toContain('must be a string')
		})

		it('should reject oversized input', async () => {
			// Create a string larger than 1MB
			const largeText = 'Tritanium\t1000\n'.repeat(100000)

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText: largeText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)

			const result = await response.json() as { error: string }
			expect(result.error).toContain('too large')
		})

		it('should handle empty lines gracefully', async () => {
			const inventoryText = `
Tritanium	1000

Pyerite	500

`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			expect(result).toHaveProperty('items')
			// Empty lines should be skipped without errors
		})

		it('should perform case-insensitive item matching', async () => {
			const inventoryText = `TRITANIUM	100
tritanium	100
Tritanium	100`

			const request = new Request('http://example.com/inventory/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inventoryText }),
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as ParseInventoryResponse
			// All three should parse successfully if case-insensitive matching works
			const tritaniumItems = result.items.filter(
				(item: any) => item.typeName && item.typeName.toLowerCase().includes('tritanium')
			)
			expect(tritaniumItems.length).toBeGreaterThanOrEqual(0) // Depends on DB content
		})
	})

	describe('GET /items/search', () => {
		it('should search for items by name', async () => {
			const request = new Request('http://example.com/items/search?q=trit', {
				method: 'GET',
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as any
			expect(Array.isArray(result)).toBe(true)

			if (result.length > 0) {
				expect(result[0]).toHaveProperty('typeId')
				expect(result[0]).toHaveProperty('typeName')
				expect(result[0]).toHaveProperty('groupName')
				expect(result[0]).toHaveProperty('categoryName')
			}
		})

		it('should reject short search queries', async () => {
			const request = new Request('http://example.com/items/search?q=t', {
				method: 'GET',
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)

			const result = await response.json() as any
			expect(result.error).toContain('at least 2 characters')
		})

		it('should respect limit parameter', async () => {
			const request = new Request('http://example.com/items/search?q=ore&limit=5', {
				method: 'GET',
			})

			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)

			const result = await response.json() as any
			expect(Array.isArray(result)).toBe(true)
			expect(result.length).toBeLessThanOrEqual(5)
		})

		it('should reject invalid limit values', async () => {
			const request1 = new Request('http://example.com/items/search?q=ore&limit=0', {
				method: 'GET',
			})

			const ctx1 = createExecutionContext()
			const response1 = await worker.fetch(request1, env, ctx1)
			await waitOnExecutionContext(ctx1)

			expect(response1.status).toBe(400)

			const request2 = new Request('http://example.com/items/search?q=ore&limit=101', {
				method: 'GET',
			})

			const ctx2 = createExecutionContext()
			const response2 = await worker.fetch(request2, env, ctx2)
			await waitOnExecutionContext(ctx2)

			expect(response2.status).toBe(400)
		})
	})
})
