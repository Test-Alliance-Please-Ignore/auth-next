import { pgTable, integer, varchar, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// OAuth Tokens
// ============================================================================

export const tokens = pgTable('evesso_tokens', {
	characterId: integer('character_id').primaryKey(),
	characterName: varchar('character_name', { length: 255 }).notNull(),
	accessToken: text('access_token').notNull(),
	refreshToken: text('refresh_token').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	scopes: text('scopes').notNull(), // Space-separated list of scopes
	proxyToken: varchar('proxy_token', { length: 64 }).unique().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
	proxyTokenIdx: uniqueIndex('evesso_tokens_proxy_idx').on(table.proxyToken),
	expiresIdx: index('evesso_tokens_expires_idx').on(table.expiresAt)
}))

// ============================================================================
// OAuth States (CSRF Protection)
// ============================================================================

export const oauthStates = pgTable('evesso_oauth_states', {
	state: varchar('state', { length: 255 }).primaryKey(),
	sessionId: varchar('session_id', { length: 64 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	expiresAt: timestamp('expires_at').notNull()
}, (table) => ({
	expiresIdx: index('evesso_oauth_states_expires_idx').on(table.expiresAt),
	sessionIdx: index('evesso_oauth_states_session_idx').on(table.sessionId)
}))

// ============================================================================
// Relations
// ============================================================================

export const tokensRelations = relations(tokens, ({ }) => ({
	// No direct relations - tokens are accessed via characterId or proxyToken
}))