/**
 * @repo/srp
 *
 * Shared types, schemas, and utilities for the SRP (Ship Replacement Program) module.
 */

import { z } from 'zod'

/**
 * ============================================================================
 * RPC INTERFACE
 * ============================================================================
 */

/**
 * Public RPC interface for SRP Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from the core worker.
 */
export interface Srp {
	// Request Management
	createRequest(
		userId: string,
		characterId: string,
		killmailId: string,
		killmailHash: string,
		contextText: string
	): Promise<SRPRequestResponse>
	withdrawRequest(
		requestId: string,
		userId: string,
		actorCharacterName: string,
		notes?: string
	): Promise<SRPRequestResponse>
	getRequest(requestId: string, userId: string): Promise<SRPRequestResponse | null>
	getUserRequests(userId: string, limit?: number, offset?: number): Promise<SRPRequestResponse[]>
	getRecentLosses(
		characterIds: string[],
		userId: string,
		daysBack?: number,
		excludeNonSrpEligible?: boolean
	): Promise<LossWithSRPStatus[]>

	// Legacy review methods (kept for backward compat)
	getPendingRequests(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<SRPRequestResponse[]>
	approveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse>
	partiallyApproveRequest(
		requestId: string,
		reviewerUserId: string,
		approvedAmount: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse>
	rejectRequest(
		requestId: string,
		reviewerUserId: string,
		rejectionReason: string,
		reviewNotes?: string
	): Promise<SRPRequestResponse>

	// Review Queue
	getRequestsByStatus(
		status: RequestStatus,
		options?: {
			limit?: number
			offset?: number
			characterName?: string
			shipTypeName?: string
			solarSystemName?: string
			dateFrom?: string
			dateTo?: string
		}
	): Promise<{ requests: SRPRequestResponse[]; total: number }>

	getSearchValues(
		status: RequestStatus,
		field: 'character' | 'ship' | 'system',
		query: string
	): Promise<Array<{ value: string }>>

	// Review Submission
	submitReview(
		requestId: string,
		reviewerUserId: string,
		reviewerCharacterName: string,
		data: SRPReviewSubmission
	): Promise<SRPRequestResponse>

	// State Change (post-review, role-validated)
	updateReviewState(
		requestId: string,
		actorUserId: string,
		actorCharacterName: string,
		newState: RequestStatus,
		notes?: string
	): Promise<SRPRequestResponse>

	// Comments
	getComments(
		requestId: string,
		userId: string,
		includeInternal: boolean
	): Promise<SRPCommentResponse[]>
	addComment(
		requestId: string,
		userId: string,
		characterName: string,
		content: string,
		visibility?: 'public' | 'internal'
	): Promise<SRPCommentResponse>
	editComment(commentId: string, userId: string, content: string): Promise<SRPCommentResponse>
	deleteComment(commentId: string, userId: string): Promise<void>

	// Payments
	getPendingPayments(
		corporationId?: string,
		limit?: number,
		offset?: number
	): Promise<SRPRequestResponse[]>
	getPendingPayoutTotal(corporationId?: string): Promise<string>
	markPaid(
		requestId: string,
		payerUserId: string,
		payerCharacterName: string
	): Promise<SRPRequestResponse>

	// Policy Management (manager-only create/update/delete; all roles can list)
	listPolicies(): Promise<SRPPolicy[]>
	createPolicy(userId: string, data: CreateSRPPolicy): Promise<SRPPolicy>
	updatePolicy(id: string, userId: string, data: Partial<CreateSRPPolicy>): Promise<SRPPolicy>
	deletePolicy(id: string, userId: string): Promise<void>

	// Configuration
	getConfig(): Promise<SRPConfigResponse | null>
	updateConfig(userId: string, updates: UpdateSRPConfig): Promise<SRPConfigResponse>

	// Payment Alerts
	listPaymentMismatchAlerts(options?: {
		includeAcknowledged?: boolean
		limit?: number
		offset?: number
	}): Promise<{ alerts: SRPPaymentMismatchAlert[]; total: number }>
	acknowledgePaymentMismatchAlert(
		alertId: string,
		actorUserId: string,
		actorCharacterName: string
	): Promise<SRPPaymentMismatchAlert>


	// Statistics
	getStats(startDate?: string, endDate?: string, corporationId?: string): Promise<SRPStatsResponse>

	// Valuation preview — computes SRP value for any killmail without creating a request
	previewValuation(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<SRPValuationPreview | null>
}

/**
 * ============================================================================
 * ENUMS AND CONSTANTS
 * ============================================================================
 */

export const REQUEST_STATUSES = [
	'pending',
	'needs_context',
	'approved',
	'payment_pending',
	'rejected',
	'paid',
	'withdrawn',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const COMMENT_VISIBILITY = ['public', 'internal'] as const
export type CommentVisibility = (typeof COMMENT_VISIBILITY)[number]

/**
 * ============================================================================
 * POLICY TYPES
 * ============================================================================
 */

/** Config shape for payout_modifier policies */
export interface PayoutModifierConfig {
	rate: string // e.g. "0.80", "1.00", "1.10"
	applyInsuranceDelta: boolean // false for logistics blanket (no insurance deduction)
}

/** Config shape for cap policies */
export interface CapConfig {
	maxPayoutMillions: number // stored as millions integer (300 = 300M, 1500 = 1.5B)
}

export type SRPPolicyConfig = PayoutModifierConfig | CapConfig

export interface SRPPolicy {
	id: string
	name: string
	description?: string
	effect: 'payout_modifier' | 'cap'
	config: SRPPolicyConfig
	isActive: boolean
	displayOrder: number
	createdBy: string
	createdAt: string
	updatedAt: string
}

/**
 * Ad-hoc modifier applied by a reviewer at review time.
 * Not predefined — the reviewer creates them inline.
 * A mandatory reason is required for each.
 */
export interface AppliedModifier {
	id: string // client-generated UUID for stable React key
	modifierType: 'deduction' | 'bonus'
	mode: 'percentage' | 'value' // percentage of current subtotal, or N × 1,000,000 ISK
	amount: number // percentage (e.g. 10 = 10%) or millions integer
	reason: string // mandatory
	computedAmountISK: string // ISK impact computed at submission time
}

/**
 * Predefined ad-hoc modifier template configured by SRP admins.
 * Used as reviewer suggestion shortcuts in the review form.
 */
export interface SRPPredefinedAdhocModifier {
	modifierType: 'deduction' | 'bonus'
	mode: 'percentage' | 'value'
	amount: number
	reason: string
}

/**
 * Input for submitReview RPC method
 */
export interface SRPReviewSubmission {
	outcome: 'approved' | 'needs_context' | 'rejected'
	appliedModifierPolicyId: string | null
	appliedCapPolicyId: string | null
	appliedModifiers: AppliedModifier[]
	reviewerOverrideMillions: number | null
	feedbackText: string | null // auto-posted as public comment if non-empty
	reviewNotes: string | null // auto-posted as internal comment if non-empty
}

/**
 * ============================================================================
 * ZOD VALIDATION SCHEMAS
 * ============================================================================
 */

/**
 * Schema for creating a new SRP request
 */
export const CreateSRPRequestSchema = z.object({
	characterId: z.string(),
	killmailId: z.string().regex(/^\d+$/, 'killmailId must be a numeric EVE killmail id'),
	killmailHash: z.string(),
	contextText: z.string().trim().min(1).max(2000),
})
export type CreateSRPRequest = z.infer<typeof CreateSRPRequestSchema>

/**
 * Schema for creating a comment
 */
export const CreateCommentSchema = z.object({
	content: z.string().min(1).max(5000),
	visibility: z.enum(['public', 'internal']).optional().default('public'),
})
export type CreateComment = z.infer<typeof CreateCommentSchema>

/**
 * Schema for editing a comment
 */
export const EditCommentSchema = z.object({
	content: z.string().min(1).max(5000),
})
export type EditComment = z.infer<typeof EditCommentSchema>

/**
 * Schema for an ad-hoc modifier
 */
export const AppliedModifierSchema = z.object({
	id: z.string().uuid(),
	modifierType: z.enum(['deduction', 'bonus']),
	mode: z.enum(['percentage', 'value']),
	amount: z.number().positive(),
	reason: z.string().min(1).max(500),
	computedAmountISK: z.string(),
})

export const PredefinedAdhocModifierSchema = z.object({
	modifierType: z.enum(['deduction', 'bonus']),
	mode: z.enum(['percentage', 'value']),
	amount: z.number().positive(),
	reason: z.string().min(1).max(500),
})

/**
 * Schema for submitting a review
 */
export const SRPReviewSubmissionSchema = z.object({
	outcome: z.enum(['approved', 'needs_context', 'rejected']),
	appliedModifierPolicyId: z.string().uuid().nullable(),
	appliedCapPolicyId: z.string().uuid().nullable(),
	appliedModifiers: z.array(AppliedModifierSchema),
	reviewerOverrideMillions: z.number().int().positive().nullable(),
	feedbackText: z.string().max(5000).nullable(),
	reviewNotes: z.string().max(5000).nullable(),
})

/**
 * Schema for changing request state
 */
export const UpdateReviewStateSchema = z.object({
	newState: z.enum([
		'pending',
		'needs_context',
		'approved',
		'payment_pending',
		'rejected',
		'paid',
	]),
	notes: z.string().max(2000).optional(),
})

export const WithdrawSRPRequestSchema = z.object({
	notes: z.string().max(2000).optional(),
})

/**
 * Schema for creating a policy
 */
export const CreateSRPPolicySchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(1000).optional(),
	effect: z.enum(['payout_modifier', 'cap']),
	config: z.record(z.string(), z.unknown()),
	displayOrder: z.number().int().optional(),
	isActive: z.boolean().optional(),
})
export type CreateSRPPolicy = z.infer<typeof CreateSRPPolicySchema>

/**
 * Schema for updating SRP configuration
 */
export const UpdateSRPConfigSchema = z.object({
	defaultCoverageRate: z.string().optional(),
	maxPayoutAmount: z.string().nullable().optional(),
	maxLossAgeDays: z.number().int().positive().optional(),
	paymentProcessorCorporationId: z.string().nullable().optional(),
	srpGroupId: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	predefinedAdhocModifiers: z.array(PredefinedAdhocModifierSchema).optional(),
})
export type UpdateSRPConfig = z.infer<typeof UpdateSRPConfigSchema>

/**
 * ============================================================================
 * RESPONSE TYPES
 * ============================================================================
 */

/**
 * SRP Request response
 */
export interface SRPRequestResponse {
	id: string
	userId: string
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string

	killmailHash: string
	killmailUrl: string // Generated: https://zkillboard.com/kill/{id}/
	lossDate: string

	shipTypeId: string
	shipTypeName: string
	shipValue: string // ISK as text
	solarSystemId?: string
	solarSystemName?: string

	contextText?: string
	requestStatus: RequestStatus

	approvedAmount?: string
	reviewerId?: string
	reviewerCharacterName?: string
	reviewedAt?: string
	reviewNotes?: string // Only visible to reviewers

	paymentDate?: string
	paymentCharacterName?: string

	// Applied policy tracking (set at review time)
	appliedModifierPolicyId?: string
	appliedModifierPolicyName?: string
	appliedCapPolicyId?: string
	appliedCapPolicyName?: string
	appliedModifiers?: AppliedModifier[]
	reviewerOverrideMillions?: number
	fleetId?: string

	// SRP Valuation — computed at request creation from Jita market prices at loss time.
	// Null for requests created before this feature was deployed.
	srpEquipmentValue?: string
	srpInsurancePremium?: string
	srpInsurancePayout?: string
	srpNetInsurance?: string
	srpCalculatedValue?: string
	srpFinalValue?: string
	srpPriceSnapshotTime?: string
	srpItemPrices?: Array<{
		typeId: string
		typeName: string
		quantity: number
		unitPrice: string
		lineTotal: string
		isConsumable?: boolean
	}>
	killmailItems?: Array<{
		item_type_id: number
		flag: number
		quantity_destroyed?: number
		quantity_dropped?: number
	}>
	shipSlotCapacities?: Partial<{
		high: number
		mid: number
		low: number
		rig: number
		sub: number
		implant: number
	}>

	createdAt: string
	updatedAt: string

	/** Character role relative to user main character — populated by HTTP layer */
	characterRole?: 'main' | 'alt'
	/** User's main character metadata for hovercard display — populated by HTTP layer */
	mainCharacterId?: string
	mainCharacterName?: string

	// Populated relations
	comments?: SRPCommentResponse[]
	history?: SRPHistoryResponse[]
}

/**
 * SRP Comment response
 */
export interface SRPCommentResponse {
	id: string
	requestId: string
	authorUserId: string
	authorCharacterName: string
	/** Primary character ID — populated by the HTTP layer for avatar rendering */
	authorCharacterId?: string
	/** Author main character metadata — populated by the HTTP layer for role hovercard */
	authorMainCharacterId?: string
	authorMainCharacterName?: string
	/** Author character role relative to their main character — populated by the HTTP layer */
	authorCharacterRole?: 'main' | 'alt'
	/** Commenter's role relative to this request — populated by the HTTP layer */
	authorRole?: 'requestor' | 'staff'
	content: string
	visibility: CommentVisibility
	isEdited: boolean
	editedAt?: string
	createdAt: string
}

/**
 * SRP History response
 */
export interface SRPHistoryResponse {
	id: string
	requestId: string
	actorUserId: string
	actorCharacterName: string
	action: string
	previousRequestStatus?: RequestStatus
	newRequestStatus?: RequestStatus
	previousApprovedAmount?: string
	newApprovedAmount?: string
	metadata?: Record<string, unknown>
	visibility: CommentVisibility
	timestamp: string
}

/**
 * SRP Configuration response
 */
export interface SRPConfigResponse {
	id: string
	isActive: boolean
	defaultCoverageRate: string
	maxPayoutAmount?: string
	maxLossAgeDays: number
	paymentProcessorCorporationId?: string
	srpGroupId?: string
	metadata?: Record<string, unknown>
	predefinedAdhocModifiers?: SRPPredefinedAdhocModifier[]
	createdBy: string
	effectiveFrom: string
	effectiveTo?: string
	createdAt: string
}

export interface SRPPaymentMismatchAlert {
	id: string
	requestId: string
	kind: 'payment_mismatch'
	state: 'open' | 'acknowledged'
	journalId: string
	expectedAmount: string
	observedAmount: string
	expectedRecipientCharacterId: string
	expectedRecipientCharacterName?: string
	actualRecipientCharacterId?: string
	actualRecipientCharacterName?: string
	actualPayerId?: string
	actualPayerName?: string
	reason?: string
	paymentProcessorCorporationId?: string
	metadata?: Record<string, unknown>
	detectedAt: string
	lastSeenAt: string
	acknowledgedAt?: string
	acknowledgedByUserId?: string
	acknowledgedByCharacterName?: string
}

/**
 * SRP Statistics response
 */
export interface SRPStatsResponse {
	totalRequests: number
	totalRequestsByStatus: Record<RequestStatus, number>
	totalIskApproved: string
	totalIskPaid: string
	averageApprovalTime: number // milliseconds
	topShipTypes: Array<{ shipTypeId: string; shipTypeName: string; count: number }>
	requestsByCorporation: Array<{ corporationId: string; corporationName: string; count: number }>
}

/**
 * Valuation preview — returned by previewValuation() without creating a request.
 * Null when the killmail has no equipped items to price.
 */
export interface SRPValuationPreview {
	equipmentValue: string
	insurancePremium: string | null
	insurancePayout: string | null
	netInsurance: string
	calculatedValue: string
	finalValue: string
	priceSnapshotTime: string | null
	/** Whether item prices came from stored daily history or live ESI cache fallback. */
	pricingSource: 'historic' | 'fallback'
	/** Whether insurance prices came from stored daily history or live ESI cache fallback. Absent for pod losses. */
	insuranceSource?: 'historic' | 'fallback'
	itemPrices: Array<{ typeId: string; typeName: string; quantity: number; unitPrice: string; lineTotal: string; isConsumable?: boolean }>
	/** Raw victim items from the killmail — used to render the fitting panel. */
	victimItems: Array<{
		typeId: string
		flag: number
		quantityDestroyed: number
		quantityDropped: number
	}>
	/** Resolved type names for all item and ship type IDs in this killmail. */
	itemNames: Record<string, string>
	/** Type IDs that had no market data at the loss date (priced at 0). */
	missingPriceTypeIds: string[]
}

/**
 * Loss data from eve-character-data with SRP status
 */
export interface LossWithSRPStatus {
	killmailId: string
	killmailHash: string
	killmailTime: string // ISO date string
	shipTypeId: string
	shipTypeName?: string
	totalValue: string // ISK as text
	solarSystemId: string
	solarSystemName?: string
	victimCharacterId: string // Character who lost the ship
	victimCharacterName?: string
	// SRP status
	hasSRPRequest: boolean
	srpRequestId?: string
	srpRequestStatus?: RequestStatus
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Generate a random 16-character ASCII payment token
 */
export function generatePaymentToken(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	let token = ''
	for (let i = 0; i < 16; i++) {
		token += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return token
}

/**
 * Check if a status transition is allowed for a given role.
 * Roles: 'reviewer' | 'payer' | 'manager'
 */
export function isValidStatusTransition(
	from: RequestStatus,
	to: RequestStatus,
	role: 'reviewer' | 'payer' | 'manager'
): boolean {
	// Managers can do anything
	if (role === 'manager') return from !== to

	const REVIEWER_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
		pending: ['needs_context', 'approved', 'rejected'],
		needs_context: ['pending', 'approved', 'rejected'],
		approved: ['pending', 'needs_context', 'rejected'],
		payment_pending: [],
		rejected: ['pending', 'needs_context', 'approved'],
		withdrawn: [],
	}

	const PAYER_TRANSITIONS: Partial<Record<RequestStatus, RequestStatus[]>> = {
		...REVIEWER_TRANSITIONS,
		approved: ['payment_pending', 'pending', 'needs_context', 'rejected'],
		payment_pending: ['paid', 'pending', 'needs_context', 'rejected'],
		withdrawn: [],
	}

	const allowed = role === 'payer' ? PAYER_TRANSITIONS[from] : REVIEWER_TRANSITIONS[from]
	return allowed?.includes(to) ?? false
}

/**
 * Generate zKillboard URL for a killmail
 */
export function generateKillmailUrl(killmailId: string): string {
	return `https://zkillboard.com/kill/${killmailId}/`
}

/**
 * Round an ISK value (as string integer) to the nearest 1,000,000 ISK.
 * Used as the final step in SRP payout calculation.
 * @param value ISK amount as string integer (e.g. "123456789")
 * @returns ISK rounded to nearest million (e.g. "123000000")
 */
export function roundToMillion(value: string): string {
	const n = BigInt(value)
	const million = 1_000_000n
	if (n > 0n && n < million) return String(million)
	const rounded = ((n + 500_000n) / million) * million
	return String(rounded)
}

/**
 * ============================================================================
 * TYPE GUARDS
 * ============================================================================
 */

export function isRequestStatus(value: string): value is RequestStatus {
	return (REQUEST_STATUSES as readonly string[]).includes(value)
}

export function isCommentVisibility(value: string): value is CommentVisibility {
	return (COMMENT_VISIBILITY as readonly string[]).includes(value)
}

export function isPayoutModifierConfig(config: SRPPolicyConfig): config is PayoutModifierConfig {
	return 'rate' in config && 'applyInsuranceDelta' in config
}

export function isCapConfig(config: SRPPolicyConfig): config is CapConfig {
	return 'maxPayoutMillions' in config
}
