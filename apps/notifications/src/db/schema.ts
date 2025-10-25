import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

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
