import { DurableObject } from 'cloudflare:workers'

// Export SQLite helpers for Durable Objects
export { createSqliteDbClient, migrateSqlite } from './sqlite-client'
export type { DrizzleSqliteDODatabase, SqliteMigrationConfig } from './sqlite-client'

// Fluent, type-safe DO namespace accessor: singleton / per-name / sharded (+ fan-out)
export { forDO, shardIndex, shardName } from './for-do'
export { disposeRpcResult, withRpcResult } from './rpc-result'
export type {
	AnyDoNamespace,
	DoClient,
	ExplicitInterfaceRequired,
	ResolveStub,
	ShardOptions,
	ShardedClient,
	StubOptions,
} from './for-do'

/**
 * Get a typed Durable Object stub with automatic resource management
 *
 * This helper provides type-safe access to Durable Object stubs when calling
 * across workers using shared interface packages.
 *
 * The stub itself does not need disposal. However, every non-primitive value
 * returned by a cross-worker RPC method must be disposed after its contents are
 * consumed. Use `withRpcResult` for ordinary Promise-typed interfaces, or the
 * native `using` syntax when the return type is declared as Disposable.
 *
 * Note: DurableObjectNamespace, DurableObjectId, and DurableObjectStub are expected
 * to be available as global types in the worker environment (from worker-configuration.d.ts)
 *
 * @example
 * ```ts
 * import type { EveTokenStore } from '@repo/eve-token-store'
 * import { getStub, withRpcResult } from '@repo/do-utils'
 *
 * // Regular DurableObject stub (the stub itself needs no disposal)
 * const stub = getStub<Groups>(c.env.GROUPS, 'default')
 * const groups = await withRpcResult(stub.listGroups(), (result) => [...result])
 *
 * // RpcTarget result (native `using` is also valid when the interface exposes it)
 * ```
 */
export function getStub<T>(
	namespace: any, // Will be DurableObjectNamespace in the worker environment
	id: string | any // Will be string | DurableObjectId in the worker environment
): T {
	// Will return DurableObjectStub & T in the worker environment
	const durableObjectId = typeof id === 'string' ? namespace.idFromName(id) : id
	const stub = namespace.get(durableObjectId)
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

/**
 * Simple LRU (Least Recently Used) Cache implementation for in-memory caching
 *
 * This cache uses a Map to store key-value pairs and implements LRU eviction
 * when the cache reaches its maximum size. The cache is ideal for:
 * - Caching frequently accessed data in Durable Objects
 * - Reducing database queries
 * - Improving response times for repeated lookups
 *
 * @example
 * ```ts
 * import { LRUCache } from '@repo/do-utils'
 *
 * class MyDurableObject extends DurableObject {
 *   private cache = new LRUCache<string>(1000)
 *
 *   async getData(id: string) {
 *     // Check cache first
 *     const cached = this.cache.get(id)
 *     if (cached !== undefined) {
 *       return cached
 *     }
 *
 *     // Fetch from database
 *     const data = await this.db.query(id)
 *
 *     // Store in cache
 *     this.cache.set(id, data)
 *
 *     return data
 *   }
 * }
 * ```
 */
export class LRUCache<T> {
	private cache: Map<string, T>
	private readonly maxSize: number

	/**
	 * Create a new LRU cache
	 * @param maxSize - Maximum number of entries to store (default: 1000)
	 */
	constructor(maxSize: number = 1000) {
		this.cache = new Map()
		this.maxSize = maxSize
	}

	/**
	 * Get a value from the cache
	 * @param key - The cache key
	 * @returns The cached value, or undefined if not found
	 */
	get(key: string): T | undefined {
		const value = this.cache.get(key)
		if (value !== undefined) {
			// Move to end (most recently used)
			this.cache.delete(key)
			this.cache.set(key, value)
		}
		return value
	}

	/**
	 * Set a value in the cache
	 * @param key - The cache key
	 * @param value - The value to cache
	 */
	set(key: string, value: T): void {
		// If key exists, delete it first to update position
		if (this.cache.has(key)) {
			this.cache.delete(key)
		}

		// If at capacity, remove least recently used (first item)
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			if (firstKey !== undefined) {
				this.cache.delete(firstKey)
			}
		}

		this.cache.set(key, value)
	}

	/**
	 * Check if a key exists in the cache
	 * @param key - The cache key
	 * @returns True if the key exists, false otherwise
	 */
	has(key: string): boolean {
		return this.cache.has(key)
	}

	/**
	 * Get the current number of entries in the cache
	 * @returns The cache size
	 */
	get size(): number {
		return this.cache.size
	}

	/**
	 * Clear all entries from the cache
	 */
	clear(): void {
		this.cache.clear()
	}
}
