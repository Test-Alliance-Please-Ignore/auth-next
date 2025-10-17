/**
 * Discord Durable Object Interface
 *
 * Auth to Discord bridge
 *
 * The actual implementation lives in apps/discord/src/discord.ts
 */

// ========== Types ==========

// Add your custom types here

// ========== Durable Object Interface ==========

/**
 * Discord Durable Object Interface
 *
 * Auth to Discord bridge
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/discord/src/discord.ts
 */
export interface Discord {
	/**
	 * Example method - replace with your actual methods
	 */
	exampleMethod(): Promise<string>
}
