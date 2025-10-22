/**
 * Configuration options for DedupedFetch
 */
export interface DedupConfig {
	/**
	 * Custom function to generate cache keys from requests
	 * Must be synchronous to avoid race conditions in deduplication.
	 *
	 * @default defaultAuthAwareKeyGenerator (method + URL + hashed auth header using BLAKE3)
	 */
	keyGenerator?: (input: RequestInfo | URL, init?: RequestInit) => string

	/**
	 * Predicate to determine if a request should be deduplicated
	 * @default GET requests only
	 */
	shouldDedupe?: (input: RequestInfo | URL, init?: RequestInit) => boolean

	/**
	 * Maximum number of concurrent in-flight requests to track
	 * Older requests will be removed when limit is exceeded
	 * @default undefined (no limit)
	 */
	maxSize?: number

	/**
	 * Enable debug logging to console
	 * @default false
	 */
	debug?: boolean
}

/**
 * Statistics for deduplication effectiveness
 */
export interface DedupStats {
	/**
	 * Number of requests served from in-flight cache (deduplication hits)
	 */
	hits: number

	/**
	 * Number of requests that required a new fetch (cache misses)
	 */
	misses: number

	/**
	 * Current number of in-flight requests
	 */
	inFlight: number
}
