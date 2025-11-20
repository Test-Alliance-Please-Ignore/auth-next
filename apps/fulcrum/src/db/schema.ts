import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the fulcrum worker
 */

export const characterReports = pgTable('character_reports', {
	// Primary key
	id: uuid('id').defaultRandom().primaryKey(),

	// Character information
	characterId: text('character_id').notNull(),
	characterName: text('character_name'),

	// Report status
	status: text('status').notNull(), // pending, processing, completed, failed, cancelled, expired

	// R2 storage location
	r2Bucket: text('r2_bucket'),
	r2Key: text('r2_key'),

	// Request information
	requestorUserId: text('requestor_user_id').notNull(),
	requestorCorporationId: text('requestor_corporation_id').notNull(),

	// Workflow tracking
	workflowInstanceId: text('workflow_instance_id'),

	// Timestamps
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
	expiresAt: timestamp('expires_at'),
	viewedAt: timestamp('viewed_at'),

	// Error handling
	errorMessage: text('error_message'),
})

export const schema = {
	characterReports,
}
