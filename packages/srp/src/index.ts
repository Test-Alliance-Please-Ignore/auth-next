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
	createRequest(userId: string, characterId: string, killmailId: string, killmailHash: string, requestedAmount?: string): Promise<SRPRequestResponse>
	getRequest(requestId: string, userId: string): Promise<SRPRequestResponse | null>
	getUserRequests(userId: string, limit?: number, offset?: number): Promise<SRPRequestResponse[]>
	getRecentLosses(characterIds: string[], userId: string, daysBack?: number, excludeNonSrpEligible?: boolean): Promise<LossWithSRPStatus[]>

	// Review Management
	getPendingRequests(corporationId: string, limit?: number, offset?: number): Promise<SRPRequestResponse[]>
	approveRequest(requestId: string, reviewerUserId: string, approvedAmount: string, reviewNotes?: string): Promise<SRPRequestResponse>
	partiallyApproveRequest(requestId: string, reviewerUserId: string, approvedAmount: string, rejectionReason: string, reviewNotes?: string): Promise<SRPRequestResponse>
	rejectRequest(requestId: string, reviewerUserId: string, rejectionReason: string, reviewNotes?: string): Promise<SRPRequestResponse>

	// Comments
	getComments(requestId: string, userId: string, includeInternal: boolean): Promise<SRPCommentResponse[]>
	addComment(requestId: string, userId: string, content: string, visibility?: 'public' | 'internal'): Promise<SRPCommentResponse>
	editComment(commentId: string, userId: string, content: string): Promise<SRPCommentResponse>
	deleteComment(commentId: string, userId: string): Promise<void>

	// Payments
	getPendingPayments(corporationId?: string, limit?: number, offset?: number): Promise<SRPRequestResponse[]>
	markPaid(requestId: string, payerUserId: string, paidAmount: string, paymentToken: string): Promise<SRPRequestResponse>
	markPartiallyPaid(requestId: string, payerUserId: string, paidAmount: string, paymentToken: string, notes?: string): Promise<SRPRequestResponse>

	// Configuration
	getConfig(): Promise<SRPConfigResponse | null>
	updateConfig(userId: string, updates: UpdateSRPConfig): Promise<SRPConfigResponse>

	// Statistics
	getStats(startDate?: string, endDate?: string, corporationId?: string): Promise<SRPStatsResponse>
}

/**
 * ============================================================================
 * ENUMS AND CONSTANTS
 * ============================================================================
 */

export const REQUEST_STATUSES = [
	'pending',
	'in_review',
	'approved',
	'partially_approved',
	'rejected',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const PAYMENT_STATUSES = ['n/a', 'pending', 'paid_in_full', 'partial_payment'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const COMMENT_VISIBILITY = ['public', 'internal'] as const
export type CommentVisibility = (typeof COMMENT_VISIBILITY)[number]

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
	killmailId: z.string(),
	killmailHash: z.string(),
	requestedAmount: z.string().optional(), // ISK amount as string, optional
})
export type CreateSRPRequest = z.infer<typeof CreateSRPRequestSchema>

/**
 * Schema for approving a request
 */
export const ApproveRequestSchema = z.object({
	approvedAmount: z.string(), // ISK as string
	reviewNotes: z.string().max(2000).optional(),
})
export type ApproveRequest = z.infer<typeof ApproveRequestSchema>

/**
 * Schema for partially approving a request
 */
export const PartiallyApproveRequestSchema = z.object({
	approvedAmount: z.string(),
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})
export type PartiallyApproveRequest = z.infer<typeof PartiallyApproveRequestSchema>

/**
 * Schema for rejecting a request
 */
export const RejectRequestSchema = z.object({
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})
export type RejectRequest = z.infer<typeof RejectRequestSchema>

/**
 * Schema for marking a request as paid
 */
export const MarkPaidSchema = z.object({
	paidAmount: z.string(),
	paymentToken: z.string().length(16),
})
export type MarkPaid = z.infer<typeof MarkPaidSchema>

/**
 * Schema for marking a request as partially paid
 */
export const MarkPartiallyPaidSchema = z.object({
	paidAmount: z.string(),
	paymentToken: z.string().length(16),
	notes: z.string().max(2000).optional(),
})
export type MarkPartiallyPaid = z.infer<typeof MarkPartiallyPaidSchema>

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
 * Schema for updating SRP configuration
 */
export const UpdateSRPConfigSchema = z.object({
	defaultCoverageRate: z.string().optional(),
	maxPayoutAmount: z.string().nullable().optional(),
	minShipValue: z.string().optional(),
	autoApprovalEnabled: z.boolean().optional(),
	autoApprovalThreshold: z.string().nullable().optional(),
	eligibleCorporationIds: z.array(z.string()).optional(),
	rejectionReasons: z.array(z.string()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
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

	killmailId: string
	killmailHash: string
	killmailUrl: string // Generated: https://zkillboard.com/kill/{killmailId}/
	lossDate: string

	shipTypeId: string
	shipTypeName: string
	shipValue: string // ISK as text

	requestedAmount?: string
	requestStatus: RequestStatus

	approvedAmount?: string
	reviewerId?: string
	reviewerCharacterName?: string
	reviewedAt?: string
	reviewNotes?: string // Only visible to reviewers

	paymentStatus: PaymentStatus
	paymentToken?: string
	paymentDate?: string
	paymentCharacterName?: string

	createdAt: string
	updatedAt: string

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
	previousPaymentStatus?: PaymentStatus
	newPaymentStatus?: PaymentStatus
	previousApprovedAmount?: string
	newApprovedAmount?: string
	metadata?: Record<string, unknown>
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
	minShipValue: string
	autoApprovalEnabled: boolean
	autoApprovalThreshold?: string
	eligibleCorporationIds?: string[]
	rejectionReasons: string[]
	metadata?: Record<string, unknown>
	createdBy: string
	effectiveFrom: string
	effectiveTo?: string
	createdAt: string
}

/**
 * SRP Statistics response
 */
export interface SRPStatsResponse {
	totalRequests: number
	totalRequestsByStatus: Record<RequestStatus, number>
	totalRequestsByPaymentStatus: Record<PaymentStatus, number>
	totalIskRequested: string
	totalIskApproved: string
	totalIskPaid: string
	averageApprovalTime: number // milliseconds
	topShipTypes: Array<{ shipTypeId: string; shipTypeName: string; count: number }>
	requestsByCorporation: Array<{ corporationId: string; corporationName: string; count: number }>
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
 * @returns 16 character random string
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
 * Check if a status transition is allowed
 * @param from Current status
 * @param to New status
 * @returns True if transition is allowed
 */
export function isValidStatusTransition(
	from: RequestStatus,
	to: RequestStatus
): boolean {
	const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
		pending: ['in_review', 'approved', 'partially_approved', 'rejected'],
		in_review: ['pending', 'approved', 'partially_approved', 'rejected'],
		approved: [],
		partially_approved: [],
		rejected: [],
	}

	return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Check if a payment status transition is allowed
 * @param from Current payment status
 * @param to New payment status
 * @returns True if transition is allowed
 */
export function isValidPaymentStatusTransition(
	from: PaymentStatus,
	to: PaymentStatus
): boolean {
	const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
		'n/a': ['pending'],
		'pending': ['paid_in_full', 'partial_payment'],
		'paid_in_full': [],
		'partial_payment': ['paid_in_full'], // Can pay remainder
	}

	return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Generate zKillboard URL for a killmail
 * @param killmailId Killmail ID
 * @returns zKillboard URL
 */
export function generateKillmailUrl(killmailId: string): string {
	return `https://zkillboard.com/kill/${killmailId}/`
}

/**
 * Calculate the default payout amount based on ship value and coverage rate
 * @param shipValue Ship value as string
 * @param coverageRate Coverage rate as string (e.g., "0.80" for 80%)
 * @returns Calculated payout amount as string
 */
export function calculateDefaultPayout(shipValue: string, coverageRate: string): string {
	const value = BigInt(shipValue)
	const rate = Number.parseFloat(coverageRate)
	const payout = Number(value) * rate
	return Math.floor(payout).toString()
}

/**
 * ============================================================================
 * TYPE GUARDS
 * ============================================================================
 */

/**
 * Check if a string is a valid request status
 */
export function isRequestStatus(value: string): value is RequestStatus {
	return (REQUEST_STATUSES as readonly string[]).includes(value)
}

/**
 * Check if a string is a valid payment status
 */
export function isPaymentStatus(value: string): value is PaymentStatus {
	return (PAYMENT_STATUSES as readonly string[]).includes(value)
}

/**
 * Check if a string is a valid comment visibility
 */
export function isCommentVisibility(value: string): value is CommentVisibility {
	return (COMMENT_VISIBILITY as readonly string[]).includes(value)
}
