import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * NOTE: Core database tables (users, userCharacters, etc.) are imported directly
 * in the service files where needed. They are NOT exported from this schema file
 * to prevent Drizzle-kit from including them in migrations.
 *
 * The core worker owns those tables and manages their migrations.
 */

/**
 * Admin operations audit log table - Tracks all administrative actions
 *
 * Stores comprehensive audit trail of all admin operations including:
 * - User deletions
 * - Character transfers
 * - Character deletions
 * - Admin viewing of sensitive data
 *
 * IMPORTANT: This is named differently from user_activity_log to avoid conflicts.
 * The core worker has user_activity_log for regular user actions.
 * This table is specifically for admin operations.
 */
export const adminOperationsLog = pgTable(
	'admin_operations_log',
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
		index('admin_operations_log_admin_user_id_idx').on(table.adminUserId),
		// Index for chronological queries
		index('admin_operations_log_timestamp_idx').on(table.timestamp),
		// Index for filtering by action type and time
		index('admin_operations_log_action_timestamp_idx').on(table.action, table.timestamp),
		// Index for finding actions on specific users
		index('admin_operations_log_target_user_id_idx').on(table.targetUserId),
		// Index for finding actions on specific characters
		index('admin_operations_log_target_character_id_idx').on(table.targetCharacterId),
	]
)
