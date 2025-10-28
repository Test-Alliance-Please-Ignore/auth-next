import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getStub } from '@repo/do-utils'
import type { Features } from '@repo/features'
import type { Env } from '../../context'
import worker from '../../index'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Features Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Features')
	})
})

describe('Features Durable Object - Feature Flags', () => {
	it('can register a new feature flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		const flag = await stub.registerFlag('test.feature.enabled', true, {
			description: 'Test feature flag',
			tags: ['test', 'integration'],
		})

		expect(flag).toHaveProperty('id')
		expect(flag.key).toBe('test.feature.enabled')
		expect(flag.valueType).toBe('boolean')
		expect(flag.booleanValue).toBe(true)
		expect(flag.description).toBe('Test feature flag')
		expect(flag.tags).toEqual(['test', 'integration'])
	})

	it('can check a feature flag value', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.check.enabled', true)
		const value = await stub.checkFlag('test.check.enabled')

		expect(value).toBe(true)
	})

	it('can set/update a feature flag value', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.update.enabled', false)
		const updated = await stub.setFlag('test.update.enabled', true)

		expect(updated.booleanValue).toBe(true)
	})

	it('can delete a feature flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.delete.enabled', true)
		const deleted = await stub.deleteFlag('test.delete.enabled')

		expect(deleted).toBe(true)

		const value = await stub.checkFlag('test.delete.enabled')
		expect(value).toBeNull()
	})

	it('can list feature flags with prefix filtering', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('notifications.email.enabled', true)
		await stub.registerFlag('notifications.sms.enabled', false)
		await stub.registerFlag('features.dark-mode.enabled', true)

		const flags = await stub.listFlags({ prefix: 'notifications' })

		expect(flags).toHaveLength(2)
		expect(flags.every((f: { key: string }) => f.key.startsWith('notifications'))).toBe(true)
	})

	it('can filter feature flags by tags', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.prod.feature', true, { tags: ['production'] })
		await stub.registerFlag('test.dev.feature', true, { tags: ['development'] })

		const value = await stub.checkFlag('test.prod.feature', ['production'])
		expect(value).toBe(true)

		const noMatch = await stub.checkFlag('test.prod.feature', ['development'])
		expect(noMatch).toBeNull()
	})

	it('can get a specific feature flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.get.enabled', true, {
			description: 'Test get method',
		})

		const flag = await stub.getFlag('test.get.enabled')

		expect(flag).not.toBeNull()
		expect(flag?.key).toBe('test.get.enabled')
		expect(flag?.description).toBe('Test get method')
	})

	it('throws error when registering duplicate key', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('test.duplicate.enabled', true)

		await expect(stub.registerFlag('test.duplicate.enabled', false)).rejects.toThrow(
			'already exists',
		)
	})
})
