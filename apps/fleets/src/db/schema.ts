import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
 * Fleet tracking sessions table
 *
 * The top-level entity for manual fleet tracking. One row per "Start tracking"
 * action. A session ties together a tracked fleet, the FC character, the user
 * who initiated tracking, and the resulting historical data.
 */
export const fleetTrackingSessions = pgTable(
	'fleet_tracking_sessions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Human-readable session name supplied by the starting user */
		name: text('name').notNull(),
		/** Character being tracked (the FC) */
		characterId: text('character_id').notNull(),
		/** User who clicked Start */
		startedByUserId: text('started_by_user_id').notNull(),
		/** Resolved on session start; required because the start path validates fleet boss before insert */
		fleetId: text('fleet_id'),
		/** 'active' | 'ended' */
		status: text('status').notNull().default('active'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		endedAt: timestamp('ended_at'),
		/**
		 * 'user_stopped' | 'admin_stopped' | 'fleet_disbanded'
		 * | 'character_left_fleet' | 'not_fleet_boss'
		 * | 'esi_error' | 'token_expired'
		 */
		endedReason: text('ended_reason'),
		/** User who triggered the stop (null for system-initiated ends like fleet_disbanded) */
		endedByUserId: text('ended_by_user_id'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		characterIdIdx: index('fleet_tracking_sessions_character_id_idx').on(table.characterId),
		fleetIdIdx: index('fleet_tracking_sessions_fleet_id_idx').on(table.fleetId),
		startedByUserIdIdx: index('fleet_tracking_sessions_started_by_user_id_idx').on(
			table.startedByUserId
		),
		statusIdx: index('fleet_tracking_sessions_status_idx').on(table.status),
		startedAtIdx: index('fleet_tracking_sessions_started_at_idx').on(table.startedAt),
	})
)

/**
 * Fleet tracking session lifecycle events
 *
 * Records pause/resume boundaries for a tracking session so analytics can
 * attribute FC time only to the active portions of the session timeline.
 */
export const fleetTrackingSessionEvents = pgTable(
	'fleet_tracking_session_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		trackingSessionId: uuid('tracking_session_id').references(() => fleetTrackingSessions.id, {
			onDelete: 'set null',
		}),
		previousCharacterId: text('previous_character_id'),
		characterId: text('character_id').notNull(),
		eventType: text('event_type').notNull(),
		observedAt: timestamp('observed_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		fleetIdIdx: index('fleet_tracking_session_events_fleet_id_idx').on(table.fleetId),
		trackingSessionIdIdx: index('fleet_tracking_session_events_tracking_session_id_idx').on(
			table.trackingSessionId
		),
		characterIdIdx: index('fleet_tracking_session_events_character_id_idx').on(table.characterId),
		observedAtIdx: index('fleet_tracking_session_events_observed_at_idx').on(table.observedAt),
	}),
)

/**
 * Fleet commander events table
 *
 * Audit log of commander changes observed for a tracked fleet.
 * This records the commander handoff history separately from the session row.
 */
export const fleetCommanderEvents = pgTable(
	'fleet_commander_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		trackingSessionId: uuid('tracking_session_id').references(() => fleetTrackingSessions.id, {
			onDelete: 'set null',
		}),
		previousCommanderCharacterId: text('previous_commander_character_id'),
		commanderCharacterId: text('commander_character_id').notNull(),
		eventType: text('event_type').notNull(),
		observedAt: timestamp('observed_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		fleetIdIdx: index('fleet_commander_events_fleet_id_idx').on(table.fleetId),
		trackingSessionIdIdx: index('fleet_commander_events_tracking_session_id_idx').on(
			table.trackingSessionId
		),
		commanderCharacterIdIdx: index('fleet_commander_events_commander_character_id_idx').on(
			table.commanderCharacterId
		),
		observedAtIdx: index('fleet_commander_events_observed_at_idx').on(table.observedAt),
	}),
)

/**
 * Fleet commander access anchors table
 *
 * Current and historical commander-to-fleet associations used for access checks.
 * Multiple commanders can be associated with the same fleet ID over time.
 */
export const fleetCommanderAccessAnchors = pgTable(
	'fleet_commander_access_anchors',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		trackingSessionId: uuid('tracking_session_id').references(() => fleetTrackingSessions.id, {
			onDelete: 'set null',
		}),
		commanderCharacterId: text('commander_character_id').notNull(),
		firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => ({
		fleetIdIdx: index('fleet_commander_access_anchors_fleet_id_idx').on(table.fleetId),
		fleetCommanderUniqueIdx: uniqueIndex(
			'fleet_commander_access_anchors_fleet_id_commander_character_id_unique'
		).on(table.fleetId, table.commanderCharacterId),
		trackingSessionIdIdx: index('fleet_commander_access_anchors_tracking_session_id_idx').on(
			table.trackingSessionId
		),
		commanderCharacterIdIdx: index(
			'fleet_commander_access_anchors_commander_character_id_idx'
		).on(table.commanderCharacterId),
		lastSeenAtIdx: index('fleet_commander_access_anchors_last_seen_at_idx').on(table.lastSeenAt),
	}),
)

/**
 * Fleet summaries table
 * Stores historical fleet data after a fleet session ends.
 * This allows us to maintain a permanent record of past fleets
 */
export const fleetSummaries = pgTable(
	'fleet_summaries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fleetId: text('fleet_id').notNull(),
		fleetBossId: text('fleet_boss_id').notNull(),
		/** Back-reference to the session this summary belongs to (nullable for historical rows without a session) */
		trackingSessionId: uuid('tracking_session_id').references(() => fleetTrackingSessions.id, {
			onDelete: 'set null',
		}),
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
		trackingSessionIdIdx: index('fleet_summaries_tracking_session_id_idx').on(
			table.trackingSessionId
		),
		startedAtIdx: index('fleet_summaries_started_at_idx').on(table.startedAt),
		endedAtIdx: index('fleet_summaries_ended_at_idx').on(table.endedAt),
		fleetBossStartedIdx: index('fleet_summaries_fleet_boss_started_idx').on(
			table.fleetBossId,
			table.startedAt
		),
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
		/** Corporation the character was in at the time of the event. */
		corporationId: text('corporation_id'),
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
		corporationIdIdx: index('fleet_member_history_corporation_id_idx').on(table.corporationId),
	})
)

/**
 * Fleet member ship events table
 *
 * Per-pilot ship-change timeline. One row per detected change of a member's
 * shipTypeId during a session. The row holds the location (system/station)
 * at the moment the ship was boarded; intermediate movement while in the
 * same ship is not recorded.
 *
 * `endedAt = null` means the row is still open (current ship at the time of
 * query). On ship change, leave, or session end, the open row is closed and
 * a new one inserted (if applicable).
 */
export const fleetMemberShipEvents = pgTable(
	'fleet_member_ship_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		trackingSessionId: uuid('tracking_session_id')
			.notNull()
			.references(() => fleetTrackingSessions.id, { onDelete: 'cascade' }),
		fleetId: text('fleet_id').notNull(),
		characterId: text('character_id').notNull(),
		shipTypeId: integer('ship_type_id').notNull(),
		/** Location at the moment this ship was first observed. Not updated on roaming. */
		solarSystemId: integer('solar_system_id').notNull(),
		stationId: integer('station_id'),
		startedAt: timestamp('started_at').notNull(),
		endedAt: timestamp('ended_at'),
		eventTimestamp: timestamp('event_timestamp').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		sessionCharacterStartedIdx: index('fleet_member_ship_events_session_character_started_idx').on(
			table.trackingSessionId,
			table.characterId,
			table.startedAt
		),
		fleetCharacterStartedIdx: index('fleet_member_ship_events_fleet_character_started_idx').on(
			table.fleetId,
			table.characterId,
			table.startedAt
		),
		eventTimestampIdx: index('fleet_member_ship_events_event_timestamp_idx').on(
			table.eventTimestamp
		),
		endedAtIdx: index('fleet_member_ship_events_ended_at_idx').on(table.endedAt),
	})
)

// Export schema object for Drizzle
export const schema = {
	fleetInvitations,
	fleetMemberships,
	fleetTrackingSessions,
	fleetCommanderEvents,
	fleetCommanderAccessAnchors,
	fleetSummaries,
	fleetMemberHistory,
	fleetMemberShipEvents,
}
