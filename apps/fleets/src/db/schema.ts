import { pgTable, text, timestamp, integer, boolean, uuid, index } from 'drizzle-orm/pg-core'

/**
 * Database schema for the fleets worker
 */

/**
 * Fleet invitations table
 * Stores time-limited quick join tokens for fleet invitations
 */
export const fleetInvitations = pgTable('fleet_invitations', {
	id: uuid('id').defaultRandom().primaryKey(),
	token: text('token').notNull().unique(),
	fleetBossId: text('fleet_boss_id').notNull(),
	fleetId: text('fleet_id').notNull(),
	expiresAt: timestamp('expires_at').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	maxUses: integer('max_uses'),
	usesCount: integer('uses_count').default(0).notNull(),
	isActive: boolean('is_active').default(true).notNull(),
}, (table) => ({
	tokenIdx: index('fleet_invitations_token_idx').on(table.token),
	expiresAtIdx: index('fleet_invitations_expires_at_idx').on(table.expiresAt),
	fleetBossIdIdx: index('fleet_invitations_fleet_boss_id_idx').on(table.fleetBossId),
}))

/**
 * Fleet memberships table
 * Tracks who joined fleets via quick join links
 */
export const fleetMemberships = pgTable('fleet_memberships', {
	id: uuid('id').defaultRandom().primaryKey(),
	characterId: text('character_id').notNull(),
	fleetId: text('fleet_id').notNull(),
	invitationId: uuid('invitation_id').references(() => fleetInvitations.id),
	joinedAt: timestamp('joined_at').defaultNow().notNull(),
	role: text('role').default('squad_member').notNull(),
}, (table) => ({
	characterIdIdx: index('fleet_memberships_character_id_idx').on(table.characterId),
	fleetIdIdx: index('fleet_memberships_fleet_id_idx').on(table.fleetId),
	invitationIdIdx: index('fleet_memberships_invitation_id_idx').on(table.invitationId),
}))

/**
 * Fleet state cache table
 * Caches fleet information from ESI for performance
 */
export const fleetStateCache = pgTable('fleet_state_cache', {
	id: uuid('id').defaultRandom().primaryKey(),
	fleetId: text('fleet_id').notNull().unique(),
	fleetBossId: text('fleet_boss_id').notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	memberCount: integer('member_count').default(0).notNull(),
	motd: text('motd'),
	isFreeMove: boolean('is_free_move').default(false).notNull(),
	isRegistered: boolean('is_registered').default(false).notNull(),
	isVoiceEnabled: boolean('is_voice_enabled').default(false).notNull(),
	notFound: boolean('not_found').default(false).notNull(),
	notFoundAt: timestamp('not_found_at'),
	lastChecked: timestamp('last_checked').defaultNow().notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
	fleetIdIdx: index('fleet_state_cache_fleet_id_idx').on(table.fleetId),
	fleetBossIdIdx: index('fleet_state_cache_fleet_boss_id_idx').on(table.fleetBossId),
	lastCheckedIdx: index('fleet_state_cache_last_checked_idx').on(table.lastChecked),
	notFoundIdx: index('fleet_state_cache_not_found_idx').on(table.notFound),
}))

// Export schema object for Drizzle
export const schema = {
	fleetInvitations,
	fleetMemberships,
	fleetStateCache,
}
