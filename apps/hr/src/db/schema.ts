import { relations, sql } from 'drizzle-orm'
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Applications table - Corporation membership applications
 *
 * Tracks all applications from users who want to join corporations.
 * Status can transition flexibly (no state machine validation).
 */
export const applications = pgTable(
	'applications',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Corporation ID the user is applying to */
		corporationId: text('corporation_id').notNull(),
		/** User who submitted the application */
		userId: uuid('user_id').notNull(),
		/** Character ID used for the application */
		characterId: text('character_id').notNull(),
		/** Character name (cached for display) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** Application text from the user */
		applicationText: text('application_text').notNull(),
		/** Status: pending, under_review, accepted, rejected, withdrawn */
		status: varchar('status', { length: 50 }).notNull().default('pending'),
		/** User who reviewed the application (HR admin) */
		reviewedBy: uuid('reviewed_by'),
		/** When the application was reviewed */
		reviewedAt: timestamp('reviewed_at'),
		/** Review notes from HR admin */
		reviewNotes: text('review_notes'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		// Composite index: corp + status + time (covers 80% of queries)
		// Used for: "show me all pending applications for my corp"
		index('idx_applications_corp_status_created').on(
			table.corporationId,
			table.status,
			table.createdAt.desc()
		),
		// User's applications
		// Used for: "show me my application history"
		index('idx_applications_user_created').on(table.userId, table.createdAt.desc()),
		// Character name search (GIN trigram) - requires pg_trgm extension
		// NOTE: GIN index not supported by Drizzle - create manually
		// Manual SQL: CREATE INDEX idx_applications_character_name_trgm ON applications
		// USING gin (character_name gin_trgm_ops);
		// For now, use a standard B-tree index:
		index('idx_applications_character_name').on(table.characterName),
		// Partial index for pending apps (hot data)
		// NOTE: Partial index not supported by Drizzle - create manually if needed
		// Manual SQL: CREATE INDEX idx_applications_corp_pending ON applications(corporation_id, created_at DESC)
		// WHERE status = 'pending';
		// For now, use the main corp_status_created index
	]
)

/**
 * Application recommendations table - Community recommendations for applicants
 *
 * Members can vouch for (or warn about) applicants.
 * One recommendation per user per application.
 */
export const applicationRecommendations = pgTable(
	'application_recommendations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Application this recommendation is for */
		applicationId: uuid('application_id').notNull(),
		/** User who wrote the recommendation */
		userId: uuid('user_id').notNull(),
		/** Character ID used to write recommendation */
		characterId: text('character_id').notNull(),
		/** Character name (cached for display) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** Recommendation text */
		recommendationText: text('recommendation_text').notNull(),
		/** Sentiment: positive, neutral, negative */
		sentiment: varchar('sentiment', { length: 20 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		// One recommendation per user per application
		unique('uniq_recommendations_app_user').on(table.applicationId, table.userId),
		// Get recommendations for application (with time ordering)
		// Used for: "show all recommendations for this application"
		index('idx_recommendations_app_created').on(table.applicationId, table.createdAt.desc()),
	]
)

/**
 * Application activity log table - Audit trail for all application actions
 *
 * Tracks every action: submission, status changes, reviews, recommendations, withdrawals.
 * Immutable log for compliance and debugging.
 */
export const applicationActivityLog = pgTable(
	'application_activity_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Application this activity is for */
		applicationId: uuid('application_id').notNull(),
		/** User who performed the action */
		userId: uuid('user_id').notNull(),
		/** Character ID used for the action */
		characterId: text('character_id').notNull(),
		/** Action type: submitted, status_changed, reviewed, recommendation_added, withdrawn */
		action: varchar('action', { length: 100 }).notNull(),
		/** Previous value (for updates) */
		previousValue: text('previous_value'),
		/** New value (for updates) */
		newValue: text('new_value'),
		/** Additional metadata (extensible) */
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		/** When the action occurred */
		timestamp: timestamp('timestamp').defaultNow().notNull(),
	},
	(table) => [
		// Application audit trail (most common query)
		// Used for: "show me the history of this application"
		index('idx_activity_log_app_timestamp').on(table.applicationId, table.timestamp.desc()),
		// Global recent activity dashboard
		// Used for: "show me the latest 50 activities across all applications"
		index('idx_activity_log_timestamp').on(table.timestamp.desc()),
	]
)

/**
 * HR notes table - Private notes on users (admin-only)
 *
 * STRICTLY ADMIN-ONLY: These notes are never visible to non-admin users.
 * Used for background checks, warnings, security concerns, etc.
 */
export const hrNotes = pgTable(
	'hr_notes',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** User this note is about */
		subjectUserId: uuid('subject_user_id').notNull(),
		/** Optional: Character this note is about */
		subjectCharacterId: text('subject_character_id'),
		/** Admin who wrote the note */
		authorId: uuid('author_id').notNull(),
		/** Character ID used by author */
		authorCharacterId: text('author_character_id'),
		/** Character name (cached for display) */
		authorCharacterName: varchar('author_character_name', { length: 255 }),
		/** Note content */
		noteText: text('note_text').notNull(),
		/** Note type: general, warning, positive, incident, background_check */
		noteType: varchar('note_type', { length: 50 }).notNull(),
		/** Priority: low, normal, high, critical */
		priority: varchar('priority', { length: 20 }).notNull().default('normal'),
		/** Additional metadata (extensible) */
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		// User notes lookup (most common query)
		// Used for: "show me all notes about this user"
		index('idx_hr_notes_subject_user_created').on(table.subjectUserId, table.createdAt.desc()),
		// Character notes lookup
		// Used for: "show me all notes about this character"
		index('idx_hr_notes_subject_char_created').on(
			table.subjectCharacterId,
			table.createdAt.desc()
		),
		// High priority notes dashboard
		// NOTE: Partial index not supported by Drizzle - create manually if needed
		// Manual SQL: CREATE INDEX idx_hr_notes_high_priority ON hr_notes(priority, created_at DESC)
		// WHERE priority IN ('high', 'critical');
		index('idx_hr_notes_priority_created').on(table.priority, table.createdAt.desc()),
	]
)

/**
 * HR roles table - HR role assignments per corporation
 *
 * Assigns HR roles (admin, reviewer, viewer) to users for specific corporations.
 * One active role per user per corporation.
 */
export const hrRoles = pgTable(
	'hr_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Corporation this role is for */
		corporationId: text('corporation_id').notNull(),
		/** User who has the role */
		userId: uuid('user_id').notNull(),
		/** Character ID used for the role */
		characterId: text('character_id').notNull(),
		/** Character name (cached for display) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** Role: hr_admin, hr_reviewer, hr_viewer */
		role: varchar('role', { length: 50 }).notNull(),
		/** Admin who granted the role */
		grantedBy: uuid('granted_by').notNull(),
		/** When the role was granted */
		grantedAt: timestamp('granted_at').defaultNow().notNull(),
		/** When the role expires (optional) */
		expiresAt: timestamp('expires_at'),
		/** Whether the role is currently active */
		isActive: boolean('is_active').notNull().default(true),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		// NOTE: Partial unique constraint (one active role per user per corp)
		// is enforced in application logic - Drizzle doesn't support partial unique constraints yet
		// Manual migration may be needed: CREATE UNIQUE INDEX uniq_hr_roles_corp_user_active
		// ON hr_roles(corporation_id, user_id) WHERE is_active = true;

		// User's active roles (authorization checks - most critical for performance)
		// Used for: "what roles does this user have?" (checked on every request)
		index('idx_hr_roles_user_active').on(table.userId, table.isActive),
		// Corporation + User index for role lookups
		index('idx_hr_roles_corp_user').on(table.corporationId, table.userId),
		// Corporation's active roles (listing all roles for a corporation)
		// Used for: "show me all HR roles for this corporation"
		// Covering index - eliminates need for table lookups and separate sort
		index('idx_hr_roles_corp_active_granted').on(
			table.corporationId,
			table.isActive,
			table.grantedAt.desc()
		),
		// Expired roles cleanup
		// NOTE: Partial index with WHERE clause not supported by Drizzle yet
		// Manual SQL: CREATE INDEX idx_hr_roles_expired ON hr_roles(expires_at)
		// WHERE is_active = true AND expires_at IS NOT NULL;
		index('idx_hr_roles_expired').on(table.expiresAt),
	]
)

/**
 * Relations (for Drizzle ORM query builder)
 * These define the relationships between tables for type-safe joins
 */
export const applicationsRelations = relations(applications, ({ many }) => ({
	recommendations: many(applicationRecommendations),
	activityLog: many(applicationActivityLog),
}))

export const recommendationsRelations = relations(applicationRecommendations, ({ one }) => ({
	application: one(applications, {
		fields: [applicationRecommendations.applicationId],
		references: [applications.id],
	}),
}))

export const activityLogRelations = relations(applicationActivityLog, ({ one }) => ({
	application: one(applications, {
		fields: [applicationActivityLog.applicationId],
		references: [applications.id],
	}),
}))

/**
 * Export schema object for Drizzle
 */
export const schema = {
	applications,
	applicationRecommendations,
	applicationActivityLog,
	hrNotes,
	hrRoles,
	applicationsRelations,
	recommendationsRelations,
	activityLogRelations,
}
