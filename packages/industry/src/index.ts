/**
 * @repo/industry
 *
 * Shared types and interfaces for the Industry Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Industry Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Industry } from '@repo/industry'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Industry>(env.INDUSTRY, 'my-id')
 * // Call RPC methods on stub
 * ```
 */
export interface Industry extends DurableObject {
	// Add RPC method signatures here
}
