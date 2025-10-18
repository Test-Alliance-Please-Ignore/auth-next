import { pgTable, uuid, varchar, timestamp, boolean, text, integer, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// Users and Authentication
// ============================================================================

export const users = pgTable('core_users', {
	id: uuid('id').defaultRandom().primaryKey(),
	provider: varchar('provider', { length: 50 }),
	providerUserId: varchar('provider_user_id', { length: 255 }),
	email: varchar('email', { length: 255 }),
	name: varchar('name', { length: 255 }),
	ownerHash: varchar('owner_hash', { length: 255 }),
	isAdmin: boolean('is_admin').default(false).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	providerIdx: index('core_users_provider_idx').on(table.provider, table.providerUserId),
	emailIdx: index('core_users_email_idx').on(table.email),
	ownerHashIdx: index('core_users_owner_hash_idx').on(table.ownerHash)
}))

export const sessions = pgTable('core_sessions', {
	id: varchar('id', { length: 64 }).primaryKey(),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	userIdx: index('core_sessions_user_idx').on(table.userId),
	expiresIdx: index('core_sessions_expires_idx').on(table.expiresAt)
}))

export const oidcStates = pgTable('core_oidc_states', {
	state: varchar('state', { length: 255 }).primaryKey(),
	sessionId: varchar('session_id', { length: 64 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	expiresAt: timestamp('expires_at').notNull()
}, (table) => ({
	expiresIdx: index('core_oidc_states_expires_idx').on(table.expiresAt)
}))

// ============================================================================
// Account Linking
// ============================================================================

export const accountLinks = pgTable('core_account_links', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	legacySystem: varchar('legacy_system', { length: 50 }).notNull(),
	legacyUserId: varchar('legacy_user_id', { length: 255 }).notNull(),
	legacyUsername: varchar('legacy_username', { length: 255 }),
	superuser: boolean('superuser').default(false).notNull(),
	staff: boolean('staff').default(false).notNull(),
	active: boolean('active').default(true).notNull(),
	primaryCharacter: varchar('primary_character', { length: 255 }),
	primaryCharacterId: integer('primary_character_id'),
	groups: text('groups'), // JSON array
	linkedAt: timestamp('linked_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	userIdx: index('core_account_links_user_idx').on(table.userId),
	legacyIdx: uniqueIndex('core_account_links_legacy_idx').on(table.legacySystem, table.legacyUserId),
	// Enforce one legacy account per user
	userLegacyUnique: uniqueIndex('core_account_links_user_legacy_unique').on(table.userId, table.legacySystem)
}))

export const characterLinks = pgTable('core_character_links', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	characterId: integer('character_id').notNull(),
	characterName: varchar('character_name', { length: 255 }),
	isPrimary: boolean('is_primary').default(false).notNull(),
	linkedAt: timestamp('linked_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	userIdx: index('core_character_links_user_idx').on(table.userId),
	characterIdx: uniqueIndex('core_character_links_character_idx').on(table.characterId),
	primaryIdx: index('core_character_links_primary_idx').on(table.userId, table.isPrimary)
}))

export const providerLinks = pgTable('core_provider_links', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	provider: varchar('provider', { length: 50 }).notNull(),
	providerUserId: varchar('provider_user_id', { length: 255 }).notNull(),
	providerUsername: varchar('provider_username', { length: 255 }),
	linkedAt: timestamp('linked_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	userIdx: index('core_provider_links_user_idx').on(table.userId),
	providerIdx: uniqueIndex('core_provider_links_provider_idx').on(table.provider, table.providerUserId)
}))

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
	sessions: many(sessions),
	accountLinks: many(accountLinks),
	characterLinks: many(characterLinks),
	providerLinks: many(providerLinks)
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	})
}))

export const accountLinksRelations = relations(accountLinks, ({ one }) => ({
	user: one(users, {
		fields: [accountLinks.userId],
		references: [users.id]
	})
}))

export const characterLinksRelations = relations(characterLinks, ({ one }) => ({
	user: one(users, {
		fields: [characterLinks.userId],
		references: [users.id]
	})
}))

export const providerLinksRelations = relations(providerLinks, ({ one }) => ({
	user: one(users, {
		fields: [providerLinks.userId],
		references: [users.id]
	})
}))