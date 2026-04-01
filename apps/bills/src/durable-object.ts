import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'

import { createDb } from './db'
import { BillService } from './services/bill.service'
import { ScheduleService } from './services/schedule.service'
import { TemplateService } from './services/template.service'

import type {
	Bill,
	BillExternalRef,
	BillFilters,
	BillIntegrationView,
	BillListPage,
	BillListQuery,
	BillPartySearchQuery,
	BillPartySearchRow,
	Bills,
	BillSchedule,
	BillScheduleWithDetails,
	BillStatistics,
	BillStatusEvent,
	BillStatusEventPage,
	BillStatusEventPageQuery,
	BillTemplate,
	BillTemplateWithDetails,
	BillWithDetails,
	CloneBillAsTemplateInput,
	CloneTemplateInput,
	CreateBillFromTemplateInput,
	CreateBillInput,
	CreateScheduleInput,
	CreateTemplateInput,
	EntityType,
	GroupBillAggregate,
	GroupBillOperationResult,
	OwnershipScope,
	RegenerateTokenResponse,
	ScheduleExecutionLog,
	ScheduleExecutionResult,
	ScheduleFilters,
	ScheduleStatistics,
	UpdateBillInput,
	UpdateScheduleInput,
	UpdateTemplateInput,
} from '@repo/bills'
import type { Groups } from '@repo/groups'
import type { Env } from './context'
import type { billPayments } from './db/schema'

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
	private readonly logger = logger.withTags({ service: 'bills-durable-object' })

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.logger.info('[BillsDO] Initializing')

		try {
			this.db = createDb(env.DATABASE_URL)
			this.logger.info('[BillsDO] Database client created')

			this.billService = new BillService(this.db)
			this.templateService = new TemplateService(this.db)
			this.scheduleService = new ScheduleService(this.db)

			this.logger.info('[BillsDO] Services initialized')
		} catch (error) {
			this.logger.error('[BillsDO] Initialization failed', {
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * ============================================
	 * BILL OPERATIONS
	 * ============================================
	 */

	async createBill(userId: string, data: CreateBillInput): Promise<Bill> {
		this.logger.info('[BillsDO] createBill called', { userId })
		try {
			const result = await this.billService.createBill(userId, data)
			this.logger.info('[BillsDO] createBill succeeded', { billId: result.id, userId })
			return result
		} catch (error) {
			this.logger.error('[BillsDO] createBill failed', {
				error: error instanceof Error ? error.message : String(error),
				userId,
			})
			throw error
		}
	}

	async createBillFromExternalSource(
		userId: string,
		externalRef: BillExternalRef,
		data: CreateBillInput
	): Promise<Bill> {
		return this.billService.createBillFromExternalSource(userId, externalRef, data)
	}

	async getBill(userId: string, billId: string): Promise<BillWithDetails | null> {
		return this.billService.getBill(userId, billId)
	}

	async getBillIntegrationView(billId: string): Promise<BillIntegrationView | null> {
		return this.billService.getBillIntegrationView(billId)
	}

	async getGroupBillAggregate(groupBillId: string): Promise<GroupBillAggregate | null> {
		return this.billService.getGroupBillAggregate(groupBillId)
	}

	async listBills(userId: string, filters?: BillFilters): Promise<BillWithDetails[]> {
		return this.billService.listBills(userId, filters)
	}

	async listBillsPage(query: BillListQuery): Promise<BillListPage> {
		try {
			return await this.billService.listBillsPage(query)
		} catch (error) {
			this.logger.error('[BillsDO] listBillsPage failed', {
				scopeMode: query.scope.mode,
				limit: query.limit,
				offset: query.offset,
				sortBy: query.sortBy,
				sortDir: query.sortDir,
				hasFilters: Boolean(query.filters),
				...toErrorLogDetails(error),
			})
			throw error
		}
	}

	async searchBillParties(query: BillPartySearchQuery): Promise<BillPartySearchRow[]> {
		return this.billService.searchBillParties(query)
	}

	async listBillsByExternalSource(
		sourceType: string,
		sourceIds: string[]
	): Promise<BillIntegrationView[]> {
		return this.billService.listBillsByExternalSource(sourceType, sourceIds)
	}

	async getBillTimeline(billId: string): Promise<BillStatusEvent[]> {
		return this.billService.getBillTimeline(billId)
	}

	async getBillTimelines(billIds: string[]): Promise<Record<string, BillStatusEvent[]>> {
		return this.billService.getBillTimelines(billIds)
	}

	async listBillStatusEventsPage(query: BillStatusEventPageQuery): Promise<BillStatusEventPage> {
		return this.billService.listBillStatusEventsPage(query)
	}

	async updateBill(actorUserId: string, billId: string, data: UpdateBillInput): Promise<Bill> {
		return this.billService.updateBill(actorUserId, billId, data)
	}

	async issueBill(actorUserId: string, billId: string): Promise<Bill> {
		return this.billService.issueBill(actorUserId, billId)
	}

	async cancelBill(actorUserId: string, billId: string): Promise<Bill> {
		return this.billService.cancelBill(actorUserId, billId)
	}

	async revertBillToDraft(actorUserId: string, billId: string): Promise<Bill> {
		return this.billService.revertBillToDraft(actorUserId, billId)
	}

	async payBill(
		paymentToken: string,
		{
			amount,
			paidById,
			paidByType,
			esiTransactionId,
		}: {
			amount: bigint
			paidById: string
			paidByType: EntityType
			esiTransactionId: string
		}
	): Promise<typeof billPayments.$inferSelect> {
		return this.billService.payBill(paymentToken, {
			amount,
			paidById,
			paidByType,
			esiTransactionId,
		})
	}

	async regeneratePaymentToken(
		actorUserId: string,
		billId: string
	): Promise<RegenerateTokenResponse> {
		return this.billService.regeneratePaymentToken(actorUserId, billId)
	}

	async deleteBill(actorUserId: string, billId: string): Promise<void> {
		return this.billService.deleteBill(actorUserId, billId)
	}

	async issueGroupBill(actorUserId: string, groupBillId: string): Promise<GroupBillOperationResult> {
		return this.billService.issueGroupBill(actorUserId, groupBillId)
	}

	async cancelGroupBill(actorUserId: string, groupBillId: string): Promise<GroupBillOperationResult> {
		return this.billService.cancelGroupBill(actorUserId, groupBillId)
	}

	async revertGroupBillToDraft(
		actorUserId: string,
		groupBillId: string
	): Promise<GroupBillOperationResult> {
		return this.billService.revertGroupBillToDraft(actorUserId, groupBillId)
	}

	async deleteGroupBill(actorUserId: string, groupBillId: string): Promise<GroupBillOperationResult> {
		return this.billService.deleteGroupBill(actorUserId, groupBillId)
	}

	async updateGroupBill(
		actorUserId: string,
		groupBillId: string,
		data: UpdateBillInput
	): Promise<GroupBillOperationResult> {
		return this.billService.updateGroupBill(actorUserId, groupBillId, data)
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

	async getTemplate(
		userId: string,
		templateId: string,
		scope: OwnershipScope = 'owned'
	): Promise<BillTemplateWithDetails | null> {
		return this.templateService.getTemplate(userId, templateId, scope)
	}

	async listTemplates(
		userId: string,
		scope: OwnershipScope = 'owned'
	): Promise<BillTemplateWithDetails[]> {
		return this.templateService.listTemplates(userId, scope)
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

	async getSchedule(
		userId: string,
		scheduleId: string,
		scope: OwnershipScope = 'owned'
	): Promise<BillScheduleWithDetails | null> {
		return this.scheduleService.getSchedule(userId, scheduleId, scope)
	}

	async listSchedules(
		userId: string,
		filters?: ScheduleFilters,
		scope: OwnershipScope = 'owned'
	): Promise<BillScheduleWithDetails[]> {
		return this.scheduleService.listSchedules(userId, filters, scope)
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
		limit?: number,
		scope: OwnershipScope = 'owned'
	): Promise<ScheduleExecutionLog[]> {
		return this.scheduleService.getScheduleExecutionLogs(userId, scheduleId, limit, scope)
	}

	async getScheduleStatistics(
		userId: string,
		scope: OwnershipScope = 'owned'
	): Promise<ScheduleStatistics> {
		return this.scheduleService.getScheduleStatistics(userId, scope)
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

			// Group schedule fan-out
			if (scheduleResult.payerType === 'group') {
				const groupBillId = crypto.randomUUID()
				const groupsStub = getStub<Groups>(this.env.GROUPS, 'default')
				const [group, members] = await Promise.all([
					groupsStub.getGroup(scheduleResult.payerId, scheduleResult.ownerId),
					groupsStub.getGroupMembers(scheduleResult.payerId, scheduleResult.ownerId),
				])

				if (!group) {
					return { success: false, error: 'Group not found' }
				}

				const mask = scheduleResult.groupBillTargetMask ?? 7
				const includeOwner = (mask & 1) !== 0
				const includeAdmins = (mask & 2) !== 0
				const includeMembers = (mask & 4) !== 0
				const adminUserIds = new Set(group.adminUserIds ?? [])
				const qualifyingMembers = members.filter((member) => {
					if (!member.mainCharacterId) return false
					const isOwner = member.userId === group.ownerId
					const isAdmin = adminUserIds.has(member.userId)
					if (isOwner) return includeOwner
					if (isAdmin) return includeAdmins
					return includeMembers
				})

				if (qualifyingMembers.length === 0) {
					return { success: false, error: 'No qualifying group members with a main character' }
				}

				const createdBills: Bill[] = []
				for (const member of qualifyingMembers) {
					const billData: CreateBillFromTemplateInput = {
						templateId: scheduleResult.templateId,
						payerId: member.mainCharacterId!,
						payerType: 'character',
						payeeId: scheduleResult.payeeId ?? '',
						payeeType: (scheduleResult.payeeType as 'character' | 'corporation') ?? 'character',
						amount: scheduleResult.amount,
						groupBillId,
						externalMetadata: { groupId: scheduleResult.payerId },
					}
					const bill = await this.templateService.createBillFromTemplate(
						scheduleResult.ownerId,
						billData
					)
					await this.billService.issueBill(scheduleResult.ownerId, bill.id)
					createdBills.push(bill)
				}

				await this.scheduleService.updateScheduleAfterExecution(scheduleId, groupBillId, true)
				return { success: true, groupBillId, billCount: createdBills.length }
			}

			// Single-payer bill
			const billData: CreateBillFromTemplateInput = {
				templateId: scheduleResult.templateId,
				payerId: scheduleResult.payerId,
				payerType: scheduleResult.payerType,
				payeeId: scheduleResult.payeeId ?? '',
				payeeType: (scheduleResult.payeeType as 'character' | 'corporation') ?? 'character',
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
