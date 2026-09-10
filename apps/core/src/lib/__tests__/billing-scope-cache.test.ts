import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearUserBillScopeCache, getCachedUserBillScope } from '../billing-scope-cache'

const cacheState = vi.hoisted(() => ({
	row: null as { scope: unknown; expiresAt: number } | null,
	version: '0:0',
}))

const fakeCache = {
	getScopeVersion: vi.fn(async () => cacheState.version),
	getScope: vi.fn(async () => {
		if (!cacheState.row || cacheState.row.expiresAt <= Date.now()) {
			cacheState.row = null
			return null
		}
		return cacheState.row
	}),
	putScope: vi.fn(
		async (
			_cacheId: string,
			_userId: string,
			scope: unknown,
			expiresAt: number,
			_version: string
		) => {
			cacheState.row = { scope, expiresAt }
		}
	),
	clearScope: vi.fn(async () => {
		cacheState.row = null
		cacheState.version = '0:1'
	}),
	clearAllScopes: vi.fn(async () => {
		cacheState.row = null
		cacheState.version = '1:0'
	}),
}

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => fakeCache),
}))

const env = { BILLING_SCOPE_CACHE: {} as DurableObjectNamespace }
const scope = {
	characterIds: ['character-1'],
	corporationIds: [],
	groupIds: [],
	partyEntities: [{ entityId: 'character-1', entityType: 'character' as const }],
}

describe('billing scope cache', () => {
	beforeEach(async () => {
		cacheState.row = null
		cacheState.version = '0:0'
		vi.clearAllMocks()
		await clearUserBillScopeCache(undefined)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('does not repopulate an invalidated user scope from an in-flight load', async () => {
		let resolveFirst: ((value: typeof scope) => void) | undefined
		const firstLoad = new Promise<typeof scope>((resolve) => {
			resolveFirst = resolve
		})

		const firstRequest = getCachedUserBillScope(env, 'user-1', () => firstLoad)
		await clearUserBillScopeCache('user-1', env)
		resolveFirst?.(scope)
		await firstRequest

		const replacementLoader = vi.fn().mockResolvedValue(scope)
		await getCachedUserBillScope(env, 'user-1', replacementLoader)

		expect(replacementLoader).toHaveBeenCalledOnce()
	})

	it('clears derived scopes through the durable cache reset path', async () => {
		const loader = vi.fn().mockResolvedValue(scope)
		await getCachedUserBillScope(env, 'user-1', loader)

		await clearUserBillScopeCache(undefined, env)
		await getCachedUserBillScope(env, 'user-1', loader)

		expect(loader).toHaveBeenCalledTimes(2)
		expect(fakeCache.clearAllScopes).toHaveBeenCalled()
	})

	it('expires a scope even when no explicit invalidation event arrives', async () => {
		vi.useFakeTimers()
		const loader = vi.fn().mockResolvedValue(scope)
		await getCachedUserBillScope(env, 'user-1', loader)

		vi.advanceTimersByTime(5 * 60 * 1000 + 1)
		await getCachedUserBillScope(env, 'user-1', loader)

		expect(loader).toHaveBeenCalledTimes(2)
	})
})
