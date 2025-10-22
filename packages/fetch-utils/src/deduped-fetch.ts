import { defaultAuthAwareKeyGenerator } from './key-generator'
import type { DedupConfig, DedupStats } from './types'

/**
 * DedupedFetch - Prevents duplicate concurrent HTTP requests
 *
 * When multiple callers request the same resource simultaneously, only one
 * fetch operation is performed and the response is shared among all callers.
 *
 * Security: By default, uses auth-aware key generation to prevent data leakage
 * between users with different Authorization headers.
 *
 * @example
 * ```typescript
 * const deduper = new DedupedFetch()
 *
 * // Two concurrent requests - only one fetch is performed
 * const [resp1, resp2] = await Promise.all([
 *   deduper.fetch('https://api.example.com/data'),
 *   deduper.fetch('https://api.example.com/data')
 * ])
 * ```
 */
export class DedupedFetch {
	private inFlight: Map<string, Promise<Response>>
	private config: Required<DedupConfig>
	private stats: DedupStats

	constructor(config?: DedupConfig) {
		this.inFlight = new Map()
		this.stats = {
			hits: 0,
			misses: 0,
			inFlight: 0,
		}

		// Default configuration with secure defaults
		this.config = {
			keyGenerator: config?.keyGenerator || defaultAuthAwareKeyGenerator,
			shouldDedupe: config?.shouldDedupe || this.defaultShouldDedupe,
			maxSize: config?.maxSize || Number.POSITIVE_INFINITY,
			debug: config?.debug || false,
		}
	}

	/**
	 * Default predicate for determining if a request should be deduplicated
	 * Only deduplicates GET requests by default (safest option)
	 */
	private defaultShouldDedupe(input: RequestInfo | URL, init?: RequestInit): boolean {
		const method = init?.method?.toUpperCase() || 'GET'
		return method === 'GET'
	}

	/**
	 * Fetch with deduplication
	 *
	 * If an identical request is already in-flight, returns a clone of that
	 * request's response instead of making a new fetch.
	 *
	 * @param input - Request URL or Request object
	 * @param init - RequestInit options
	 * @returns Promise<Response>
	 */
	async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		// Check if this request should be deduplicated
		if (!this.config.shouldDedupe(input, init)) {
			if (this.config.debug) {
				console.log('[DedupedFetch] Not deduplicating request (shouldDedupe returned false)')
			}
			return fetch(input, init)
		}

		// Generate cache key synchronously (no race conditions!)
		const key = this.config.keyGenerator(input, init)

		// Check for in-flight request
		const existing = this.inFlight.get(key)
		if (existing) {
			this.stats.hits++
			if (this.config.debug) {
				console.log(`[DedupedFetch] HIT: ${key} (${this.stats.hits} total hits)`)
			}
			// Clone the response so each caller can consume it independently
			return existing.then((r) => r.clone())
		}

		// No in-flight request - create new fetch
		this.stats.misses++
		if (this.config.debug) {
			console.log(`[DedupedFetch] MISS: ${key} (${this.stats.misses} total misses)`)
		}

		// Enforce maxSize limit by removing oldest entry if needed
		if (this.inFlight.size >= this.config.maxSize) {
			const firstKey = this.inFlight.keys().next().value
			if (firstKey) {
				this.inFlight.delete(firstKey)
				if (this.config.debug) {
					console.log(`[DedupedFetch] Removed oldest entry due to maxSize: ${firstKey}`)
				}
			}
		}

		// Create the fetch promise
		const fetchPromise = fetch(input, init).finally(() => {
			// Clean up after the request completes (success or error)
			this.inFlight.delete(key)
			this.stats.inFlight = this.inFlight.size
			if (this.config.debug) {
				console.log(
					`[DedupedFetch] Completed: ${key} (${this.stats.inFlight} in-flight remaining)`
				)
			}
		})

		// Store in map
		this.inFlight.set(key, fetchPromise)
		this.stats.inFlight = this.inFlight.size

		// Return cloned response so the original can be cached for concurrent callers
		return fetchPromise.then((r) => r.clone())
	}

	/**
	 * Clear all in-flight requests
	 * Useful for testing or manual cache invalidation
	 */
	clear(): void {
		this.inFlight.clear()
		this.stats.inFlight = 0
		if (this.config.debug) {
			console.log('[DedupedFetch] Cleared all in-flight requests')
		}
	}

	/**
	 * Get current deduplication statistics
	 *
	 * @returns Readonly statistics object
	 */
	getStats(): Readonly<DedupStats> {
		return { ...this.stats }
	}

	/**
	 * Check if a request is currently in-flight
	 *
	 * @param input - Request URL or Request object
	 * @param init - RequestInit options
	 * @returns true if request is in-flight
	 */
	has(input: RequestInfo | URL, init?: RequestInit): boolean {
		const key = this.config.keyGenerator(input, init)
		return this.inFlight.has(key)
	}

	/**
	 * Get the number of in-flight requests
	 *
	 * @returns Number of currently in-flight requests
	 */
	size(): number {
		return this.inFlight.size
	}
}
