/**
 * @repo/fulcrum
 *
 * Shared types and interfaces for the Fulcrum Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'

/**
 * Public RPC interface for Fulcrum Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Fulcrum } from '@repo/fulcrum'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<Fulcrum>(env.FULCRUM, 'my-id')
 * // Add method calls here
 * ```
 */
export interface Fulcrum extends DurableObject {
	// TODO: Add RPC methods here
}
