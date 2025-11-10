/**
 * @repo/{{ name }}
 *
 * Shared types and interfaces for the {{ pascalCase name }} Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for {{ pascalCase name }} Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { {{ pascalCase name }} } from '@repo/{{ name }}'
 * import { getStub } from '@repo/do-utils'
 *
 * using stub = getStub<{{ pascalCase name }}>(env.{{ constantCase name }}, 'my-id')
 * // Add method calls here
 * ```
 */
export interface {{ pascalCase name }} extends DurableObject {
	// TODO: Add RPC methods here
}
