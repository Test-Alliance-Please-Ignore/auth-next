/**
 * @repo/strife
 *
 * Shared types and interfaces for the Strife Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Strife Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Strife } from '@repo/strife'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Strife>(env.STRIFE, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Strife extends DurableObject {
	// TODO: Add RPC methods here
}
