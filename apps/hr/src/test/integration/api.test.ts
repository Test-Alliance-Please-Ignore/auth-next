import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../index'

describe('Hr Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Hr')
	})

	it('can call Durable Object via example endpoint', async () => {
		const request = new Request('http://example.com/example?id=test-1')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('id', 'test-1')
		expect(data).toHaveProperty('result')
	})
})

describe('Hr Durable Object', () => {
	it('can increment counter', async () => {
		const id = env.HR.idFromName(`test-counter-${Date.now()}-${Math.random()}`)
		const stub = env.HR.get(id)

		const count1 = await stub.incrementCounter()
		const count2 = await stub.incrementCounter()

		expect(count2).toBeGreaterThan(count1)
		expect(count2).toBe(2)
	})

	it('can get state', async () => {
		const id = env.HR.idFromName(`test-state-${Date.now()}-${Math.random()}`)
		const stub = env.HR.get(id)

		await stub.incrementCounter()
		const state = await stub.getState()

		expect(state).toHaveProperty('counter')
		expect(state).toHaveProperty('lastUpdated')
		expect(state.counter).toBeGreaterThan(0)
	})

	it('can call example method', async () => {
		const id = env.HR.idFromName('test-example')
		const stub = env.HR.get(id)

		const result = await stub.exampleMethod('test message')

		expect(result).toContain('Received: test message')
		expect(result).toContain('counter:')
	})
})
