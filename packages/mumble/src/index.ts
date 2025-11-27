/**
 * @repo/mumble
 *
 * Shared types and interfaces for the Mumble Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Mumble Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Mumble } from '@repo/mumble'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Mumble>(env.MUMBLE, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Mumble extends DurableObject {
	// TODO: Add RPC methods here
}
