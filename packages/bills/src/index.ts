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
export type EntityType = 'character' | 'corporation' | 'group'
export type LateFeeType = 'none' | 'static' | 'percentage'
export type LateFeeCompounding = 'none' | 'daily' | 'weekly' | 'monthly'
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'

/**
 * Core data types
 */

export interface Bill {
	id: string
	issuerId: string
	payerId: string
	payerType: EntityType
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
	createdAt: Date
	updatedAt: Date
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

/**
 * Extended types with relations for API responses
 */

export interface BillWithDetails extends Bill {
	template: BillTemplate | null
	schedule: BillSchedule | null
	issuerName?: string
	payerName?: string
}

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
	frequency: ScheduleFrequency
	amount: string
	startDate?: Date
}

export interface UpdateScheduleInput {
	templateId?: string
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
	issuerId?: string
	payerType?: EntityType
	dueAfter?: Date
	dueBefore?: Date
	createdAfter?: Date
	createdBefore?: Date
	templateId?: string
	scheduleId?: string
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

	/** Get a specific bill */
	getBill(userId: string, billId: string): Promise<BillWithDetails | null>

	/** List bills with filters */
	listBills(userId: string, filters?: BillFilters): Promise<BillWithDetails[]>

	/** Update a bill (draft only, issuer only) */
	updateBill(userId: string, billId: string, data: UpdateBillInput): Promise<Bill>

	/** Issue a bill (change status from draft to issued) */
	issueBill(userId: string, billId: string): Promise<Bill>

	/** Cancel a bill (issuer only) */
	cancelBill(userId: string, billId: string): Promise<Bill>

	/** Pay a bill using payment token */
	payBill(paymentToken: string): Promise<PaymentResponse>

	/** Regenerate payment token for a bill (issuer only) */
	regeneratePaymentToken(userId: string, billId: string): Promise<RegenerateTokenResponse>

	/** Delete a bill (draft only, issuer only) */
	deleteBill(userId: string, billId: string): Promise<void>

	/** Get bill statistics for a user */
	getBillStatistics(userId: string, filters?: BillFilters): Promise<BillStatistics>

	/**
	 * Bill Template Operations
	 */

	/** Create a new template */
	createTemplate(userId: string, data: CreateTemplateInput): Promise<BillTemplate>

	/** Get a specific template */
	getTemplate(userId: string, templateId: string): Promise<BillTemplateWithDetails | null>

	/** List templates owned by user */
	listTemplates(userId: string): Promise<BillTemplateWithDetails[]>

	/** Update a template (owner only) */
	updateTemplate(userId: string, templateId: string, data: UpdateTemplateInput): Promise<BillTemplate>

	/** Delete a template (owner only, no active schedules) */
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
	getSchedule(userId: string, scheduleId: string): Promise<BillScheduleWithDetails | null>

	/** List schedules owned by user */
	listSchedules(userId: string, filters?: ScheduleFilters): Promise<BillScheduleWithDetails[]>

	/** Update a schedule (owner only) */
	updateSchedule(userId: string, scheduleId: string, data: UpdateScheduleInput): Promise<BillSchedule>

	/** Pause a schedule (owner only) */
	pauseSchedule(userId: string, scheduleId: string): Promise<BillSchedule>

	/** Resume a schedule (owner only) */
	resumeSchedule(userId: string, scheduleId: string): Promise<BillSchedule>

	/** Delete a schedule (owner only) */
	deleteSchedule(userId: string, scheduleId: string): Promise<void>

	/** Get schedule execution history */
	getScheduleExecutionLogs(
		userId: string,
		scheduleId: string,
		limit?: number
	): Promise<ScheduleExecutionLog[]>

	/** Get schedule statistics for a user */
	getScheduleStatistics(userId: string): Promise<ScheduleStatistics>

	/**
	 * Internal workflow methods (called by Cloudflare Workflows)
	 */

	/** Execute a bill schedule (internal use only) */
	executeSchedule(scheduleId: string): Promise<ScheduleExecutionResult>
}
