import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Features } from '@repo/features'
import type { Env } from '../../context'

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
			'already exists'
		)
	})
})

describe('Features Durable Object - User Feature Flags', () => {
	const userId = () => `user-${Date.now()}-${Math.random()}`

	it('sets a user override for an existing flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		await stub.registerFlag('user.set.enabled', false)
		const override = await stub.setUserFlag(user, 'user.set.enabled', true)

		expect(override).toHaveProperty('id')
		expect(override.key).toBe('user.set.enabled')
		expect(override.userId).toBe(user)
		expect(override.enabled).toBe(true)
	})

	it('throws when setting a user override for an unknown flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await expect(stub.setUserFlag(userId(), 'user.unknown.flag', true)).rejects.toThrow(
			'not found'
		)
	})

	it('upserts (updates) an existing user override without duplicating', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		await stub.registerFlag('user.upsert.enabled', false)
		await stub.setUserFlag(user, 'user.upsert.enabled', true)
		const updated = await stub.setUserFlag(user, 'user.upsert.enabled', false)

		expect(updated.enabled).toBe(false)

		const overrides = await stub.listUserFlags(user)
		expect(overrides).toHaveLength(1)
		expect(overrides[0]?.enabled).toBe(false)
	})

	it('resolves checkUserFlag with override precedence over the global default', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const enabledUser = userId()
		const defaultUser = userId()

		// Global default is false...
		await stub.registerFlag('user.resolve.enabled', false)

		// ...but this user is overridden to true.
		await stub.setUserFlag(enabledUser, 'user.resolve.enabled', true)

		expect(await stub.checkUserFlag(enabledUser, 'user.resolve.enabled')).toBe(true)
		// A user without an override falls back to the global default (false).
		expect(await stub.checkUserFlag(defaultUser, 'user.resolve.enabled')).toBe(false)
	})

	it('resolves checkUserFlag to the global default when no override exists', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		await stub.registerFlag('user.globaltrue.enabled', true)

		expect(await stub.checkUserFlag(userId(), 'user.globaltrue.enabled')).toBe(true)
	})

	it('resolves checkUserFlag to false for an unknown flag', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		expect(await stub.checkUserFlag(userId(), 'user.does-not-exist')).toBe(false)
	})

	it('resolves checkUserFlags for a batch of keys', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		await stub.registerFlag('user.batch.a', true)
		await stub.registerFlag('user.batch.b', false)
		await stub.setUserFlag(user, 'user.batch.b', true)

		const resolved = await stub.checkUserFlags(user, [
			'user.batch.a',
			'user.batch.b',
			'user.batch.missing',
		])

		expect(resolved).toEqual({
			'user.batch.a': true, // global default
			'user.batch.b': true, // user override wins over global false
			'user.batch.missing': false, // unknown flag -> false
		})
	})

	it('returns an empty map from checkUserFlags for no keys', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)

		expect(await stub.checkUserFlags(userId(), [])).toEqual({})
	})

	it('gets and deletes a user override', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		await stub.registerFlag('user.getdelete.enabled', false)
		await stub.setUserFlag(user, 'user.getdelete.enabled', true)

		const fetched = await stub.getUserFlag(user, 'user.getdelete.enabled')
		expect(fetched?.enabled).toBe(true)

		expect(await stub.deleteUserFlag(user, 'user.getdelete.enabled')).toBe(true)
		expect(await stub.getUserFlag(user, 'user.getdelete.enabled')).toBeNull()
		// After deletion the user reverts to the global default (false).
		expect(await stub.checkUserFlag(user, 'user.getdelete.enabled')).toBe(false)
	})

	it('returns null/false when getting or deleting overrides for unknown flags', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		expect(await stub.getUserFlag(user, 'user.ghost.flag')).toBeNull()
		expect(await stub.deleteUserFlag(user, 'user.ghost.flag')).toBe(false)
	})

	it('lists a user overrides with prefix and enabled filters', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		await stub.registerFlag('user.list.alpha', false)
		await stub.registerFlag('user.list.beta', false)
		await stub.registerFlag('other.list.gamma', false)

		await stub.setUserFlag(user, 'user.list.alpha', true)
		await stub.setUserFlag(user, 'user.list.beta', false)
		await stub.setUserFlag(user, 'other.list.gamma', true)

		const prefixed = await stub.listUserFlags(user, { prefix: 'user.list' })
		expect(prefixed.map((f) => f.key)).toEqual(['user.list.alpha', 'user.list.beta'])

		const enabledOnly = await stub.listUserFlags(user, { enabled: true })
		expect(enabledOnly.map((f) => f.key)).toEqual(['other.list.gamma', 'user.list.alpha'])
	})

	it('lists the users who have an override for a flag, ordered by ascending user id', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const token = `${Date.now()}-${Math.random()}`
		const userLow = `aaa-${token}`
		const userHigh = `zzz-${token}`

		await stub.registerFlag('user.flagusers.enabled', false)
		// Insert the higher-sorting id first to prove results come back ordered
		// by user id rather than by insertion order.
		await stub.setUserFlag(userHigh, 'user.flagusers.enabled', true)
		await stub.setUserFlag(userLow, 'user.flagusers.enabled', false)

		const all = await stub.listFlagUsers('user.flagusers.enabled')
		expect(all).toHaveLength(2)
		expect(all.every((o) => o.key === 'user.flagusers.enabled')).toBe(true)
		// Ascending by user id despite the reverse insertion order above.
		expect(all.map((o) => o.userId)).toEqual([userLow, userHigh])

		const enabledOnly = await stub.listFlagUsers('user.flagusers.enabled', { enabled: true })
		expect(enabledOnly).toHaveLength(1)
		expect(enabledOnly[0]?.userId).toBe(userHigh)

		// Unknown flag yields an empty list rather than throwing.
		expect(await stub.listFlagUsers('user.flagusers.missing')).toEqual([])
	})

	it('treats the listUserFlags prefix as a literal (escapes LIKE wildcards)', async () => {
		const stub = getStub<Features>(testEnv.FEATURES, `test-${Date.now()}-${Math.random()}`)
		const user = userId()

		// 'user_lit.a' should match the literal prefix 'user_lit'; 'userXlit.a'
		// must NOT, even though an unescaped '_' wildcard would match it.
		await stub.registerFlag('user_lit.a', false)
		await stub.registerFlag('userXlit.a', false)
		await stub.setUserFlag(user, 'user_lit.a', true)
		await stub.setUserFlag(user, 'userXlit.a', true)

		const matches = await stub.listUserFlags(user, { prefix: 'user_lit' })
		expect(matches.map((f) => f.key)).toEqual(['user_lit.a'])
	})
})
