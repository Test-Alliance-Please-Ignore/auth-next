import { DurableObject } from 'cloudflare:workers'

import { createDb } from './db'
import { BillService } from './services/bill.service'
import { ScheduleService } from './services/schedule.service'
import { TemplateService } from './services/template.service'

import type {
	Bill,
	BillFilters,
	Bills,
	BillSchedule,
	BillScheduleWithDetails,
	BillStatistics,
	BillTemplate,
	BillTemplateWithDetails,
	BillWithDetails,
	CloneBillAsTemplateInput,
	CloneTemplateInput,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
	PaymentResponse,
	RegenerateTokenResponse,
	ScheduleExecutionLog,
	ScheduleExecutionResult,
	ScheduleFilters,
	ScheduleStatistics,
	UpdateBillInput,
	UpdateScheduleInput,
	UpdateTemplateInput,
} from '@repo/bills'
import type { Env } from './context'

/**
 * Bills Durable Object
 *
 * Singleton Durable Object (ID: 'default') that manages the bills system.
 * Uses PostgreSQL via Neon for persistent storage.
 *
 * IMPORTANT: This uses the singleton pattern - all instances use 'default' as the ID.
 * All RPC methods accept userId as first parameter for authorization and filtering.
 */
export class BillsDO extends DurableObject<Env> implements Bills {
	private db: ReturnType<typeof createDb>
	private billService: BillService
	private templateService: TemplateService
	private scheduleService: ScheduleService

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
		this.billService = new BillService(this.db)
		this.templateService = new TemplateService(this.db)
		this.scheduleService = new ScheduleService(this.db)
	}

	/**
	 * ============================================
	 * BILL OPERATIONS
	 * ============================================
	 */

	async createBill(userId: string, data: CreateBillInput): Promise<Bill> {
		return this.billService.createBill(userId, data)
	}

	async getBill(userId: string, billId: string): Promise<BillWithDetails | null> {
		return this.billService.getBill(userId, billId)
	}

	async listBills(userId: string, filters?: BillFilters): Promise<BillWithDetails[]> {
		return this.billService.listBills(userId, filters)
	}

	async updateBill(userId: string, billId: string, data: UpdateBillInput): Promise<Bill> {
		return this.billService.updateBill(userId, billId, data)
	}

	async issueBill(userId: string, billId: string): Promise<Bill> {
		return this.billService.issueBill(userId, billId)
	}

	async cancelBill(userId: string, billId: string): Promise<Bill> {
		return this.billService.cancelBill(userId, billId)
	}

	async payBill(paymentToken: string): Promise<PaymentResponse> {
		return this.billService.payBill(paymentToken)
	}

	async regeneratePaymentToken(userId: string, billId: string): Promise<RegenerateTokenResponse> {
		return this.billService.regeneratePaymentToken(userId, billId)
	}

	async deleteBill(userId: string, billId: string): Promise<void> {
		return this.billService.deleteBill(userId, billId)
	}

	async getBillStatistics(userId: string, filters?: BillFilters): Promise<BillStatistics> {
		return this.billService.getBillStatistics(userId, filters)
	}

	/**
	 * ============================================
	 * TEMPLATE OPERATIONS
	 * ============================================
	 */

	async createTemplate(userId: string, data: CreateTemplateInput): Promise<BillTemplate> {
		return this.templateService.createTemplate(userId, data)
	}

	async getTemplate(userId: string, templateId: string): Promise<BillTemplateWithDetails | null> {
		return this.templateService.getTemplate(userId, templateId)
	}

	async listTemplates(userId: string): Promise<BillTemplateWithDetails[]> {
		return this.templateService.listTemplates(userId)
	}

	async updateTemplate(
		userId: string,
		templateId: string,
		data: UpdateTemplateInput
	): Promise<BillTemplate> {
		return this.templateService.updateTemplate(userId, templateId, data)
	}

	async deleteTemplate(userId: string, templateId: string): Promise<void> {
		return this.templateService.deleteTemplate(userId, templateId)
	}

	async cloneTemplate(userId: string, data: CloneTemplateInput): Promise<BillTemplate> {
		return this.templateService.cloneTemplate(userId, data)
	}

	async cloneBillAsTemplate(userId: string, data: CloneBillAsTemplateInput): Promise<BillTemplate> {
		return this.templateService.cloneBillAsTemplate(userId, data)
	}

	async createBillFromTemplate(userId: string, data: CreateBillFromTemplateInput): Promise<Bill> {
		return this.templateService.createBillFromTemplate(userId, data)
	}

	/**
	 * ============================================
	 * SCHEDULE OPERATIONS
	 * ============================================
	 */

	async createSchedule(userId: string, data: CreateScheduleInput): Promise<BillSchedule> {
		return this.scheduleService.createSchedule(userId, data)
	}

	async getSchedule(userId: string, scheduleId: string): Promise<BillScheduleWithDetails | null> {
		return this.scheduleService.getSchedule(userId, scheduleId)
	}

	async listSchedules(
		userId: string,
		filters?: ScheduleFilters
	): Promise<BillScheduleWithDetails[]> {
		return this.scheduleService.listSchedules(userId, filters)
	}

	async updateSchedule(
		userId: string,
		scheduleId: string,
		data: UpdateScheduleInput
	): Promise<BillSchedule> {
		return this.scheduleService.updateSchedule(userId, scheduleId, data)
	}

	async pauseSchedule(userId: string, scheduleId: string): Promise<BillSchedule> {
		return this.scheduleService.pauseSchedule(userId, scheduleId)
	}

	async resumeSchedule(userId: string, scheduleId: string): Promise<BillSchedule> {
		return this.scheduleService.resumeSchedule(userId, scheduleId)
	}

	async deleteSchedule(userId: string, scheduleId: string): Promise<void> {
		return this.scheduleService.deleteSchedule(userId, scheduleId)
	}

	async getScheduleExecutionLogs(
		userId: string,
		scheduleId: string,
		limit?: number
	): Promise<ScheduleExecutionLog[]> {
		return this.scheduleService.getScheduleExecutionLogs(userId, scheduleId, limit)
	}

	async getScheduleStatistics(userId: string): Promise<ScheduleStatistics> {
		return this.scheduleService.getScheduleStatistics(userId)
	}

	/**
	 * ============================================
	 * INTERNAL WORKFLOW METHODS
	 * ============================================
	 */

	/**
	 * Execute a bill schedule (called by Cloudflare Workflows)
	 *
	 * This method is called by the BillScheduleExecutorWorkflow to generate
	 * a bill from a schedule. It does not require a userId parameter since
	 * it's an internal operation triggered by the workflow system.
	 */
	async executeSchedule(scheduleId: string): Promise<ScheduleExecutionResult> {
		try {
			// Get schedule (bypass authorization since this is internal)
			const scheduleResult = await this.db.query.billSchedules.findFirst({
				where: (billSchedules, { eq }) => eq(billSchedules.id, scheduleId),
				with: {
					template: true,
				},
			})

			if (!scheduleResult) {
				return {
					success: false,
					error: 'Schedule not found',
				}
			}

			if (!scheduleResult.isActive) {
				return {
					success: false,
					error: 'Schedule is not active',
				}
			}

			// Create bill from template
			const billData: CreateBillFromTemplateInput = {
				templateId: scheduleResult.templateId,
				payerId: scheduleResult.payerId,
				payerType: scheduleResult.payerType,
				amount: scheduleResult.amount,
			}

			const bill = await this.templateService.createBillFromTemplate(
				scheduleResult.ownerId,
				billData
			)

			// Auto-issue the bill
			await this.billService.issueBill(scheduleResult.ownerId, bill.id)

			// Update schedule after successful execution
			await this.scheduleService.updateScheduleAfterExecution(scheduleId, bill.id, true)

			return {
				success: true,
				billId: bill.id,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error'

			// Log failure
			await this.scheduleService.updateScheduleAfterExecution(scheduleId, '', false, errorMessage)

			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * HTTP fetch handler for the Durable Object
	 *
	 * Provides direct HTTP access to the DO if needed.
	 * Most interactions should use RPC methods instead.
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		return new Response('Bills Durable Object - Use RPC methods', { status: 200 })
	}
}
