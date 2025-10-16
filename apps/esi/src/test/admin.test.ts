import { describe, expect, it } from 'vitest'

import { adminRouter } from '../admin'

import type { Env } from '../context'

describe('Admin API Unit Tests', () => {
	const mockEnv = {
		ADMIN_API_TOKENS: 'test-admin-token',
	} as Env

	it('should reject requests without auth token', async () => {
		const res = await adminRouter.request('/admin/stats', {}, mockEnv)

		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data).toEqual({ error: 'Missing or invalid Authorization header' })
	})

	it('should reject requests with invalid auth token', async () => {
		const res = await adminRouter.request(
			'/admin/stats',
			{
				headers: {
					Authorization: 'Bearer invalid-token',
				},
			},
			mockEnv
		)

		expect(res.status).toBe(403)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid token' })
	})

	it('should validate characterId parameter on GET', async () => {
		const res = await adminRouter.request(
			'/admin/tokens/invalid',
			{
				headers: {
					Authorization: 'Bearer test-admin-token',
				},
			},
			mockEnv
		)

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid character ID' })
	})

	it('should validate characterId parameter on DELETE', async () => {
		const res = await adminRouter.request(
			'/admin/tokens/invalid',
			{
				method: 'DELETE',
				headers: {
					Authorization: 'Bearer test-admin-token',
				},
			},
			mockEnv
		)

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid character ID' })
	})

	it('should validate characterId parameter on POST refresh', async () => {
		const res = await adminRouter.request(
			'/admin/tokens/invalid/refresh',
			{
				method: 'POST',
				headers: {
					Authorization: 'Bearer test-admin-token',
				},
			},
			mockEnv
		)

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid character ID' })
	})

	it('should validate proxy token format', async () => {
		const res = await adminRouter.request(
			'/admin/tokens/proxy/short',
			{
				method: 'DELETE',
				headers: {
					Authorization: 'Bearer test-admin-token',
				},
			},
			mockEnv
		)

		expect(res.status).toBe(400)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid proxy token format' })
	})
})
