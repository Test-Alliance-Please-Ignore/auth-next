/**
 * @repo/features
 *
 * Shared types and interfaces for the Features worker.
 * This package allows other workers to interact with feature flags via RPC.
 */

/**
 * Value types supported by feature flags
 */
export type FeatureFlagValueType = 'boolean' | 'string' | 'number' | 'json'

/**
 * Feature flag record
 */
export interface FeatureFlag {
	id: string
	key: string
	valueType: FeatureFlagValueType
	booleanValue: boolean | null
	jsonValue: unknown | null
	description: string | null
	tags: string[]
	createdAt: Date
	updatedAt: Date
}

/**
 * Options for registering a new feature flag
 */
export interface RegisterFlagOptions {
	description?: string
	tags?: string[]
}

/**
 * Options for setting a feature flag value
 */
export interface SetFlagOptions {
	valueType?: FeatureFlagValueType
}

/**
 * Options for listing feature flags
 */
export interface ListFlagsOptions {
	prefix?: string
	tags?: string[]
}

/**
 * Public RPC interface for Features worker
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the service binding.
 *
 * @example
 * ```ts
 * import type { Features } from '@repo/features'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Features>(env.FEATURES, 'default')
 * await stub.registerFlag('notifications.email.enabled', true)
 * const isEnabled = await stub.checkFlag('notifications.email.enabled')
 * ```
 */
export interface Features extends DurableObject {
	/**
	 * Register a new feature flag
	 *
	 * @param key - Hierarchical key (e.g., "notifications.email.sendGrid")
	 * @param value - Initial value (boolean for now, extensible to other types)
	 * @param options - Optional metadata (description, tags)
	 * @returns The created feature flag
	 * @throws Error if flag with same key already exists
	 */
	registerFlag(key: string, value: boolean, options?: RegisterFlagOptions): Promise<FeatureFlag>

	/**
	 * Delete a feature flag by key
	 *
	 * @param key - The feature flag key to delete
	 * @returns True if deleted, false if not found
	 */
	deleteFlag(key: string): Promise<boolean>

	/**
	 * Set/update a feature flag value
	 *
	 * @param key - The feature flag key to update
	 * @param value - New value (type must match or valueType must be provided)
	 * @param options - Optional value type for type changes
	 * @returns The updated feature flag
	 * @throws Error if flag not found
	 */
	setFlag(key: string, value: boolean | string | number | unknown, options?: SetFlagOptions): Promise<FeatureFlag>

	/**
	 * Check a feature flag value
	 *
	 * @param key - The feature flag key to check
	 * @param tags - Optional tags to filter by (flag must have ALL specified tags)
	 * @returns The flag value (null if not found or tags don't match)
	 */
	checkFlag(key: string, tags?: string[]): Promise<boolean | string | number | unknown | null>

	/**
	 * List feature flags with optional filtering
	 *
	 * @param options - Optional prefix and/or tags to filter by
	 * @returns Array of matching feature flags
	 */
	listFlags(options?: ListFlagsOptions): Promise<FeatureFlag[]>

	/**
	 * Get a feature flag by key
	 *
	 * @param key - The feature flag key to retrieve
	 * @returns The feature flag or null if not found
	 */
	getFlag(key: string): Promise<FeatureFlag | null>
}
