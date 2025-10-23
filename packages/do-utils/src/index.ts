import { DurableObject } from "cloudflare:workers";

/**
 * Get a typed Durable Object stub
 *
 * This helper provides type-safe access to Durable Object stubs when calling
 * across workers using shared interface packages.
 *
 * Note: DurableObjectNamespace, DurableObjectId, and DurableObjectStub are expected
 * to be available as global types in the worker environment (from worker-configuration.d.ts)
 *
 * @example
 * ```ts
 * import type { UserTokenStore } from '@repo/user-token-store'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')
 * const token = await stub.getAccessToken(characterId)
 * ```
 */
export function getStub<T>(
	namespace: any, // Will be DurableObjectNamespace in the worker environment
	id: string | any // Will be string | DurableObjectId in the worker environment
): any & T {
	// Will return DurableObjectStub & T in the worker environment
	const durableObjectId = typeof id === 'string' ? namespace.idFromName(id) : id
	return namespace.get(durableObjectId) as any & T
}

export class ResettableDurableObjectStub extends DurableObject {
	constructor(
		ctx: DurableObjectState,
		env: any
	) {
		super(ctx, env)
	}

	reset() {
		return this.ctx.storage.deleteAll();
	}
}

export class KVCache<K, T> {
	constructor(private namespace: any) {}

	async get(key: K): Promise<T | null> {
		return this.namespace.get(key) as T | null
	}

	async set(key: K, value: T) {
		return this.namespace.put(key, value)
	}
}

export function getCache<K, T>(namespace: unknown): KVCache<K, T> {
	return new KVCache(namespace)
}
