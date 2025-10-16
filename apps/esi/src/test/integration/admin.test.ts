import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import '../..'

describe('Admin API Integration', () => {
	const adminToken = env.ADMIN_API_TOKENS || 'test-admin-token'

	describe('Authentication', () => {
		it('should reject requests without auth token', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/stats')
			expect(res.status).toBe(401)
			const data = await res.json()
			expect(data).toEqual({ error: 'Missing or invalid Authorization header' })
		})

		it('should reject requests with invalid auth token', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/stats', {
				headers: {
					Authorization: 'Bearer invalid-token',
				},
			})
			expect(res.status).toBe(403)
			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid token' })
		})

		it('should accept requests with valid auth token', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/stats', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})
			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data).toHaveProperty('success', true)
		})
	})

	describe('GET /admin/stats', () => {
		it('should return token statistics', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/stats', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data).toEqual({
				success: true,
				data: {
					stats: {
						totalCount: expect.any(Number),
						expiredCount: expect.any(Number),
						activeCount: expect.any(Number),
					},
				},
			})
		})
	})

	describe('GET /admin/tokens', () => {
		it('should return paginated list of tokens', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data).toEqual({
				success: true,
				data: {
					total: expect.any(Number),
					limit: 50,
					offset: 0,
					results: expect.any(Array),
				},
			})
		})

		it('should support pagination parameters', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens?limit=10&offset=5', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data.data).toHaveProperty('limit', 10)
			expect(data.data).toHaveProperty('offset', 5)
		})

		it('should limit maximum page size to 100', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens?limit=500', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data.data?.limit).toBeLessThanOrEqual(100)
		})
	})

	describe('GET /admin/tokens/:characterId', () => {
		it('should return 404 for non-existent character', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/999999999', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(404)
			const data = await res.json()
			expect(data).toEqual({ success: false, error: 'Token not found' })
		})

		it('should validate character ID parameter', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/invalid', {
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(400)
			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid character ID' })
		})
	})

	describe('DELETE /admin/tokens/:characterId', () => {
		it('should validate character ID parameter', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/invalid', {
				method: 'DELETE',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(400)
			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid character ID' })
		})

		it('should successfully delete tokens for character', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/12345', {
				method: 'DELETE',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(200)
			const data = await res.json()
			expect(data).toEqual({ success: true })
		})
	})

	describe('DELETE /admin/tokens/proxy/:proxyToken', () => {
		it('should validate proxy token format', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/proxy/short', {
				method: 'DELETE',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(400)
			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid proxy token format' })
		})

		it('should return 404 for non-existent proxy token', async () => {
			// Generate a valid-format but non-existent proxy token (64 hex chars)
			const fakeToken = '0'.repeat(64)

			const res = await SELF.fetch(`https://example.com/esi/admin/tokens/proxy/${fakeToken}`, {
				method: 'DELETE',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(404)
			const data = await res.json()
			expect(data).toEqual({ success: false, error: 'Token not found' })
		})
	})

	describe('POST /admin/tokens/:characterId/refresh', () => {
		it('should validate character ID parameter', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/invalid/refresh', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(400)
			const data = await res.json()
			expect(data).toEqual({ error: 'Invalid character ID' })
		})

		it('should return 404 for non-existent character', async () => {
			const res = await SELF.fetch('https://example.com/esi/admin/tokens/999999999/refresh', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${adminToken}`,
				},
			})

			expect(res.status).toBe(404)
			const data = await res.json()
			expect(data).toEqual({ success: false, error: 'Token not found' })
		})
	})
})
