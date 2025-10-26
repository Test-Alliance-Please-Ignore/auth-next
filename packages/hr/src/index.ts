/**
 * @repo/hr
 *
 * Shared types and interfaces for the Hr Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Public RPC interface for Hr Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Hr } from '@repo/hr'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Hr>(env.HR, 'my-id')
 * const result = await stub.exampleMethod('hello')
 * ```
 */
export interface Hr extends DurableObject {
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
	getState(): Promise<HrState>

	/**
	 * Example method to increment a counter
	 * @returns The new counter value
	 */
	incrementCounter(): Promise<number>
}

/**
 * State structure for Hr Durable Object
 */
export interface HrState {
	counter: number
	lastUpdated: number
	metadata?: Record<string, unknown>
}

/**
 * WebSocket message types for Hr Durable Object
 */
export interface HrMessage {
	type: 'ping' | 'update' | 'subscribe' | 'unsubscribe'
	payload?: unknown
}
