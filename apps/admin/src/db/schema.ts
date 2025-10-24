import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Import core database tables that admin worker needs to access
 * Admin operations need to query and modify user/character data
 */
import {
	users,
	userCharacters,
	userSessions,
	userPreferences,
	userActivityLog,
} from '../../../core/src/db/schema'

/**
 * Admin audit log table - Tracks all administrative actions
 *
 * Stores comprehensive audit trail of all admin operations including:
 * - User deletions
 * - Character transfers
 * - Character deletions
 * - Admin viewing of sensitive data
 */
export const adminAuditLog = pgTable(
	'admin_audit_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** ID of the admin user who performed the action */
		adminUserId: uuid('admin_user_id').notNull(),
		/** Type of admin action performed */
		action: text('action').notNull(),
		/** Target user ID (if applicable) */
		targetUserId: uuid('target_user_id'),
		/** Target character ID (if applicable) */
		targetCharacterId: text('target_character_id'),
		/** Additional metadata about the operation */
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		/** When the action occurred */
		timestamp: timestamp('timestamp').defaultNow().notNull(),
		/** IP address of the admin user */
		ip: text('ip'),
		/** User agent of the admin user */
		userAgent: text('user_agent'),
	},
	(table) => [
		// Index for finding all actions by admin user
		index('admin_audit_log_admin_user_id_idx').on(table.adminUserId),
		// Index for chronological queries
		index('admin_audit_log_timestamp_idx').on(table.timestamp),
		// Index for filtering by action type and time
		index('admin_audit_log_action_timestamp_idx').on(table.action, table.timestamp),
		// Index for finding actions on specific users
		index('admin_audit_log_target_user_id_idx').on(table.targetUserId),
		// Index for finding actions on specific characters
		index('admin_audit_log_target_character_id_idx').on(table.targetCharacterId),
	]
)

/**
 * Re-export core tables for use in admin operations
 */
export { users, userCharacters, userSessions, userPreferences, userActivityLog }

/**
 * Export all tables for Drizzle migrations and queries
 */
export const schema = {
	adminAuditLog,
	users,
	userCharacters,
	userSessions,
	userPreferences,
	userActivityLog,
}
