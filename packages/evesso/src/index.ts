/**
 * Evesso Durable Object Interface
 *
 * Handles evesso logins
 *
 * The actual implementation lives in apps/evesso/src/evesso.ts
 */

// ========== Types ==========

// Add your custom types here

// ========== Durable Object Interface ==========

/**
 * Evesso Durable Object Interface
 *
 * Handles evesso logins
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/evesso/src/evesso.ts
 */
export interface Evesso {
	/**
	 * Example method - replace with your actual methods
	 */
	exampleMethod(): Promise<string>
}
