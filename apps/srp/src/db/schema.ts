import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
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
	'pending',
	'needs_context',
	'approved',
	'payment_pending',
	'rejected',
	'paid',
	'withdrawn',
])

/**
 * Policy effect enum - What kind of policy this is
 */
export const srpPolicyEffectEnum = pgEnum('srp_policy_effect', ['payout_modifier', 'cap'])

/**
 * Comment visibility enum - Who can see the comment
 */
export const commentVisibilityEnum = pgEnum('srp_comment_visibility', [
	'public', // Visible to requestor and reviewers
	'internal', // Only visible to reviewers/admins
])

/**
 * SRP Policies table - Admin-configured payout modifier and cap policies
 */
export const srpPolicies = pgTable('srp_policies', {
	id: uuid('id').defaultRandom().primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	effect: srpPolicyEffectEnum('effect').notNull(),
	config: jsonb('config').notNull(),
	isActive: boolean('is_active').default(true).notNull(),
	displayOrder: integer('display_order').default(0).notNull(),
	createdBy: uuid('created_by').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * SRP Requests table - Main request entity
 *
 * Stores all ship replacement requests with killmail data,
 * requested amounts, and approval information.
 */
export const srpRequests = pgTable(
	'srp_requests',
	{
		id: text('id').primaryKey(),
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
		/** Killmail hash from ESI API (required for fetching killmail) */
		killmailHash: varchar('killmail_hash', { length: 255 }).notNull(),
		/** Ship type ID from killmail */
		shipTypeId: text('ship_type_id').notNull(),
		/** Ship type name (cached from universe static data) */
		shipTypeName: varchar('ship_type_name', { length: 255 }).notNull(),
		/** Total ship value from killmail (ISK as text) */
		shipValue: text('ship_value').notNull(),
		/** Solar system ID where the loss occurred */
		solarSystemId: text('solar_system_id'),
		/** Solar system name (cached from universe static data) */
		solarSystemName: varchar('solar_system_name', { length: 255 }),
		/** Context provided by the requester explaining the loss circumstances */
		contextText: text('context_text'),
		/** Amount approved by reviewer (null if not yet reviewed) */
		approvedAmount: text('approved_amount'),
		/** Current request status */
		requestStatus: requestStatusEnum('request_status').notNull().default('pending'),
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

		// -----------------------------------------------------------------------
		// SRP Valuation Fields
		// Computed at request creation time from Jita market prices at loss date.
		// All nullable — legacy requests created before this feature have no values.
		// -----------------------------------------------------------------------

		/** Sum of Jita best-sell prices for all equipped items (Low/Mid/High/Rig/Subsystem/Implant) */
		srpEquipmentValue: text('srp_equipment_value'),
		/** Platinum insurance premium ISK cost (null for pods or uninsurable ships) */
		srpInsurancePremium: text('srp_insurance_premium'),
		/** Platinum insurance payout ISK (null for pods or uninsurable ships) */
		srpInsurancePayout: text('srp_insurance_payout'),
		/** Effective insurance credit: max(0, payout - premium). 0 for pods. */
		srpNetInsurance: text('srp_net_insurance'),
		/** Pre-modifier replacement cost: max(0, equipmentValue - netInsurance) */
		srpCalculatedValue: text('srp_calculated_value'),
		/** Final payout after coverage rate, cap, and floor to nearest 1M ISK */
		srpFinalValue: text('srp_final_value'),
		/** Timestamp of the market snapshot (or daily average date) used for pricing */
		srpPriceSnapshotTime: timestamp('srp_price_snapshot_time', { withTimezone: true }),
		/** Per-item price breakdown used in the valuation */
		srpItemPrices: jsonb('srp_item_prices').$type<
			Array<{
				typeId: string
				typeName: string
				quantity: number
				unitPrice: string // ISK as text
				lineTotal: string // ISK as text
				isConsumable?: boolean // true for charges/ammo not factored into reimbursement
			}>
		>(),

		// -----------------------------------------------------------------------
		// Review / Policy Fields
		// Set at review time by the reviewer.
		// -----------------------------------------------------------------------

		/** FK to the payout modifier policy applied at review time (nullable) */
		appliedModifierPolicyId: uuid('applied_modifier_policy_id'),
		/** Snapshotted name of the modifier policy at review time (durable after policy rename/delete) */
		appliedModifierPolicyName: text('applied_modifier_policy_name'),
		/** FK to the cap policy applied at review time (nullable) */
		appliedCapPolicyId: uuid('applied_cap_policy_id'),
		/** Snapshotted name of the cap policy at review time */
		appliedCapPolicyName: text('applied_cap_policy_name'),
		/** Ad-hoc modifiers entered by the reviewer at review time */
		appliedModifiers: jsonb('applied_modifiers').$type<
			Array<{
				id: string
				modifierType: 'deduction' | 'bonus'
				mode: 'percentage' | 'value'
				amount: number
				reason: string
				computedAmountISK: string
			}>
		>(),
		/** Reviewer manual override — final approved amount = this × 1,000,000 ISK (replaces calculation) */
		reviewerOverrideMillions: integer('reviewer_override_millions'),
		/** Fleet association placeholder for future use */
		fleetId: text('fleet_id'),

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
		// Compound index for reviewer dashboard (pending requests)
		index('srp_requests_status_created_idx').on(table.requestStatus, table.createdAt.desc()),
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
		requestId: text('request_id')
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
		/** Visibility: public = visible to requestor; internal = SRP staff only */
		visibility: commentVisibilityEnum('visibility').default('public').notNull(),
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
		requestId: text('request_id')
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
 * SRP Payment Alerts table - Payment workflow anomalies requiring staff attention
 */
export const srpPaymentAlerts = pgTable(
	'srp_payment_alerts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		requestId: text('request_id')
			.notNull()
			.references(() => srpRequests.id, { onDelete: 'cascade' }),
		kind: varchar('kind', { length: 64 }).notNull().default('payment_mismatch'),
		state: varchar('state', { length: 32 }).notNull().default('open'),
		journalId: text('journal_id').notNull(),
		expectedAmount: text('expected_amount').notNull(),
		observedAmount: text('observed_amount').notNull(),
		expectedRecipientCharacterId: text('expected_recipient_character_id').notNull(),
		expectedRecipientCharacterName: varchar('expected_recipient_character_name', { length: 255 }),
		actualRecipientCharacterId: text('actual_recipient_character_id'),
		actualRecipientCharacterName: varchar('actual_recipient_character_name', { length: 255 }),
		actualPayerId: text('actual_payer_id'),
		actualPayerName: varchar('actual_payer_name', { length: 255 }),
		reason: text('reason'),
		paymentProcessorCorporationId: text('payment_processor_corporation_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
		acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
		acknowledgedByUserId: uuid('acknowledged_by_user_id'),
		acknowledgedByCharacterName: varchar('acknowledged_by_character_name', { length: 255 }),
	},
	(table) => [
		uniqueIndex('srp_payment_alerts_request_journal_observed_uq').on(
			table.requestId,
			table.journalId,
			table.observedAmount
		),
		index('srp_payment_alerts_state_detected_idx').on(table.state, table.detectedAt.desc()),
		index('srp_payment_alerts_request_state_idx').on(table.requestId, table.state),
		index('srp_payment_alerts_detected_at_idx').on(table.detectedAt.desc()),
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
		/** Maximum age of a loss (in days) eligible for SRP submission */
		maxLossAgeDays: integer('max_loss_age_days').default(60).notNull(),
		/** Additional configuration metadata */
		metadata: jsonb('metadata').$type<{
			requiresReviewNotes?: boolean
			allowPartialApproval?: boolean
			paymentInstructions?: string
			predefinedAdhocModifiers?: Array<{
				modifierType: 'deduction' | 'bonus'
				mode: 'percentage' | 'value'
				amount: number
				reason: string
			}>
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

export const srpPaymentAlertsRelations = relations(srpPaymentAlerts, ({ one }) => ({
	request: one(srpRequests, {
		fields: [srpPaymentAlerts.requestId],
		references: [srpRequests.id],
	}),
}))

/**
 * Export schema for Drizzle queries
 */
export const schema = {
	srpPolicies,
	srpRequests,
	srpRequestHistory,
	srpComments,
	srpPaymentAlerts,
	srpConfig,
	srpRequestsRelations,
	srpRequestHistoryRelations,
	srpCommentsRelations,
	srpPaymentAlertsRelations,
}
