import type {
	CreateTaxCorporationBillingConfigInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	SyncBillStatusesByBillIdsResult,
	SyncCorporationBillStatusesResult,
	TaxAssessment,
	TaxAssessmentWithBillHistory,
	TaxBillingEventHistoryRow,
	TaxBillingEventSortBy,
	TaxBillStateSyncInput,
	TaxCorporationBillingConfig,
	TaxPagedResult,
	UpdateTaxCorporationBillingConfigInput,
} from '@repo/corporation-tax'
import type { TaxAuditService } from '../services/tax-audit.service'
import type { TaxBillingService } from '../services/tax-billing.service'

type BillingRpcContext = {
	billingService: TaxBillingService
	auditService: TaxAuditService
	toAuditPayload: (value: unknown) => Record<string, unknown> | null
	triggerBillSyncFailureAlert: (input: {
		actorUserId: string
		corporationId: string
		assessmentId?: string
		operation: string
		error: unknown
	}) => Promise<void>
}

export class TaxBillingRpc {
	constructor(private readonly ctx: BillingRpcContext) {}

	async createBillsForAssessment(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		try {
			return await this.ctx.billingService.createBillsForAssessment(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId,
				assessmentId,
				operation: 'create_bill',
				error,
			})
			throw error
		}
	}

	async issueBillsForPeriod(
		actorUserId: string,
		input: IssueBillsForPeriodInput
	): Promise<IssueBillsForPeriodResult> {
		try {
			return await this.ctx.billingService.issueBillsForPeriod(actorUserId, input)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId: input.corporationId,
				operation: 'issue_bills_for_period',
				error,
			})
			throw error
		}
	}

	async syncAssessmentBillStatus(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		try {
			return await this.ctx.billingService.syncAssessmentBillStatus(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId,
				assessmentId,
				operation: 'sync_assessment_bill_status',
				error,
			})
			throw error
		}
	}

	async retractAssessmentBill(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		try {
			return await this.ctx.billingService.retractAssessmentBill(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId,
				assessmentId,
				operation: 'retract_assessment_bill',
				error,
			})
			throw error
		}
	}

	async getCorporationBillStatusHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxPagedResult<TaxAssessmentWithBillHistory>> {
		return this.ctx.billingService.getCorporationBillStatusHistory(corporationId, limit, offset)
	}

	async getCorporationBillEventHistory(
		corporationId: string,
		limit?: number,
		offset?: number,
		sortBy?: TaxBillingEventSortBy,
		sortDir?: 'asc' | 'desc'
	): Promise<TaxPagedResult<TaxBillingEventHistoryRow>> {
		return this.ctx.billingService.getCorporationBillEventHistory(
			corporationId,
			limit,
			offset,
			sortBy,
			sortDir
		)
	}

	async getAssessmentBillStatusHistory(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessmentWithBillHistory | null> {
		return this.ctx.billingService.getAssessmentBillStatusHistory(corporationId, assessmentId)
	}

	async syncCorporationBillStatuses(
		actorUserId: string,
		corporationId: string,
		limit?: number
	): Promise<SyncCorporationBillStatusesResult> {
		try {
			return await this.ctx.billingService.syncCorporationBillStatuses(
				actorUserId,
				corporationId,
				limit
			)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId,
				operation: 'sync_corporation_bill_statuses',
				error,
			})
			throw error
		}
	}

	async syncBillStatus(
		actorUserId: string,
		billState: TaxBillStateSyncInput
	): Promise<SyncBillStatusesByBillIdsResult> {
		try {
			return await this.ctx.billingService.syncBillStatus(actorUserId, billState)
		} catch (error) {
			await this.ctx.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId: 'unknown',
				operation: 'sync_bill_status',
				error,
			})
			throw error
		}
	}

	async listCorporationBillingConfigs(
		corporationId: string
	): Promise<TaxCorporationBillingConfig[]> {
		return this.ctx.billingService.listCorporationBillingConfigs(corporationId)
	}

	async createCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		input: CreateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		const created = await this.ctx.billingService.createCorporationBillingConfig(
			corporationId,
			input
		)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.billing-config.created',
			before: null,
			after: this.ctx.toAuditPayload(created),
		})
		return created
	}

	async updateCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string,
		input: UpdateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		const beforeList = await this.ctx.billingService.listCorporationBillingConfigs(corporationId)
		const before = beforeList.find((row) => row.id === configId) ?? null
		const updated = await this.ctx.billingService.updateCorporationBillingConfig(
			corporationId,
			configId,
			input
		)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.billing-config.updated',
			before: this.ctx.toAuditPayload(before),
			after: this.ctx.toAuditPayload(updated),
		})
		return updated
	}

	async deleteCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<void> {
		const beforeList = await this.ctx.billingService.listCorporationBillingConfigs(corporationId)
		const before = beforeList.find((row) => row.id === configId) ?? null
		await this.ctx.billingService.deleteCorporationBillingConfig(corporationId, configId)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.billing-config.deleted',
			before: this.ctx.toAuditPayload(before),
			after: null,
		})
	}

	async setDefaultCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<TaxCorporationBillingConfig> {
		const beforeList = await this.ctx.billingService.listCorporationBillingConfigs(corporationId)
		const before = beforeList.find((row) => row.id === configId) ?? null
		const updated = await this.ctx.billingService.setDefaultCorporationBillingConfig(
			corporationId,
			configId
		)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.billing-config.default-set',
			before: this.ctx.toAuditPayload(before),
			after: this.ctx.toAuditPayload(updated),
		})
		return updated
	}
}
