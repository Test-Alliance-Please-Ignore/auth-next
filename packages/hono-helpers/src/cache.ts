/**
 * Time-based in-memory cache with automatic cleanup
 *
 * @example
 * ```ts
 * const cache = new TimeCache<boolean>(15000) // 15 second TTL
 *
 * const result = await cache.getOrSet('user:123:perm', async () => {
 *   return await checkPermission()
 * })
 * ```
 */
export class TimeCache<T> {
	private cache = new Map<
		string,
		{
			value: T
			timestamp: number
		}
	>()

	/**
	 * @param ttlMs - Time to live in milliseconds
	 * @param maxSize - Maximum cache size before cleanup (default: 1000)
	 */
	constructor(
		private ttlMs: number,
		private maxSize: number = 1000
	) {}

	/**
	 * Get a cached value or compute and cache it
	 */
	async getOrSet(key: string, compute: () => Promise<T> | T): Promise<T> {
		const cached = this.get(key)
		if (cached !== undefined) {
			return cached
		}

		const value = await compute()
		this.set(key, value)
		return value
	}

	/**
	 * Get a cached value if it exists and is not expired
	 */
	get(key: string): T | undefined {
		const cached = this.cache.get(key)
		if (!cached) return undefined

		const now = Date.now()
		if (now - cached.timestamp >= this.ttlMs) {
			this.cache.delete(key)
			return undefined
		}

		return cached.value
	}

	/**
	 * Set a value in the cache
	 */
	set(key: string, value: T): void {
		const now = Date.now()
		this.cache.set(key, { value, timestamp: now })

		// Clean up old entries if cache is getting large
		if (this.cache.size > this.maxSize) {
			this.cleanup()
		}
	}

	/**
	 * Check if a key exists and is not expired
	 */
	has(key: string): boolean {
		return this.get(key) !== undefined
	}

	/**
	 * Delete a specific key
	 */
	delete(key: string): boolean {
		return this.cache.delete(key)
	}

	/**
	 * Clear all cached values
	 */
	clear(): void {
		this.cache.clear()
	}

	/**
	 * Remove expired entries from cache
	 */
	private cleanup(): void {
		const now = Date.now()
		for (const [key, value] of this.cache.entries()) {
			if (now - value.timestamp >= this.ttlMs) {
				this.cache.delete(key)
			}
		}
	}

	/**
	 * Get current cache size
	 */
	get size(): number {
		return this.cache.size
	}
}
