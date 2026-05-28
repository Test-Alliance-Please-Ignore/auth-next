import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const pastes = pgTable(
	'pastes',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		createdByUserId: text('created_by_user_id').notNull(),
		createdByCharacterId: text('created_by_character_id'),
		createdByCharacterName: text('created_by_character_name'),
		visibility: text('visibility', { enum: ['alliance', 'public'] }).notNull().default('alliance'),
		isPasswordProtected: integer('is_password_protected').notNull().default(0),
		encryptionVersion: text('encryption_version'),
		kdf: text('kdf'),
		kdfIterations: integer('kdf_iterations'),
		kdfSalt: text('kdf_salt'),
		cipher: text('cipher'),
		cipherIv: text('cipher_iv'),
		r2Bucket: text('r2_bucket').notNull(),
		r2Key: text('r2_key').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		contentType: text('content_type').notNull().default('text/plain'),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('pastes_created_by_user_id_idx').on(table.createdByUserId),
		index('pastes_visibility_idx').on(table.visibility),
		index('pastes_expires_at_idx').on(table.expiresAt),
	]
)

export const pasteSettings = pgTable(
	'paste_settings',
	{
		id: text('id').primaryKey().default('default'),
		createRateLimitCount: integer('create_rate_limit_count').notNull().default(1),
		createRateLimitWindowMinutes: integer('create_rate_limit_window_minutes').notNull().default(1),
		maxActivePastesPerUser: integer('max_active_pastes_per_user').notNull().default(50),
		updatedByUserId: text('updated_by_user_id'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	() => []
)

export type PasteRow = typeof pastes.$inferSelect
export type NewPasteRow = typeof pastes.$inferInsert
export type PasteSettingsRow = typeof pasteSettings.$inferSelect
