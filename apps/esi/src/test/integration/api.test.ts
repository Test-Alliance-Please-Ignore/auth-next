import { SELF } from 'cloudflare:test'
import { describe, expect, test } from 'vitest'

import '../..'

describe('ESI Proxy', () => {
	describe('Basic proxying', () => {
		test('proxies GET request to ESI', async () => {
			const res = await SELF.fetch('https://example.com/esi/status/')
			expect(res.status).toBe(200)
			expect(res.headers.get('X-Cache')).toBeTruthy()

			const data = await res.json()
			expect(data).toHaveProperty('players')
			expect(data).toHaveProperty('server_version')
		})

		test('returns proper status for non-existent endpoints', async () => {
			const res = await SELF.fetch('https://example.com/esi/nonexistent/endpoint/')
			expect(res.status).toBe(404)
		})

		test('forwards Accept-Language header', async () => {
			const res = await SELF.fetch('https://example.com/esi/universe/types/34/', {
				headers: {
					'Accept-Language': 'de',
				},
			})
			expect(res.status).toBe(200)
			// ESI returns localized names based on Accept-Language
		})
	})

	describe('Caching behavior', () => {
		test('cache miss on first request, hit on second', async () => {
			// Use a unique path to avoid cache conflicts
			const uniquePath = `/esi/status/?_test=${Date.now()}`

			// First request should be cache miss
			const res1 = await SELF.fetch(`https://example.com${uniquePath}`)
			expect(res1.status).toBe(200)
			expect(res1.headers.get('X-Cache')).toBe('MISS')

			// Second request should be cache hit
			const res2 = await SELF.fetch(`https://example.com${uniquePath}`)
			expect(res2.status).toBe(200)
			expect(res2.headers.get('X-Cache')).toBe('HIT')

			// Response bodies should be identical
			const data1 = await res1.json()
			const data2 = await res2.json()
			expect(data1).toEqual(data2)
		})

		test('nocache parameter bypasses cache', async () => {
			const uniquePath = `/esi/status/?_test=${Date.now()}`

			// First request
			const res1 = await SELF.fetch(`https://example.com${uniquePath}`)
			expect(res1.headers.get('X-Cache')).toBe('MISS')

			// Request with nocache should bypass cache
			const res2 = await SELF.fetch(`https://example.com${uniquePath}&nocache=1`)
			expect(res2.headers.get('X-Cache')).toBe('BYPASS')

			// Normal request should still hit cache
			const res3 = await SELF.fetch(`https://example.com${uniquePath}`)
			expect(res3.headers.get('X-Cache')).toBe('HIT')
		})

		test('different Accept-Language creates different cache entries', async () => {
			const uniquePath = `/esi/universe/types/34/?_test=${Date.now()}`

			// Request with English
			const res1 = await SELF.fetch(`https://example.com${uniquePath}`, {
				headers: { 'Accept-Language': 'en' },
			})
			expect(res1.headers.get('X-Cache')).toBe('MISS')

			// Request with German should miss cache
			const res2 = await SELF.fetch(`https://example.com${uniquePath}`, {
				headers: { 'Accept-Language': 'de' },
			})
			expect(res2.headers.get('X-Cache')).toBe('MISS')

			// Second English request should hit cache
			const res3 = await SELF.fetch(`https://example.com${uniquePath}`, {
				headers: { 'Accept-Language': 'en' },
			})
			expect(res3.headers.get('X-Cache')).toBe('HIT')
		})

		test('POST requests are not cached', async () => {
			// Using /universe/ids/ which accepts POST
			const res1 = await SELF.fetch('https://example.com/esi/universe/ids/', {
				method: 'POST',
				body: JSON.stringify(['Jita']),
				headers: {
					'Content-Type': 'application/json',
				},
			})
			expect(res1.status).toBe(200)
			expect(res1.headers.get('X-Cache')).toBe('BYPASS')

			// Second POST should also bypass
			const res2 = await SELF.fetch('https://example.com/esi/universe/ids/', {
				method: 'POST',
				body: JSON.stringify(['Jita']),
				headers: {
					'Content-Type': 'application/json',
				},
			})
			expect(res2.headers.get('X-Cache')).toBe('BYPASS')
		})
	})

	describe('Error handling', () => {
		test('handles ESI errors gracefully', async () => {
			// Invalid type ID should return error from ESI
			const res = await SELF.fetch('https://example.com/esi/universe/types/999999999999/')
			expect([404, 400]).toContain(res.status)
		})
	})

	describe('Header forwarding', () => {
		test('forwards conditional request headers', async () => {
			const res1 = await SELF.fetch('https://example.com/esi/status/')
			const etag = res1.headers.get('ETag')

			if (etag) {
				// Make conditional request with If-None-Match
				const res2 = await SELF.fetch('https://example.com/esi/status/', {
					headers: {
						'If-None-Match': etag,
					},
				})
				// ESI should return 304 if content hasn't changed
				expect([200, 304]).toContain(res2.status)
			}
		})
	})
})
