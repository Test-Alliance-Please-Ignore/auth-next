import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../index'

describe('Groups Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('status', 'ok')
		expect(data).toHaveProperty('service', 'groups')
	})
})

// TODO: Add integration tests for:
// - Category CRUD operations
// - Group CRUD operations
// - Membership management
// - Invitations and invite codes
// - Join requests

describe('Groups Durable Object', () => {
	it.todo('should create and manage categories')
	it.todo('should create and manage groups')
	it.todo('should handle group memberships')
	it.todo('should process invitations')
	it.todo('should handle invite codes')
	it.todo('should manage join requests')
})
