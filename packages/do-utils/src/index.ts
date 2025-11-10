import { DurableObject } from 'cloudflare:workers'

/**
 * Durable Object Stub interface with RPC control methods
 */
export interface DurableObjectStubMethods {
	/**
	 * Disposes of the RPC stub, notifying the Durable Object that this client
	 * is no longer using it. Must be called to prevent resource leaks.
	 */
	dispose(): void

	/**
	 * Symbol.dispose for automatic resource management with 'using' keyword
	 */
	[Symbol.dispose](): void
}

/**
 * Get a typed Durable Object stub with automatic resource management
 *
 * This helper provides type-safe access to Durable Object stubs when calling
 * across workers using shared interface packages.
 *
 * The stub supports automatic disposal using the 'using' keyword (explicit resource management).
 *
 * Note: DurableObjectNamespace, DurableObjectId, and DurableObjectStub are expected
 * to be available as global types in the worker environment (from worker-configuration.d.ts)
 *
 * @example
 * ```ts
 * import type { UserTokenStore } from '@repo/user-token-store'
 * import { getStub } from '@repo/do-utils'
 *
 * // Using automatic resource management (recommended)
 * using stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')
 * const token = await stub.getAccessToken(characterId)
 * return token
 * // stub is automatically disposed when it goes out of scope
 *
 * // Manual disposal (if 'using' is not available)
 * const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')
 * try {
 *   const token = await stub.getAccessToken(characterId)
 *   return token
 * } finally {
 *   stub.dispose()
 * }
 * ```
 */
export function getStub<T>(
	namespace: any, // Will be DurableObjectNamespace in the worker environment
	id: string | any // Will be string | DurableObjectId in the worker environment
): T & DurableObjectStubMethods {
	// Will return DurableObjectStub & T in the worker environment
	const durableObjectId = typeof id === 'string' ? namespace.idFromName(id) : id
	const stub = namespace.get(durableObjectId)

	// Add Symbol.dispose for automatic resource management
	if (!stub[Symbol.dispose]) {
		stub[Symbol.dispose] = () => stub.dispose()
	}

	return stub
}

export class ResettableDurableObjectStub extends DurableObject {
	constructor(ctx: DurableObjectState, env: any) {
		super(ctx, env)
	}

	reset() {
		return this.ctx.storage.deleteAll()
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
