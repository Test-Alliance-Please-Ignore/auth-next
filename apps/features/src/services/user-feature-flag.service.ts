import { and, asc, eq, inArray, like } from '@repo/db-utils'

import { featureFlags, userFeatureFlags } from '../db/schema'
import { likePrefixPattern } from './prefix'
import { resolveFlagValue, resolveFlagValues } from './resolution'

import type { DbClient } from '@repo/db-utils'
import type {
	ListFlagUsersOptions,
	ListUserFlagsOptions,
	UserFeatureFlag,
} from '@repo/features'
import type { schema } from '../db/schema'

/**
 * User feature flag service
 *
 * Provides business logic for per-user feature flag overrides. A user override
 * layers on top of a global feature flag: when resolving whether a feature is
 * enabled for a user, an override (if present) takes precedence over the flag's
 * global boolean value.
 */
export class UserFeatureFlagService {
	constructor(private readonly db: DbClient<typeof schema>) {}

	/**
	 * Set (create or update) a per-user override for a feature flag.
	 *
	 * Uses an upsert on the (featureFlagId, userId) unique index so repeated
	 * calls update the existing override rather than creating duplicates.
	 *
	 * @param userId - The user the override applies to
	 * @param key - The feature flag key to override
	 * @param enabled - Whether the feature is enabled for this user
	 * @returns The created or updated override
	 * @throws Error if no feature flag exists for `key`
	 */
	async setUserFlag(userId: string, key: string, enabled: boolean): Promise<UserFeatureFlag> {
		const flag = await this.getFlagByKey(key)
		if (!flag) {
			throw new Error(`Feature flag with key "${key}" not found`)
		}

		const [upserted] = await this.db
			.insert(userFeatureFlags)
			.values({
				featureFlagId: flag.id,
				userId,
				enabled,
			})
			.onConflictDoUpdate({
				target: [userFeatureFlags.featureFlagId, userFeatureFlags.userId],
				set: {
					enabled,
					updatedAt: new Date(),
				},
			})
			.returning()

		return this.mapToUserFeatureFlag(upserted, flag.key)
	}

	/**
	 * Get a user's override for a feature flag.
	 *
	 * @param userId - The user whose override to retrieve
	 * @param key - The feature flag key
	 * @returns The user's override, or null if the flag or override does not exist
	 */
	async getUserFlag(userId: string, key: string): Promise<UserFeatureFlag | null> {
		const flag = await this.getFlagByKey(key)
		if (!flag) {
			return null
		}

		const override = await this.db.query.userFeatureFlags.findFirst({
			where: and(
				eq(userFeatureFlags.featureFlagId, flag.id),
				eq(userFeatureFlags.userId, userId)
			),
		})

		if (!override) {
			return null
		}

		return this.mapToUserFeatureFlag(override, flag.key)
	}

	/**
	 * Delete a user's override for a feature flag, reverting the user to the
	 * flag's global default.
	 *
	 * @param userId - The user whose override to delete
	 * @param key - The feature flag key
	 * @returns True if an override was deleted, false if none existed
	 */
	async deleteUserFlag(userId: string, key: string): Promise<boolean> {
		const flag = await this.getFlagByKey(key)
		if (!flag) {
			return false
		}

		const result = await this.db
			.delete(userFeatureFlags)
			.where(
				and(
					eq(userFeatureFlags.featureFlagId, flag.id),
					eq(userFeatureFlags.userId, userId)
				)
			)
			.returning()

		return result.length > 0
	}

	/**
	 * Resolve whether a feature is enabled for a specific user.
	 *
	 * Resolution precedence: user override -> flag's global boolean value ->
	 * false (unknown flag or no value).
	 *
	 * @param userId - The user to resolve the flag for
	 * @param key - The feature flag key
	 * @returns The effective enabled state for the user
	 */
	async checkUserFlag(userId: string, key: string): Promise<boolean> {
		const flag = await this.getFlagByKey(key)
		if (!flag) {
			return false
		}

		const override = await this.db.query.userFeatureFlags.findFirst({
			where: and(
				eq(userFeatureFlags.featureFlagId, flag.id),
				eq(userFeatureFlags.userId, userId)
			),
		})

		return resolveFlagValue(override?.enabled, flag.booleanValue)
	}

	/**
	 * Resolve multiple feature flags for a user in a single round of queries.
	 *
	 * Every requested key is present in the returned map; unknown flags resolve
	 * to `false`. Applies the same precedence as {@link checkUserFlag}.
	 *
	 * @param userId - The user to resolve the flags for
	 * @param keys - The feature flag keys to resolve
	 * @returns A map of flag key to effective enabled state
	 */
	async checkUserFlags(userId: string, keys: string[]): Promise<Record<string, boolean>> {
		// De-duplicate to keep the IN clauses tight when callers pass repeats.
		const uniqueKeys = [...new Set(keys)]
		if (uniqueKeys.length === 0) {
			return {}
		}

		const flags = await this.db.query.featureFlags.findMany({
			where: inArray(featureFlags.key, uniqueKeys),
		})
		if (flags.length === 0) {
			// Every requested key references an unregistered flag -> all false.
			return resolveFlagValues(keys, [], new Map())
		}

		const overrides = await this.db.query.userFeatureFlags.findMany({
			where: and(
				eq(userFeatureFlags.userId, userId),
				inArray(
					userFeatureFlags.featureFlagId,
					flags.map((flag) => flag.id)
				)
			),
		})
		const overrideByFlagId = new Map(
			overrides.map((override) => [override.featureFlagId, override.enabled])
		)

		return resolveFlagValues(keys, flags, overrideByFlagId)
	}

	/**
	 * List a user's feature flag overrides, ordered by flag key.
	 *
	 * @param userId - The user whose overrides to list
	 * @param options - Optional key-prefix and/or enabled-state filters
	 * @returns The user's overrides
	 */
	async listUserFlags(
		userId: string,
		options?: ListUserFlagsOptions
	): Promise<UserFeatureFlag[]> {
		const conditions = [eq(userFeatureFlags.userId, userId)]

		if (options?.prefix) {
			// Escape LIKE metacharacters so the prefix matches literally
			// ("starts with"), rather than treating `_`/`%` as wildcards.
			conditions.push(like(featureFlags.key, likePrefixPattern(options.prefix)))
		}

		if (options?.enabled !== undefined) {
			conditions.push(eq(userFeatureFlags.enabled, options.enabled))
		}

		const rows = await this.db
			.select({
				id: userFeatureFlags.id,
				featureFlagId: userFeatureFlags.featureFlagId,
				key: featureFlags.key,
				userId: userFeatureFlags.userId,
				enabled: userFeatureFlags.enabled,
				createdAt: userFeatureFlags.createdAt,
				updatedAt: userFeatureFlags.updatedAt,
			})
			.from(userFeatureFlags)
			.innerJoin(featureFlags, eq(userFeatureFlags.featureFlagId, featureFlags.id))
			.where(and(...conditions))
			.orderBy(asc(featureFlags.key))

		return rows
	}

	/**
	 * List the users who have an override for a given feature flag, ordered by
	 * user id.
	 *
	 * @param key - The feature flag key
	 * @param options - Optional enabled-state filter
	 * @returns The overrides for the flag (empty if the flag does not exist)
	 */
	async listFlagUsers(key: string, options?: ListFlagUsersOptions): Promise<UserFeatureFlag[]> {
		const flag = await this.getFlagByKey(key)
		if (!flag) {
			return []
		}

		const conditions = [eq(userFeatureFlags.featureFlagId, flag.id)]

		if (options?.enabled !== undefined) {
			conditions.push(eq(userFeatureFlags.enabled, options.enabled))
		}

		const rows = await this.db.query.userFeatureFlags.findMany({
			where: and(...conditions),
			orderBy: (uff, { asc: ascOrder }) => [ascOrder(uff.userId)],
		})

		return rows.map((row) => this.mapToUserFeatureFlag(row, flag.key))
	}

	/**
	 * Look up a feature flag by its key.
	 */
	private async getFlagByKey(key: string): Promise<typeof featureFlags.$inferSelect | undefined> {
		return await this.db.query.featureFlags.findFirst({
			where: eq(featureFlags.key, key),
		})
	}

	/**
	 * Map a database record to the public UserFeatureFlag shape, enriching it
	 * with the parent flag's key.
	 */
	private mapToUserFeatureFlag(
		record: typeof userFeatureFlags.$inferSelect,
		key: string
	): UserFeatureFlag {
		return {
			id: record.id,
			featureFlagId: record.featureFlagId,
			key,
			userId: record.userId,
			enabled: record.enabled,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		}
	}
}
