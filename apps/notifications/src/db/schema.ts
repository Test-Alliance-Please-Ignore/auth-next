import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Notification delivery log
 * Tracks all notifications sent through the system for audit and debugging
 */
export const notificationLog = pgTable('notification_log', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull(),
	eventType: text('event_type').notNull(),
	payload: text('payload').notNull(), // JSON stringified notification
	sentAt: timestamp('sent_at', { mode: 'date' }).notNull().defaultNow(),
	acknowledged: boolean('acknowledged').notNull().default(false),
	acknowledgedAt: timestamp('acknowledged_at', { mode: 'date' }),
	retryCount: integer('retry_count').notNull().default(0),
	lastRetryAt: timestamp('last_retry_at', { mode: 'date' }),
})

/**
 * User notification configuration
 * Tracks user notification preferences and event counts
 */
export const userNotificationConfig = pgTable('notifications_user_config', {
	coreUserId: text('user_id').primaryKey().notNull(),
	notificationType: text('notification_type').notNull(),
	eventType: text('event_type'),
	enabled: boolean('enabled').notNull().default(true),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
	notifyCount: integer('notify_count').notNull().default(0),
	lastNotifiedAt: timestamp('last_notified_at', { mode: 'date' }),
})

/**
 * User sessions table - Session management
 *
 * Imported from core worker schema since both workers use the same database.
 * Sessions are stored in the database for revocation capability.
 * Each session has a unique token, expiration, and metadata.
 */
export const userSessions = pgTable(
	'user_sessions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id').notNull(),
		/** Unique session token (UUID) */
		sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
		/** When the session expires */
		expiresAt: timestamp('expires_at').notNull(),
		/** Session metadata (IP, user agent, etc.) */
		metadata: jsonb('metadata').$type<{
			ip?: string
			userAgent?: string
			characterId?: string
		}>(),
		/** Last activity timestamp */
		lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('user_sessions_user_id_idx').on(table.userId),
		index('user_sessions_session_token_idx').on(table.sessionToken),
		index('user_sessions_expires_at_idx').on(table.expiresAt),
	]
)

export const schema = {
	notificationLog,
	userNotificationConfig,
	userSessions,
}
