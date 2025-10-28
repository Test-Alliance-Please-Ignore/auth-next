import { and, eq, like, sql } from '@repo/db-utils'
import type { DbClient } from '@repo/db-utils'
import type {
	FeatureFlag,
	FeatureFlagValueType,
	ListFlagsOptions,
	RegisterFlagOptions,
	SetFlagOptions,
} from '@repo/features'
import { featureFlags } from '../db/schema'
import type { schema } from '../db/schema'

/**
 * Feature flag service
 *
 * Provides business logic for managing feature flags in the database.
 */
export class FeatureFlagService {
	constructor(private readonly db: DbClient<typeof schema>) {}

	/**
	 * Register a new feature flag
	 *
	 * @param key - Hierarchical key (e.g., "notifications.email.sendGrid")
	 * @param value - Initial boolean value
	 * @param options - Optional metadata (description, tags)
	 * @returns The created feature flag
	 * @throws Error if flag with same key already exists
	 */
	async registerFlag(key: string, value: boolean, options?: RegisterFlagOptions): Promise<FeatureFlag> {
		// Check if flag already exists
		const existing = await this.db.query.featureFlags.findFirst({
			where: eq(featureFlags.key, key),
		})

		if (existing) {
			throw new Error(`Feature flag with key "${key}" already exists`)
		}

		// Insert new flag
		const [inserted] = await this.db
			.insert(featureFlags)
			.values({
				key,
				valueType: 'boolean',
				booleanValue: value,
				description: options?.description ?? null,
				tags: options?.tags ?? [],
			})
			.returning()

		return this.mapToFeatureFlag(inserted)
	}

	/**
	 * Delete a feature flag by key
	 *
	 * @param key - The feature flag key to delete
	 * @returns True if deleted, false if not found
	 */
	async deleteFlag(key: string): Promise<boolean> {
		const result = await this.db.delete(featureFlags).where(eq(featureFlags.key, key)).returning()

		return result.length > 0
	}

	/**
	 * Set/update a feature flag value
	 *
	 * @param key - The feature flag key to update
	 * @param value - New value
	 * @param options - Optional value type for type changes
	 * @returns The updated feature flag
	 * @throws Error if flag not found
	 */
	async setFlag(
		key: string,
		value: boolean | string | number | unknown,
		options?: SetFlagOptions,
	): Promise<FeatureFlag> {
		// Check if flag exists
		const existing = await this.db.query.featureFlags.findFirst({
			where: eq(featureFlags.key, key),
		})

		if (!existing) {
			throw new Error(`Feature flag with key "${key}" not found`)
		}

		// Determine value type
		const valueType = options?.valueType ?? this.inferValueType(value)

		// Prepare update values based on type
		const updateValues = this.prepareValueForStorage(value, valueType)

		// Update flag
		const [updated] = await this.db
			.update(featureFlags)
			.set({
				...updateValues,
				valueType,
				updatedAt: new Date(),
			})
			.where(eq(featureFlags.key, key))
			.returning()

		return this.mapToFeatureFlag(updated)
	}

	/**
	 * Check a feature flag value
	 *
	 * @param key - The feature flag key to check
	 * @param tags - Optional tags to filter by (flag must have ALL specified tags)
	 * @returns The flag value (null if not found or tags don't match)
	 */
	async checkFlag(key: string, tags?: string[]): Promise<boolean | string | number | unknown | null> {
		const flag = await this.getFlag(key)

		if (!flag) {
			return null
		}

		// Check tag filtering if provided
		if (tags && tags.length > 0) {
			const hasAllTags = tags.every((tag) => flag.tags.includes(tag))
			if (!hasAllTags) {
				return null
			}
		}

		return this.extractValue(flag)
	}

	/**
	 * List feature flags with optional filtering
	 *
	 * @param options - Optional prefix and/or tags to filter by
	 * @returns Array of matching feature flags
	 */
	async listFlags(options?: ListFlagsOptions): Promise<FeatureFlag[]> {
		const conditions = []

		// Prefix filtering
		if (options?.prefix) {
			conditions.push(like(featureFlags.key, `${options.prefix}%`))
		}

		// Tag filtering (flag must have ALL specified tags)
		if (options?.tags && options.tags.length > 0) {
			for (const tag of options.tags) {
				conditions.push(sql`${featureFlags.tags} @> ${JSON.stringify([tag])}::jsonb`)
			}
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined

		const results = await this.db.query.featureFlags.findMany({
			where,
			orderBy: (flags, { asc }) => [asc(flags.key)],
		})

		return results.map((r) => this.mapToFeatureFlag(r))
	}

	/**
	 * Get a feature flag by key
	 *
	 * @param key - The feature flag key to retrieve
	 * @returns The feature flag or null if not found
	 */
	async getFlag(key: string): Promise<FeatureFlag | null> {
		const result = await this.db.query.featureFlags.findFirst({
			where: eq(featureFlags.key, key),
		})

		if (!result) {
			return null
		}

		return this.mapToFeatureFlag(result)
	}

	/**
	 * Infer value type from value
	 */
	private inferValueType(value: unknown): FeatureFlagValueType {
		if (typeof value === 'boolean') return 'boolean'
		if (typeof value === 'string') return 'string'
		if (typeof value === 'number') return 'number'
		return 'json'
	}

	/**
	 * Prepare value for storage based on type
	 */
	private prepareValueForStorage(
		value: unknown,
		valueType: FeatureFlagValueType,
	): { booleanValue: boolean | null; jsonValue: unknown | null } {
		if (valueType === 'boolean') {
			return { booleanValue: value as boolean, jsonValue: null }
		}

		return { booleanValue: null, jsonValue: value }
	}

	/**
	 * Extract value from feature flag record
	 */
	private extractValue(flag: FeatureFlag): boolean | string | number | unknown | null {
		if (flag.valueType === 'boolean') {
			return flag.booleanValue
		}

		return flag.jsonValue
	}

	/**
	 * Map database record to FeatureFlag interface
	 */
	private mapToFeatureFlag(record: typeof featureFlags.$inferSelect): FeatureFlag {
		return {
			id: record.id,
			key: record.key,
			valueType: record.valueType as FeatureFlagValueType,
			booleanValue: record.booleanValue,
			jsonValue: record.jsonValue,
			description: record.description,
			tags: (record.tags as string[]) ?? [],
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		}
	}
}
