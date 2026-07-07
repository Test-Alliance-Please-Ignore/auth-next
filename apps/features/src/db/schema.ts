import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Feature flags table
 *
 * Stores feature flags with hierarchical keys (dot notation) and extensible value types.
 * Supports boolean flags initially, with JSON storage for future string/number/object values.
 */
export const featureFlags = pgTable(
	'feature_flags',
	{
		// Primary identifier
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		// Hierarchical key (e.g., "notifications.email.sendGrid")
		key: text('key').notNull().unique(),

		// Value type for extensibility ('boolean', 'string', 'number', 'json')
		valueType: text('value_type').notNull().default('boolean'),

		// Boolean value storage
		booleanValue: boolean('boolean_value'),

		// JSON value storage for future string/number/json values
		jsonValue: jsonb('json_value'),

		// Metadata
		description: text('description'),

		// Tags for environment/context filtering (e.g., ["production", "user:123"])
		tags: jsonb('tags').$type<string[]>().default([]),

		// Timestamps for audit trail
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => ({
		// Index for tag filtering
		tagsIdx: index('feature_flags_tags_idx').using('gin', table.tags),
	})
)

export const userFeatureFlags = pgTable(
	'user_feature_flags',
	{
		// Primary identifier
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		featureFlagId: text('feature_flag_id')
			.notNull()
			.references(() => featureFlags.id),

		userId: text('user_id').notNull(),

		enabled: boolean('enabled').notNull().default(false),

		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => ({
		pk: uniqueIndex('user_feature_flags_pk').on(table.featureFlagId, table.userId),
		userIdEnabledIdx: index('user_feature_flags_user_id_enabled_idx').on(table.userId, table.enabled),
		featureFlagIdEnabledIdx: index('user_feature_flags_feature_flag_id_enabled_idx').on(
			table.featureFlagId,
			table.enabled
		),
	})
)

// Export schema object for Drizzle
export const schema = {
	featureFlags,
	userFeatureFlags,
}
