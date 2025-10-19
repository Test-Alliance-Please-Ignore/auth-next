import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../index'

describe('EveCharacterData Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('EveCharacterData')
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

describe.skip('EveCharacterData Durable Object', () => {
	it.skip('can increment counter', async () => {
		// const id = env.EVE_CHARACTER_DATA.idFromName(`test-counter-${Date.now()}-${Math.random()}`)
		// const stub = env.EVE_CHARACTER_DATA.get(id)

		// const count1 = await stub.incrementCounter()
		// const count2 = await stub.incrementCounter()

		// expect(count2).toBeGreaterThan(count1)
		// expect(count2).toBe(2)
	})

	it.skip('can get state', async () => {
		// const id = env.EVE_CHARACTER_DATA.idFromName(`test-state-${Date.now()}-${Math.random()}`)
		// const stub = env.EVE_CHARACTER_DATA.get(id)

		// await stub.incrementCounter()
		// const state = await stub.getState()

		// expect(state).toHaveProperty('counter')
		// expect(state).toHaveProperty('lastUpdated')
		// expect(state.counter).toBeGreaterThan(0)
	})

	it.skip('can call example method', async () => {
		// const id = env.EVE_CHARACTER_DATA.idFromName('test-example')
		// const stub = env.EVE_CHARACTER_DATA.get(id)

		// const result = await stub.exampleMethod('test message')

		// expect(result).toContain('Received: test message')
		// expect(result).toContain('counter:')
	})
})
