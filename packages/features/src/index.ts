/**
 * @repo/features
 *
 * Shared types and interfaces for the Features worker.
 * This package allows other workers to interact with feature flags via RPC.
 */
import type { DurableObject } from 'cloudflare:workers'

export const MUMBLE_FEATURE_FLAG_KEY = 'mumble.enabled'

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
 * Per-user feature flag override record.
 *
 * A user feature flag layers on top of a global {@link FeatureFlag}: when a
 * user override exists it takes precedence over the flag's global value when
 * resolving whether the feature is enabled for that user.
 *
 * The parent flag's `key` is included for convenience so callers don't need to
 * resolve `featureFlagId` back to a key themselves.
 */
export interface UserFeatureFlag {
	id: string
	/** Foreign key to the parent {@link FeatureFlag}. */
	featureFlagId: string
	/** The parent flag's hierarchical key (e.g. "mumble.enabled"). */
	key: string
	/** The user this override applies to. */
	userId: string
	/** Whether the feature is enabled for this user. */
	enabled: boolean
	createdAt: Date
	updatedAt: Date
}

/**
 * Options for listing a user's feature flag overrides.
 */
export interface ListUserFlagsOptions {
	/** Only include overrides whose flag key starts with this prefix. */
	prefix?: string
	/** Only include overrides with this enabled state. */
	enabled?: boolean
}

/**
 * Options for listing the users who have an override for a given flag.
 */
export interface ListFlagUsersOptions {
	/** Only include overrides with this enabled state. */
	enabled?: boolean
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
	setFlag(
		key: string,
		value: boolean | string | number | unknown,
		options?: SetFlagOptions
	): Promise<FeatureFlag>

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

	/**
	 * Set (create or update) a per-user override for a feature flag.
	 *
	 * Idempotent: repeated calls for the same `userId`/`key` update the existing
	 * override rather than creating duplicates.
	 *
	 * @param userId - The user the override applies to
	 * @param key - The feature flag key to override
	 * @param enabled - Whether the feature is enabled for this user
	 * @returns The created or updated user feature flag override
	 * @throws Error if no feature flag exists for `key`
	 */
	setUserFlag(userId: string, key: string, enabled: boolean): Promise<UserFeatureFlag>

	/**
	 * Get a user's override for a feature flag.
	 *
	 * @param userId - The user whose override to retrieve
	 * @param key - The feature flag key
	 * @returns The user's override, or null if the flag or override does not exist
	 */
	getUserFlag(userId: string, key: string): Promise<UserFeatureFlag | null>

	/**
	 * Delete a user's override for a feature flag, reverting the user to the
	 * flag's global default.
	 *
	 * @param userId - The user whose override to delete
	 * @param key - The feature flag key
	 * @returns True if an override was deleted, false if none existed
	 */
	deleteUserFlag(userId: string, key: string): Promise<boolean>

	/**
	 * Resolve whether a feature is enabled for a specific user.
	 *
	 * Resolution precedence:
	 *  1. The user's override, if one exists.
	 *  2. Otherwise the flag's global boolean value.
	 *  3. Otherwise (unknown flag or no value) `false`.
	 *
	 * Always resolves to a boolean so callers can gate features directly.
	 *
	 * @param userId - The user to resolve the flag for
	 * @param key - The feature flag key
	 * @returns The effective enabled state for the user
	 */
	checkUserFlag(userId: string, key: string): Promise<boolean>

	/**
	 * Resolve multiple feature flags for a user in a single call.
	 *
	 * Applies the same precedence as {@link checkUserFlag} to each key. Every
	 * requested key is present in the result; unknown flags resolve to `false`.
	 *
	 * @param userId - The user to resolve the flags for
	 * @param keys - The feature flag keys to resolve
	 * @returns A map of flag key to effective enabled state
	 */
	checkUserFlags(userId: string, keys: string[]): Promise<Record<string, boolean>>

	/**
	 * List a user's feature flag overrides, ordered by flag key.
	 *
	 * @param userId - The user whose overrides to list
	 * @param options - Optional key-prefix and/or enabled-state filters
	 * @returns The user's overrides
	 */
	listUserFlags(userId: string, options?: ListUserFlagsOptions): Promise<UserFeatureFlag[]>

	/**
	 * List the users who have an override for a given feature flag, ordered by
	 * user id.
	 *
	 * @param key - The feature flag key
	 * @param options - Optional enabled-state filter
	 * @returns The overrides for the flag (empty if the flag does not exist)
	 */
	listFlagUsers(key: string, options?: ListFlagUsersOptions): Promise<UserFeatureFlag[]>
}
