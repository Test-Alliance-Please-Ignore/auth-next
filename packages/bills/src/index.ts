/**
 * @repo/bills
 *
 * Shared types and interfaces for the Bills Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * Enums matching database schema
 */

export type BillStatus = 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue'
export type BillStatusBadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive'
export type BillStatusEventType =
	| 'created'
	| 'issued'
	| 'payment_recorded'
	| 'paid'
	| 'cancelled'
	| 'overdue'
	| 'payment_token_regenerated'
export type EntityType = 'character' | 'corporation' | 'group'
export type EntitySearchType = EntityType | 'user'
export type PayeeType = 'character' | 'corporation'
export type LateFeeType = 'none' | 'static' | 'percentage'
export type LateFeeCompounding = 'none' | 'daily' | 'weekly' | 'monthly'
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'
export type BillMetadataScalar = string | number | boolean | null
export type BillMetadata = Record<string, BillMetadataScalar>

/**
 * Core data types
 */

export interface Bill {
	id: string
	issuerId: string
	payerId: string
	payerType: EntityType
	payeeId: string | null
	payeeType: PayeeType | null
	templateId: string | null
	scheduleId: string | null
	title: string
	description: string | null
	amount: string // Large ISK amounts stored as text
	lateFee: string // Calculated late fee amount
	lateFeeType: LateFeeType
	lateFeeAmount: string
	lateFeeCompounding: LateFeeCompounding
	dueDate: Date
	status: BillStatus
	paidAt: Date | null
	paymentToken: string // 32-byte secure token
	externalSourceType: string | null
	externalSourceId: string | null
	externalMetadata: BillMetadata | null
	createdAt: Date
	updatedAt: Date
}

export interface BillExternalRef {
	sourceType: string
	sourceId: string
	metadata?: BillMetadata | null
}

export interface BillStatusEvent {
	id: string
	billId: string
	eventType: BillStatusEventType
	fromStatus: BillStatus | null
	toStatus: BillStatus | null
	actorUserId: string | null
	metadata: BillMetadata | null
	createdAt: Date
}

export interface BillStatusEventPageQuery {
	billIds: string[]
	limit: number
	offset: number
}

export interface BillStatusEventPage {
	rows: BillStatusEvent[]
	rowCount: number
}

const BILL_STATUS_BADGE_VARIANT_MAP: Record<BillStatus, BillStatusBadgeVariant> = {
	draft: 'secondary',
	issued: 'default',
	paid: 'success',
	cancelled: 'warning',
	overdue: 'destructive',
}

export function getBillStatusBadgeVariant(status: BillStatus): BillStatusBadgeVariant {
	return BILL_STATUS_BADGE_VARIANT_MAP[status]
}

export interface BillTemplate {
	id: string
	ownerId: string
	name: string
	description: string | null
	amountTemplate: string // Can include placeholders like "{amount}"
	titleTemplate: string
	descriptionTemplate: string | null
	lateFeeType: LateFeeType
	lateFeeAmount: string // Amount or percentage
	lateFeeCompounding: LateFeeCompounding
	daysUntilDue: number // How many days after creation is bill due
	createdAt: Date
	updatedAt: Date
}

export interface BillSchedule {
	id: string
	ownerId: string
	templateId: string
	payerId: string
	payerType: EntityType
	payeeId: string | null
	payeeType: PayeeType | null
	frequency: ScheduleFrequency
	amount: string // Amount to use when generating bills
	nextGenerationTime: Date
	lastGenerationTime: Date | null
	isActive: boolean
	consecutiveFailures: number
	createdAt: Date
	updatedAt: Date
}

export interface ScheduleExecutionLog {
	id: string
	scheduleId: string
	generatedBillId: string | null
	executedAt: Date
	success: boolean
	errorMessage: string | null
}

export interface BillPayment {
	id: string
	billId: string
	paymentToken: string
	esiTransactionId: string
	amount: string
	paidById: string
	paidByType: EntityType
	paidByName?: string
	paidAt: Date
	createdAt: Date
}

/**
 * Extended types with relations for API responses
 */

export interface BillWithDetails extends Bill {
	template: BillTemplate | null
	schedule: BillSchedule | null
	payments?: BillPayment[]
	issuerName?: string
	payerName?: string
	payeeName?: string
}

export interface BillIntegrationView extends BillWithDetails {}

export interface BillTemplateWithDetails extends BillTemplate {
	ownerName?: string
	activeScheduleCount?: number
}

export interface BillScheduleWithDetails extends BillSchedule {
	template: BillTemplate
	ownerName?: string
	payerName?: string
	lastExecution?: ScheduleExecutionLog | null
}

/**
 * Input types for bill creation and updates
 */

export interface CreateBillInput {
	payerId: string
	payerType: EntityType
	payeeId: string
	payeeType: PayeeType
	title: string
	description?: string
	amount: string
	dueDate: Date
	lateFeeType?: LateFeeType
	lateFeeAmount?: string
	lateFeeCompounding?: LateFeeCompounding
}

export interface UpdateBillInput {
	title?: string
	description?: string
	amount?: string
	dueDate?: Date
	lateFeeType?: LateFeeType
	lateFeeAmount?: string
	lateFeeCompounding?: LateFeeCompounding
}

export interface CreateBillFromTemplateInput {
	templateId: string
	payerId: string
	payerType: EntityType
	payeeId: string
	payeeType: PayeeType
	amount: string
	templateParams?: Record<string, string>
}

/**
 * Input types for bill templates
 */

export interface CreateTemplateInput {
	name: string
	description?: string
	amountTemplate?: string
	titleTemplate: string
	descriptionTemplate?: string
	lateFeeType?: LateFeeType
	lateFeeAmount?: string
	lateFeeCompounding?: LateFeeCompounding
	daysUntilDue?: number
}

export interface UpdateTemplateInput {
	name?: string
	description?: string
	amountTemplate?: string
	titleTemplate?: string
	descriptionTemplate?: string
	lateFeeType?: LateFeeType
	lateFeeAmount?: string
	lateFeeCompounding?: LateFeeCompounding
	daysUntilDue?: number
}

export interface CloneTemplateInput {
	sourceTemplateId: string
	name: string
	description?: string
}

export interface CloneBillAsTemplateInput {
	sourceBillId: string
	name: string
	description?: string
}

/**
 * Input types for bill schedules
 */

export interface CreateScheduleInput {
	templateId: string
	payerId: string
	payerType: EntityType
	payeeId: string
	payeeType: PayeeType
	frequency: ScheduleFrequency
	amount: string
	startDate?: Date
}

export interface UpdateScheduleInput {
	templateId?: string
	payerId?: string
	payerType?: EntityType
	payeeId?: string
	payeeType?: PayeeType
	amount?: string
	frequency?: ScheduleFrequency
	isActive?: boolean
}

/**
 * Filter and query types
 */

export interface BillFilters {
	status?: BillStatus
	payerId?: string
	payeeId?: string
	issuerId?: string
	payerType?: EntityType
	payeeType?: EntityType
	dueAfter?: Date
	dueBefore?: Date
	createdAfter?: Date
	createdBefore?: Date
	templateId?: string
	scheduleId?: string
}

export type BillListSortField = 'createdAt' | 'updatedAt' | 'dueDate' | 'amount' | 'status'
export type BillListSortDirection = 'asc' | 'desc'

export interface BillListScopeEntity {
	entityId: string
	entityType: EntityType
}

export type BillListScope =
	| {
			mode: 'all'
	  }
	| {
			mode: 'my'
			issuerIds: string[]
			partyEntities: BillListScopeEntity[]
	  }

export interface BillListQuery {
	scope: BillListScope
	filters?: BillFilters
	limit: number
	offset: number
	sortBy?: BillListSortField
	sortDir?: BillListSortDirection
}

export interface BillListPage {
	rows: BillWithDetails[]
	rowCount: number
}

export type BillPartyDirection = 'payer' | 'payee' | 'any'

export interface BillPartySearchQuery {
	scope: BillListScope
	direction?: BillPartyDirection
	entityType?: EntityType
	q?: string
	limit?: number
}

export interface BillPartySearchRow {
	entityId: string
	entityType: EntityType
	usageCount: number
}

export interface ScheduleFilters {
	isActive?: boolean
	frequency?: ScheduleFrequency
	payerId?: string
	templateId?: string
}

/**
 * Response types
 */

export interface PaymentResponse {
	success: boolean
	bill: Bill
	message?: string
}

export interface RegenerateTokenResponse {
	token: string
	billId: string
}

export interface ScheduleExecutionResult {
	success: boolean
	billId?: string
	error?: string
}

export type OwnershipScope = 'owned' | 'all'

/**
 * Statistics and summary types
 */

export interface BillStatistics {
	totalBills: number
	totalAmount: string
	paidAmount: string
	overdueAmount: string
	billsByStatus: Record<BillStatus, number>
}

export interface ScheduleStatistics {
	totalSchedules: number
	activeSchedules: number
	pausedSchedules: number
	schedulesWithFailures: number
}

/**
 * Public RPC interface for Bills Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Bills } from '@repo/bills'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Bills>(env.BILLS, 'default')
 * const bill = await stub.createBill(userId, billData)
 * ```
 */
export interface Bills {
	/**
	 * Bill Operations
	 */

	/** Create a new bill */
	createBill(userId: string, data: CreateBillInput): Promise<Bill>

	/** Create a bill idempotently using an external source reference */
	createBillFromExternalSource(
		userId: string,
		externalRef: BillExternalRef,
		data: CreateBillInput
	): Promise<Bill>

	/** Get a specific bill */
	getBill(userId: string, billId: string): Promise<BillWithDetails | null>

	/** Get an integration-safe bill view without user auth filtering */
	getBillIntegrationView(billId: string): Promise<BillIntegrationView | null>

	/** List bills with filters */
	listBills(userId: string, filters?: BillFilters): Promise<BillWithDetails[]>

	/** List bills page with explicit scope + filters + sorting + pagination */
	listBillsPage(query: BillListQuery): Promise<BillListPage>

	/** Search payer/payee entities present in scoped bills */
	searchBillParties(query: BillPartySearchQuery): Promise<BillPartySearchRow[]>

	/** List bills by external source references */
	listBillsByExternalSource(sourceType: string, sourceIds: string[]): Promise<BillIntegrationView[]>

	/** Get bill status timeline events */
	getBillTimeline(billId: string): Promise<BillStatusEvent[]>

	/** Get bill status timeline events for multiple bills in one call */
	getBillTimelines(billIds: string[]): Promise<Record<string, BillStatusEvent[]>>

	/** Get bill status timeline events for a bill set with pagination */
	listBillStatusEventsPage(query: BillStatusEventPageQuery): Promise<BillStatusEventPage>

	/** Update a bill (permissions enforced by caller route; blocked when paid or any payments exist) */
	updateBill(actorUserId: string, billId: string, data: UpdateBillInput): Promise<Bill>

	/** Issue a bill (permissions enforced by caller route; draft-only transition) */
	issueBill(actorUserId: string, billId: string): Promise<Bill>

	/** Cancel a bill (permissions enforced by caller route) */
	cancelBill(actorUserId: string, billId: string): Promise<Bill>

	/** Revert a bill to draft (permissions enforced by caller route; blocked when paid or any payments exist) */
	revertBillToDraft(actorUserId: string, billId: string): Promise<Bill>

	/** Pay a bill using payment token */
	payBill(
		paymentToken: string,
		{
			amount,
			paidById,
			paidByType,
			esiTransactionId,
		}: { amount: bigint; paidById: string; paidByType: EntityType; esiTransactionId: string }
	): Promise<any>

	/** Regenerate payment token for a bill (permissions enforced by caller route) */
	regeneratePaymentToken(actorUserId: string, billId: string): Promise<RegenerateTokenResponse>

	/** Delete a bill (permissions enforced by caller route; draft-only invariant) */
	deleteBill(actorUserId: string, billId: string): Promise<void>

	/** Get bill statistics for a user */
	getBillStatistics(userId: string, filters?: BillFilters): Promise<BillStatistics>

	/**
	 * Bill Template Operations
	 */

	/** Create a new template */
	createTemplate(userId: string, data: CreateTemplateInput): Promise<BillTemplate>

	/** Get a specific template */
	getTemplate(
		userId: string,
		templateId: string,
		scope?: OwnershipScope
	): Promise<BillTemplateWithDetails | null>

	/** List templates owned by user */
	listTemplates(userId: string, scope?: OwnershipScope): Promise<BillTemplateWithDetails[]>

	/** Update a template (owner only) */
	updateTemplate(
		userId: string,
		templateId: string,
		data: UpdateTemplateInput
	): Promise<BillTemplate>

	/** Delete a template (no active schedules) */
	deleteTemplate(userId: string, templateId: string): Promise<void>

	/** Clone an existing template */
	cloneTemplate(userId: string, data: CloneTemplateInput): Promise<BillTemplate>

	/** Clone a bill as a template */
	cloneBillAsTemplate(userId: string, data: CloneBillAsTemplateInput): Promise<BillTemplate>

	/** Create a bill from a template */
	createBillFromTemplate(userId: string, data: CreateBillFromTemplateInput): Promise<Bill>

	/**
	 * Bill Schedule Operations
	 */

	/** Create a new schedule */
	createSchedule(userId: string, data: CreateScheduleInput): Promise<BillSchedule>

	/** Get a specific schedule */
	getSchedule(
		userId: string,
		scheduleId: string,
		scope?: OwnershipScope
	): Promise<BillScheduleWithDetails | null>

	/** List schedules owned by user */
	listSchedules(
		userId: string,
		filters?: ScheduleFilters,
		scope?: OwnershipScope
	): Promise<BillScheduleWithDetails[]>

	/** Update a schedule */
	updateSchedule(
		userId: string,
		scheduleId: string,
		data: UpdateScheduleInput
	): Promise<BillSchedule>

	/** Pause a schedule */
	pauseSchedule(userId: string, scheduleId: string): Promise<BillSchedule>

	/** Resume a schedule */
	resumeSchedule(userId: string, scheduleId: string): Promise<BillSchedule>

	/** Delete a schedule */
	deleteSchedule(userId: string, scheduleId: string): Promise<void>

	/** Get schedule execution history */
	getScheduleExecutionLogs(
		userId: string,
		scheduleId: string,
		limit?: number,
		scope?: OwnershipScope
	): Promise<ScheduleExecutionLog[]>

	/** Get schedule statistics for a user or all schedules when scope=all */
	getScheduleStatistics(userId: string, scope?: OwnershipScope): Promise<ScheduleStatistics>

	/**
	 * Internal workflow methods (called by Cloudflare Workflows)
	 */

	/** Execute a bill schedule (internal use only) */
	executeSchedule(scheduleId: string): Promise<ScheduleExecutionResult>
}
