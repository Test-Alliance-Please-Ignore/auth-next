import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema for FleetMonitor Durable Object
 *
 * These tables are stored in the Durable Object's SQLite storage (this.state.storage)
 * and are instance-specific to each FleetMonitor DO instance.
 */

/**
 * Monitor state table
 * Stores the current state of a FleetMonitor instance (fleetId, characterId, initialization status)
 * Note: CHECK constraint (id = 1) is enforced at application level
 * The id column should always be set to 1 to ensure only one row exists
 */
export const monitorState = sqliteTable('monitor_state', {
	id: integer('id').primaryKey().notNull(),
	fleetId: text('fleet_id').notNull(),
	characterId: text('character_id').notNull(),
	isInitialized: integer('is_initialized', { mode: 'boolean' }).default(false).notNull(),
	lastChecked: text('last_checked'),
})

/**
 * Previous members snapshot table
 * Stores a snapshot of fleet members from the last check for comparison
 * Used to detect joins and leaves by comparing with current members
 */
export const previousMembers = sqliteTable('previous_members', {
	characterId: text('character_id').primaryKey(),
	shipTypeId: integer('ship_type_id').notNull(),
	solarSystemId: integer('solar_system_id').notNull(),
	stationId: integer('station_id'),
	role: text('role').notNull(),
	roleName: text('role_name').notNull(),
	squadId: integer('squad_id').notNull(),
	wingId: integer('wing_id').notNull(),
	joinTime: text('join_time').notNull(),
	lastSeen: text('last_seen').notNull(),
})

/**
 * Error tracking table
 * Tracks 404 errors over time to confirm fleet has ended
 * Used to prevent premature termination due to transient ESI issues
 */
export const errorTracking = sqliteTable('error_tracking', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	errorType: text('error_type').notNull(),
	errorMessage: text('error_message').notNull(),
	timestamp: text('timestamp').notNull(),
})

/**
 * Schema object for use with createSqliteDbClient
 */
export const sqliteSchema = {
	monitorState,
	previousMembers,
	errorTracking,
}
