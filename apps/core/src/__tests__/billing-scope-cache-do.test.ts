import { describe, expect, it } from 'vitest'

import { BillingScopeCacheDO } from '../billing-scope-cache-do'

function createCache() {
	const values = new Map<string, unknown>()
	let alarm: number | null = null
	const storage = {
		get: async <T>(key: string) => values.get(key) as T | undefined,
		put: async (key: string, value: unknown) => {
			values.set(key, value)
		},
		delete: async (keys: string | string[]) => {
			for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key)
		},
		transaction: async (callback: (transaction: any) => Promise<void>) => callback(storage),
		deleteAll: async () => {
			values.clear()
		},
		getAlarm: async () => alarm,
		setAlarm: async (value: number | Date) => {
			alarm = value instanceof Date ? value.getTime() : value
		},
		deleteAlarm: async () => {
			alarm = null
		},
		list: async <T>() =>
			new Map([...values].filter(([key]) => key.startsWith('billing-scope:entry:'))) as Map<
				string,
				T
			>,
	}
	return new BillingScopeCacheDO({ storage } as never, {} as never)
}

const scope = {
	characterIds: ['character-1'],
	corporationIds: [],
	groupIds: [],
	partyEntities: [{ entityId: 'character-1', entityType: 'character' as const }],
}

describe('BillingScopeCacheDO', () => {
	it('persists scopes and expires them at read time', async () => {
		const cache = createCache()
		await cache.putScope('default', 'user-1', scope, Date.now() + 1000, '0:0')

		expect(await cache.getScope('default', 'user-1')).toEqual({
			scope,
			expiresAt: expect.any(Number),
			version: '0:0',
		})

		await cache.putScope('default', 'user-1', scope, Date.now() - 1, '0:0')
		expect(await cache.getScope('default', 'user-1')).toBeNull()
	})

	it('supports user and global invalidation', async () => {
		const cache = createCache()
		await cache.putScope('default', 'user-1', scope, Date.now() + 1000, '0:0')
		await cache.putScope('default', 'user-2', scope, Date.now() + 1000, '0:0')

		await cache.clearScope('default', 'user-1')
		expect(await cache.getScope('default', 'user-1')).toBeNull()
		expect(await cache.getScope('default', 'user-2')).not.toBeNull()

		await cache.clearAllScopes('default')
		expect(await cache.getScope('default', 'user-2')).toBeNull()
	})

	it('does not allow an in-flight stale write after invalidation', async () => {
		const cache = createCache()
		const version = await cache.getScopeVersion('default', 'user-1')

		await cache.clearScope('default', 'user-1')
		await cache.putScope('default', 'user-1', scope, Date.now() + 1000, version)

		expect(await cache.getScope('default', 'user-1')).toBeNull()
	})

	it('cleans expired entries from storage through its alarm', async () => {
		const cache = createCache()
		await cache.putScope('default', 'expired', scope, Date.now() - 1, '0:0')
		await cache.putScope('default', 'active', scope, Date.now() + 60_000, '0:0')

		await cache.alarm()

		expect(await cache.getScope('default', 'expired')).toBeNull()
		expect(await cache.getScope('default', 'active')).not.toBeNull()
	})
})
