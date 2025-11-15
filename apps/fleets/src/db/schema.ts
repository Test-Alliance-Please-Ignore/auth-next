import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the fleets worker
 */

/**
 * Fleet invitations table
 * Stores time-limited quick join tokens for fleet invitations
 */
export const fleetInvitations = pgTable(
	'fleet_invitations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		token: text('token').notNull().unique(),
		fleetBossId: text('fleet_boss_id').notNull(),
		fleetId: text('fleet_id').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		maxUses: integer('max_uses'),
		usesCount: integer('uses_count').default(0).notNull(),
		isActive: boolean('is_active').default(true).notNull(),
	},
	(table) => ({
		tokenIdx: index('fleet_invitations_token_idx').on(table.token),
		expiresAtIdx: index('fleet_invitations_expires_at_idx').on(table.expiresAt),
		fleetBossIdIdx: index('fleet_invitations_fleet_boss_id_idx').on(table.fleetBossId),
	})
)

/**
 * Fleet memberships table
 * Tracks who joined fleets via quick join links
 */
export const fleetMemberships = pgTable(
	'fleet_memberships',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id').notNull(),
		fleetId: text('fleet_id').notNull(),
		invitationId: uuid('invitation_id').references(() => fleetInvitations.id),
		joinedAt: timestamp('joined_at').defaultNow().notNull(),
		role: text('role').default('squad_member').notNull(),
	},
	(table) => ({
		characterIdIdx: index('fleet_memberships_character_id_idx').on(table.characterId),
		fleetIdIdx: index('fleet_memberships_fleet_id_idx').on(table.fleetId),
		invitationIdIdx: index('fleet_memberships_invitation_id_idx').on(table.invitationId),
	})
)

/**
 * Fleet state cache table
 * Caches fleet information from ESI for performance
 */
export const fleetStateCache = pgTable(
	'fleet_state_cache',
	{
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
		endedAt: timestamp('ended_at'),
		lastChecked: timestamp('last_checked').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		fleetIdIdx: index('fleet_state_cache_fleet_id_idx').on(table.fleetId),
		fleetBossIdIdx: index('fleet_state_cache_fleet_boss_id_idx').on(table.fleetBossId),
		lastCheckedIdx: index('fleet_state_cache_last_checked_idx').on(table.lastChecked),
		notFoundIdx: index('fleet_state_cache_not_found_idx').on(table.notFound),
		endedAtIdx: index('fleet_state_cache_ended_at_idx').on(table.endedAt),
	})
)

/**
 * Fleet summaries table
 * Stores historical fleet data before deletion from fleet_state_cache
 * This allows us to maintain a permanent record of past fleets
 */
export const fleetSummaries = pgTable(
	'fleet_summaries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		fleetBossId: text('fleet_boss_id').notNull(),
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at').notNull(),
		peakMemberCount: integer('peak_member_count').default(0).notNull(),
		finalMemberCount: integer('final_member_count').default(0).notNull(),
		motd: text('motd'),
		isFreeMove: boolean('is_free_move').default(false).notNull(),
		isRegistered: boolean('is_registered').default(false).notNull(),
		isVoiceEnabled: boolean('is_voice_enabled').default(false).notNull(),
		durationMinutes: integer('duration_minutes'), // Calculated: (endedAt - startedAt) in minutes
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		fleetIdIdx: index('fleet_summaries_fleet_id_idx').on(table.fleetId),
		fleetBossIdIdx: index('fleet_summaries_fleet_boss_id_idx').on(table.fleetBossId),
		startedAtIdx: index('fleet_summaries_started_at_idx').on(table.startedAt),
		endedAtIdx: index('fleet_summaries_ended_at_idx').on(table.endedAt),
		fleetBossStartedIdx: index('fleet_summaries_fleet_boss_started_idx').on(
			table.fleetBossId,
			table.startedAt
		),
	})
)

/**
 * Monitored fleet commanders table
 * Stores character IDs of fleet commanders to monitor for fleet activity
 */
export const monitoredFleetCommanders = pgTable(
	'monitored_fleet_commanders',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		characterId: text('character_id').notNull().unique(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		characterIdIdx: index('monitored_fleet_commanders_character_id_idx').on(table.characterId),
	})
)

/**
 * Fleet member history table
 * Tracks historical join/leave events for fleet members with ship and location data
 */
export const fleetMemberHistory = pgTable(
	'fleet_member_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		characterId: text('character_id').notNull(),
		eventType: text('event_type').notNull(), // 'join' or 'leave'
		shipTypeId: integer('ship_type_id').notNull(),
		solarSystemId: integer('solar_system_id').notNull(),
		stationId: integer('station_id'), // null if in space
		role: text('role').notNull(), // 'fleet_commander', 'wing_commander', 'squad_commander', 'squad_member'
		roleName: text('role_name').notNull(),
		squadId: text('squad_id').notNull(), // Changed from integer to text - values can exceed integer max
		wingId: text('wing_id').notNull(), // Changed from integer to text - values can exceed integer max
		joinedAt: timestamp('joined_at'), // When they joined (for join events)
		leftAt: timestamp('left_at'), // When they left (for leave events)
		eventTimestamp: timestamp('event_timestamp').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		// Name columns (denormalized for query performance)
		characterName: text('character_name'), // Character name (resolved from characterId)
		systemName: text('system_name'), // Solar system name (resolved from solarSystemId)
		shipTypeName: text('ship_type_name'), // Ship type name (resolved from shipTypeId)
		wingName: text('wing_name'), // Wing name (resolution to be implemented later)
		squadName: text('squad_name'), // Squad name (resolution to be implemented later)
	},
	(table) => ({
		fleetIdIdx: index('fleet_member_history_fleet_id_idx').on(table.fleetId),
		characterIdIdx: index('fleet_member_history_character_id_idx').on(table.characterId),
		eventTypeIdx: index('fleet_member_history_event_type_idx').on(table.eventType),
		eventTimestampIdx: index('fleet_member_history_event_timestamp_idx').on(table.eventTimestamp),
		fleetCharacterIdx: index('fleet_member_history_fleet_character_idx').on(
			table.fleetId,
			table.characterId
		),
	})
)

// Export schema object for Drizzle
export const schema = {
	fleetInvitations,
	fleetMemberships,
	fleetStateCache,
	fleetSummaries,
	monitoredFleetCommanders,
	fleetMemberHistory,
}
