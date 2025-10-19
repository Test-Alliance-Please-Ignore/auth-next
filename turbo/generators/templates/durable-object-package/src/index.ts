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
 * const stub = getStub<{{ pascalCase name }}>(env.{{ constantCase name }}, 'my-id')
 * const result = await stub.exampleMethod('hello')
 * ```
 */
export interface {{ pascalCase name }} extends DurableObject {
	/**
	 * Example RPC method
	 * @param message - A message to process
	 * @returns A response message
	 */
	exampleMethod(message: string): Promise<string>

	/**
	 * Example method to get current state
	 * @returns Current state data
	 */
	getState(): Promise<{{ pascalCase name }}State>

	/**
	 * Example method to increment a counter
	 * @returns The new counter value
	 */
	incrementCounter(): Promise<number>
}

/**
 * State structure for {{ pascalCase name }} Durable Object
 */
export interface {{ pascalCase name }}State {
	counter: number
	lastUpdated: number
	metadata?: Record<string, unknown>
}

/**
 * WebSocket message types for {{ pascalCase name }} Durable Object
 */
export interface {{ pascalCase name }}Message {
	type: 'ping' | 'update' | 'subscribe' | 'unsubscribe'
	payload?: unknown
}
