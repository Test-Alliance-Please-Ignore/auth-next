/**
 * @repo/donations
 *
 * Shared types and interfaces for the Donations Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Donations Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Donations } from '@repo/donations'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Donations>(env.DONATIONS, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Donations extends DurableObject {
	// TODO: Add RPC methods here
}
