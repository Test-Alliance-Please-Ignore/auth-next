import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Enums for SRP system
 */

/**
 * Request status enum - Overall status of the SRP request
 */
export const requestStatusEnum = pgEnum('srp_request_status', [
	'pending', // Initial state, awaiting review
	'in_review', // Being actively reviewed by an admin
	'approved', // Fully approved
	'partially_approved', // Approved but for less than requested amount
	'rejected', // Request denied
])

/**
 * Payment status enum - Whether ISK has been paid out
 */
export const paymentStatusEnum = pgEnum('srp_payment_status', [
	'n/a', // Not applicable (rejected requests)
	'pending', // Approved but not yet paid
	'paid_in_full', // Full approved amount paid
	'partial_payment', // Only part of approved amount paid
])

/**
 * Comment visibility enum - Who can see the comment
 */
export const commentVisibilityEnum = pgEnum('srp_comment_visibility', [
	'public', // Visible to requestor and reviewers
	'internal', // Only visible to reviewers/admins
])

/**
 * SRP Requests table - Main request entity
 *
 * Stores all ship replacement requests with killmail data,
 * requested amounts, and approval information.
 */
export const srpRequests = pgTable(
	'srp_requests',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** User ID who submitted the request */
		userId: uuid('user_id').notNull(),
		/** EVE character ID who lost the ship (text to avoid BigInt) */
		characterId: text('character_id').notNull(),
		/** Cached character name for display (not username) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** EVE corporation ID at time of loss */
		corporationId: text('corporation_id').notNull(),
		/** Cached corporation name for display */
		corporationName: varchar('corporation_name', { length: 255 }).notNull(),
		/** EVE killmail ID (text to avoid BigInt) */
		killmailId: text('killmail_id').notNull().unique(),
		/** Killmail hash from ESI API (required for fetching killmail) */
		killmailHash: varchar('killmail_hash', { length: 255 }).notNull(),
		/** Ship type ID from killmail */
		shipTypeId: text('ship_type_id').notNull(),
		/** Ship type name (cached from eve-static-data) */
		shipTypeName: varchar('ship_type_name', { length: 255 }).notNull(),
		/** Total ship value from killmail (ISK as text) */
		shipValue: text('ship_value').notNull(),
		/** Amount user is requesting (nullable - may not specify) */
		requestedAmount: text('requested_amount'),
		/** Amount approved by reviewer (null if not yet reviewed) */
		approvedAmount: text('approved_amount'),
		/** Current request status */
		requestStatus: requestStatusEnum('request_status').notNull().default('pending'),
		/** Current payment status */
		paymentStatus: paymentStatusEnum('payment_status').notNull().default('n/a'),
		/** 16 character random ASCII string for payment tracking */
		paymentToken: varchar('payment_token', { length: 16 }).notNull().unique(),
		/** When payment was made (null if not paid) */
		paymentDate: timestamp('payment_date', { withTimezone: true }),
		/** Character name who paid (for audit trail) */
		paymentCharacterName: varchar('payment_character_name', { length: 255 }),
		/** User ID of reviewer (null if not yet reviewed) */
		reviewerId: uuid('reviewer_id'),
		/** Character name of reviewer for display */
		reviewerCharacterName: varchar('reviewer_character_name', { length: 255 }),
		/** When the review was completed */
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		/** Admin notes about the decision (internal) */
		reviewNotes: text('review_notes'),
		/** Full killmail data from ESI (cached for performance) */
		killmailData: jsonb('killmail_data').$type<{
			killmail_time?: string
			solar_system_id?: number
			victim?: {
				ship_type_id?: number
				character_id?: number
				corporation_id?: number
				alliance_id?: number
				damage_taken?: number
				items?: Array<{
					item_type_id?: number
					quantity_destroyed?: number
					quantity_dropped?: number
					singleton?: number
					flag?: number
				}>
			}
			attackers?: Array<{
				character_id?: number
				corporation_id?: number
				alliance_id?: number
				ship_type_id?: number
				weapon_type_id?: number
				damage_done?: number
				final_blow?: boolean
			}>
			zkb?: {
				locationID?: number
				hash?: string
				fittedValue?: number
				droppedValue?: number
				destroyedValue?: number
				totalValue?: number
				points?: number
				npc?: boolean
				solo?: boolean
				awox?: boolean
			}
			[key: string]: unknown
		}>(),
		/** When the loss occurred (from killmail) */
		lossDate: timestamp('loss_date', { withTimezone: true }).notNull(),
		/** When the request was submitted */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		/** Last update timestamp */
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Primary query patterns - find requests by user/character
		index('srp_requests_user_id_idx').on(table.userId),
		index('srp_requests_character_id_idx').on(table.characterId),
		index('srp_requests_corporation_id_idx').on(table.corporationId),
		// Status-based queries for reviewers
		index('srp_requests_request_status_idx').on(table.requestStatus),
		index('srp_requests_payment_status_idx').on(table.paymentStatus),
		// Compound index for reviewer dashboard (pending requests)
		index('srp_requests_status_created_idx').on(table.requestStatus, table.createdAt.desc()),
		// Payment tracking
		index('srp_requests_payment_token_idx').on(table.paymentToken),
		// Killmail lookup
		index('srp_requests_killmail_id_idx').on(table.killmailId),
		// Time-based queries
		index('srp_requests_loss_date_idx').on(table.lossDate.desc()),
		index('srp_requests_created_at_idx').on(table.createdAt.desc()),
		// Reviewer queries
		index('srp_requests_reviewer_id_idx').on(table.reviewerId),
	]
)

/**
 * SRP Request History table - Audit trail for status changes
 *
 * Immutable log of all status changes and updates to requests.
 * Tracks who made changes, what changed, and when.
 */
export const srpRequestHistory = pgTable(
	'srp_request_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which request this history entry belongs to */
		requestId: uuid('request_id')
			.notNull()
			.references(() => srpRequests.id, { onDelete: 'cascade' }),
		/** User ID who made the change */
		actorUserId: uuid('actor_user_id').notNull(),
		/** Character name of actor for display (not username) */
		actorCharacterName: varchar('actor_character_name', { length: 255 }).notNull(),
		/** Type of action performed */
		action: varchar('action', { length: 100 }).notNull(),
		/** Previous request status (null for new requests) */
		previousRequestStatus: requestStatusEnum('previous_request_status'),
		/** New request status (null if status didn't change) */
		newRequestStatus: requestStatusEnum('new_request_status'),
		/** Previous payment status (null for new requests) */
		previousPaymentStatus: paymentStatusEnum('previous_payment_status'),
		/** New payment status (null if payment status didn't change) */
		newPaymentStatus: paymentStatusEnum('new_payment_status'),
		/** Previous approved amount (null if not set) */
		previousApprovedAmount: text('previous_approved_amount'),
		/** New approved amount (null if not changed) */
		newApprovedAmount: text('new_approved_amount'),
		/** Additional metadata about the change */
		metadata: jsonb('metadata').$type<{
			comment?: string
			reviewNotes?: string
			paymentCharacterName?: string
			[key: string]: unknown
		}>(),
		/** When the change occurred */
		timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Find all history for a request
		index('srp_request_history_request_id_idx').on(table.requestId, table.timestamp.desc()),
		// Find all actions by a user
		index('srp_request_history_actor_user_id_idx').on(table.actorUserId, table.timestamp.desc()),
		// Time-based queries
		index('srp_request_history_timestamp_idx').on(table.timestamp.desc()),
		// Action type queries
		index('srp_request_history_action_idx').on(table.action),
	]
)

/**
 * SRP Comments table - Conversation system
 *
 * Supports comments and conversations between requestors and reviewers.
 * Comments can be public (visible to requestor) or internal (admin-only).
 */
export const srpComments = pgTable(
	'srp_comments',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which request this comment belongs to */
		requestId: uuid('request_id')
			.notNull()
			.references(() => srpRequests.id, { onDelete: 'cascade' }),
		/** User ID of comment author */
		authorUserId: uuid('author_user_id').notNull(),
		/** Character name of author for display (not username) */
		authorCharacterName: varchar('author_character_name', { length: 255 }).notNull(),
		/** Comment content (markdown supported) */
		content: text('content').notNull(),
		/** Visibility level */
		visibility: commentVisibilityEnum('visibility').notNull().default('public'),
		/** Whether this comment was edited */
		isEdited: boolean('is_edited').default(false).notNull(),
		/** When the comment was last edited (null if never edited) */
		editedAt: timestamp('edited_at', { withTimezone: true }),
		/** Original content before edit (null if never edited) */
		originalContent: text('original_content'),
		/** When the comment was created */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Find all comments for a request (most common query)
		index('srp_comments_request_id_idx').on(table.requestId, table.createdAt),
		// Find comments by author
		index('srp_comments_author_user_id_idx').on(table.authorUserId),
		// Filter by visibility (e.g., show only public comments to requestor)
		index('srp_comments_request_visibility_idx').on(table.requestId, table.visibility),
	]
)

/**
 * SRP Configuration table - Global settings
 *
 * Stores system-wide configuration for the SRP system.
 * Only one active config should exist at a time.
 */
export const srpConfig = pgTable(
	'srp_config',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Whether this configuration is active */
		isActive: boolean('is_active').default(false).notNull(),
		/** Default SRP coverage percentage (e.g., "0.80" for 80%) */
		defaultCoverageRate: text('default_coverage_rate').notNull().default('1.0'),
		/** Maximum SRP payout per request (ISK as text, null = no limit) */
		maxPayoutAmount: text('max_payout_amount'),
		/** Minimum ship value to be eligible for SRP (ISK as text) */
		minShipValue: text('min_ship_value').notNull().default('0'),
		/** Whether to auto-approve requests under a certain value */
		autoApprovalEnabled: boolean('auto_approval_enabled').default(false).notNull(),
		/** Auto-approve if ship value is under this amount (ISK as text) */
		autoApprovalThreshold: text('auto_approval_threshold'),
		/** Array of corporation IDs eligible for SRP */
		eligibleCorporationIds: text('eligible_corporation_ids').array(),
		/** Custom rejection reasons (for dropdown) */
		rejectionReasons: jsonb('rejection_reasons').$type<string[]>().default([]),
		/** Additional configuration metadata */
		metadata: jsonb('metadata').$type<{
			requiresReviewNotes?: boolean
			allowPartialApproval?: boolean
			paymentInstructions?: string
			[key: string]: unknown
		}>(),
		/** User ID who created this configuration */
		createdBy: uuid('created_by').notNull(),
		/** When this config becomes effective */
		effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
		/** When this config stops being effective (null = ongoing) */
		effectiveTo: timestamp('effective_to', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Find active config (should only be one)
		index('srp_config_active_idx').on(table.isActive),
		index('srp_config_effective_from_idx').on(table.effectiveFrom),
	]
)

/**
 * Drizzle ORM Relations
 */

export const srpRequestsRelations = relations(srpRequests, ({ many }) => ({
	history: many(srpRequestHistory),
	comments: many(srpComments),
}))

export const srpRequestHistoryRelations = relations(srpRequestHistory, ({ one }) => ({
	request: one(srpRequests, {
		fields: [srpRequestHistory.requestId],
		references: [srpRequests.id],
	}),
}))

export const srpCommentsRelations = relations(srpComments, ({ one }) => ({
	request: one(srpRequests, {
		fields: [srpComments.requestId],
		references: [srpRequests.id],
	}),
}))

/**
 * Export schema for Drizzle queries
 */
export const schema = {
	srpRequests,
	srpRequestHistory,
	srpComments,
	srpConfig,
	srpRequestsRelations,
	srpRequestHistoryRelations,
	srpCommentsRelations,
}
