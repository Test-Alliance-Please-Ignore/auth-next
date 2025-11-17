/**
 * @repo/beancounter
 *
 * Shared types and interfaces for the Beancounter Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Beancounter Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Beancounter } from '@repo/beancounter'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Beancounter>(env.BEANCOUNTER, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Beancounter extends DurableObject {
	// TODO: Add RPC methods here
}
