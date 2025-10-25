// Local imports for use in this file
import { DedupedFetch } from './deduped-fetch'

import type { DedupConfig } from './types'

/**
 * @repo/fetch-utils
 *
 * Utilities for optimizing HTTP fetch operations in Cloudflare Workers
 *
 * ## Features
 *
 * - **Request Deduplication**: Prevent duplicate concurrent HTTP requests
 * - **Auth-Aware Key Generation**: Secure deduplication that respects Authorization headers
 * - **Statistics Tracking**: Monitor deduplication effectiveness
 * - **Flexible Configuration**: Customize key generation and deduplication logic
 *
 * ## Security
 *
 * By default, the package uses auth-aware key generation to prevent data leakage
 * between users. Authorization headers are hashed using SHA-256 before being
 * included in cache keys.
 *
 * @example Basic usage
 * ```typescript
 * import { DedupedFetch } from '@repo/fetch-utils'
 *
 * const deduper = new DedupedFetch()
 *
 * // Multiple concurrent calls - only one fetch is performed
 * const results = await Promise.all([
 *   deduper.fetch('https://api.example.com/data'),
 *   deduper.fetch('https://api.example.com/data'),
 *   deduper.fetch('https://api.example.com/data')
 * ])
 * ```
 *
 * @example Custom configuration
 * ```typescript
 * import { DedupedFetch, bodyAndAuthAwareKeyGenerator } from '@repo/fetch-utils'
 *
 * const deduper = new DedupedFetch({
 *   keyGenerator: bodyAndAuthAwareKeyGenerator,
 *   shouldDedupe: (input, init) => {
 *     // Dedupe GET and POST requests
 *     const method = init?.method?.toUpperCase() || 'GET'
 *     return ['GET', 'POST'].includes(method)
 *   },
 *   debug: true
 * })
 * ```
 */

// Core class
export { DedupedFetch } from './deduped-fetch'

// Types
export type { DedupConfig, DedupStats } from './types'

// Key generators
export {
	defaultKeyGenerator,
	defaultAuthAwareKeyGenerator,
	bodyAwareKeyGenerator,
	bodyAndAuthAwareKeyGenerator,
} from './key-generator'

/**
 * Create a deduped fetch function with optional configuration
 *
 * This is a convenience function that creates a DedupedFetch instance
 * and returns a bound fetch method for easier usage.
 *
 * @param config - Optional configuration for deduplication
 * @returns Deduped fetch function
 *
 * @example
 * ```typescript
 * import { createDedupedFetch } from '@repo/fetch-utils'
 *
 * const fetch = createDedupedFetch({ debug: true })
 *
 * const response = await fetch('https://api.example.com/data')
 * ```
 */
export function createDedupedFetch(config?: DedupConfig) {
	const deduper = new DedupedFetch(config)
	return (input: RequestInfo | URL, init?: RequestInit) => deduper.fetch(input, init)
}
