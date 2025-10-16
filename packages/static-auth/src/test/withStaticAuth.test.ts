import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { withStaticAuth } from '../middleware/withStaticAuth'

describe('withStaticAuth', () => {
	it('should allow requests with valid token', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token-123',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer valid-token-123',
			},
		})

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toEqual({ success: true })
	})

	it('should allow requests with valid token from comma-separated list', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'token1,token2,token3',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer token2',
			},
		})

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toEqual({ success: true })
	})

	it('should allow requests with valid token from array', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: ['token1', 'token2', 'token3'],
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer token3',
			},
		})

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toEqual({ success: true })
	})

	it('should reject requests without Authorization header', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test')

		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data).toEqual({ error: 'Missing or invalid Authorization header' })
	})

	it('should reject requests with invalid Authorization format', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Basic invalid',
			},
		})

		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data).toEqual({ error: 'Missing or invalid Authorization header' })
	})

	it('should reject requests with invalid token', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer invalid-token',
			},
		})

		expect(res.status).toBe(403)
		const data = await res.json()
		expect(data).toEqual({ error: 'Invalid token' })
	})

	it('should use custom unauthorized message', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token',
				unauthorizedMessage: 'Custom unauthorized message',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test')

		expect(res.status).toBe(401)
		const data = await res.json()
		expect(data).toEqual({ error: 'Custom unauthorized message' })
	})

	it('should use custom forbidden message', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: 'valid-token',
				forbiddenMessage: 'Custom forbidden message',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer invalid',
			},
		})

		expect(res.status).toBe(403)
		const data = await res.json()
		expect(data).toEqual({ error: 'Custom forbidden message' })
	})

	it('should handle empty token list', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: '',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer token',
			},
		})

		expect(res.status).toBe(500)
		const data = await res.json()
		expect(data).toEqual({ error: 'Authentication not configured' })
	})

	it('should trim whitespace from comma-separated tokens', async () => {
		const app = new Hono().use(
			'*',
			withStaticAuth({
				tokens: ' token1 , token2 , token3 ',
			})
		)

		app.get('/test', (c) => c.json({ success: true }))

		const res = await app.request('/test', {
			headers: {
				Authorization: 'Bearer token2',
			},
		})

		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data).toEqual({ success: true })
	})
})
