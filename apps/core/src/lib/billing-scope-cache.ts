import { getStub } from '@repo/do-utils'

import type { BillingScopeCache, UserBillScope } from '../billing-scope-cache-do'

export type { UserBillScope } from '../billing-scope-cache-do'

export const BILLING_SCOPE_CACHE_ID = 'default'
const USER_BILL_SCOPE_CACHE_TTL_MS = 5 * 60 * 1000
const userBillScopeInFlight = new Map<string, Promise<UserBillScope>>()
const userBillScopeGenerations = new Map<string, number>()
let allUserBillScopeGeneration = 0

type BillingScopeCacheEnv = {
	BILLING_SCOPE_CACHE?: DurableObjectNamespace
}

function getUserBillScopeGeneration(userId: string): string {
	return `${allUserBillScopeGeneration}:${userBillScopeGenerations.get(userId) ?? 0}`
}

function clearLocalUserBillScopeCache(userId?: string): void {
	if (!userId) {
		userBillScopeInFlight.clear()
		userBillScopeGenerations.clear()
		allUserBillScopeGeneration += 1
		return
	}
	const hadInFlight = userBillScopeInFlight.has(userId)
	userBillScopeInFlight.delete(userId)
	if (hadInFlight) {
		userBillScopeGenerations.set(userId, (userBillScopeGenerations.get(userId) ?? 0) + 1)
	} else {
		userBillScopeGenerations.delete(userId)
	}
}

/** Invalidate the durable cache after clearing any local in-flight load. */
export async function clearUserBillScopeCache(
	userId?: string,
	env?: BillingScopeCacheEnv | DurableObjectNamespace
): Promise<void> {
	clearLocalUserBillScopeCache(userId)
	const namespace = env && 'BILLING_SCOPE_CACHE' in env ? env.BILLING_SCOPE_CACHE : env
	if (!namespace) return

	const cache = getStub<BillingScopeCache>(namespace, BILLING_SCOPE_CACHE_ID)
	if (userId) {
		await cache.clearScope(BILLING_SCOPE_CACHE_ID, userId)
	} else {
		await cache.clearAllScopes(BILLING_SCOPE_CACHE_ID)
	}
}

export async function getCachedUserBillScope(
	env: BillingScopeCacheEnv,
	userId: string,
	loader: () => Promise<UserBillScope>
): Promise<UserBillScope> {
	const existing = userBillScopeInFlight.get(userId)
	if (existing) return existing

	const generation = getUserBillScopeGeneration(userId)
	const promise = (async () => {
		const cache = env.BILLING_SCOPE_CACHE
			? getStub<BillingScopeCache>(env.BILLING_SCOPE_CACHE, BILLING_SCOPE_CACHE_ID)
			: null
		const cached = await cache?.getScope(BILLING_SCOPE_CACHE_ID, userId)
		if (cached) return cached.scope

		const version = await cache?.getScopeVersion(BILLING_SCOPE_CACHE_ID, userId)
		const scope = await loader()
		if (getUserBillScopeGeneration(userId) !== generation) return scope
		await cache?.putScope(
			BILLING_SCOPE_CACHE_ID,
			userId,
			scope,
			Date.now() + USER_BILL_SCOPE_CACHE_TTL_MS,
			version ?? ''
		)
		return scope
	})()
	userBillScopeInFlight.set(userId, promise)
	try {
		return await promise
	} finally {
		if (userBillScopeInFlight.get(userId) === promise) {
			userBillScopeInFlight.delete(userId)
			userBillScopeGenerations.delete(userId)
		} else if (!userBillScopeInFlight.has(userId)) {
			// The load was invalidated while in flight and no replacement load owns
			// the generation anymore.
			userBillScopeGenerations.delete(userId)
		}
	}
}
