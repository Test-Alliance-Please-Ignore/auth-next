/**
 * @repo/postman
 *
 * Shared types and interfaces for the Postman Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */
import type { DurableObject } from 'cloudflare:workers'

/**
 * Public RPC interface for Postman Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Postman } from '@repo/postman'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Postman>(env.POSTMAN, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Postman extends DurableObject {
	// TODO: Add RPC methods here
}
