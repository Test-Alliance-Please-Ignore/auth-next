import { and, asc, desc, eq, gte, isNotNull, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { taxAssessments, taxBillSyncEvents, taxCorporationBillingConfigs } from '../db/schema'

import type { Bills } from '@repo/bills'
import type {
	CreateTaxCorporationBillingConfigInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAssessment,
	TaxAssessmentWithBillHistory,
	TaxBillStatus,
	TaxCorporationBillingConfig,
	UpdateTaxCorporationBillingConfigInput,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

export class TaxBillingService {
	constructor(
		private db: CorporationTaxDb,
		private billsNamespace: DurableObjectNamespace
	) {}

	async listCorporationBillingConfigs(
		corporationId: string
	): Promise<TaxCorporationBillingConfig[]> {
		const rows = await this.db.query.taxCorporationBillingConfigs.findMany({
			where: eq(taxCorporationBillingConfigs.corporationId, corporationId),
			orderBy: [
				desc(taxCorporationBillingConfigs.isDefault),
				asc(taxCorporationBillingConfigs.createdAt),
			],
		})
		return rows.map((row) => this.toBillingConfig(row))
	}

	async createCorporationBillingConfig(
		corporationId: string,
		input: CreateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		const payload = this.normalizeBillingConfigInput(input)
		if (!payload.billingPayeeId?.trim() || !payload.billingPayeeType) {
			throw new Error('billingPayeeId and billingPayeeType are required')
		}
		const existingCount = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(taxCorporationBillingConfigs)
			.where(eq(taxCorporationBillingConfigs.corporationId, corporationId))
		const hasExisting = (existingCount[0]?.count ?? 0) > 0
		const shouldBeDefault = payload.isDefault || !hasExisting
		const now = new Date()

		try {
			const [inserted] = await this.db
				.insert(taxCorporationBillingConfigs)
				.values({
					corporationId,
					isDefault: false,
					billingEnabled: payload.billingEnabled,
					billingIssuerUserId: payload.billingIssuerUserId,
					billingPayeeId: payload.billingPayeeId,
					billingPayeeType: payload.billingPayeeType,
					billingDueDays: payload.billingDueDays,
					createdAt: now,
					updatedAt: now,
				})
				.returning()

			if (!inserted) {
				throw new Error('Failed to create billing configuration')
			}

			if (shouldBeDefault) {
				return this.reconcileDefaultBillingConfig(corporationId, inserted.id, now)
			}

			return this.toBillingConfig(inserted)
		} catch (error) {
			this.rethrowBillingConfigConstraintErrors(error)
		}
	}

	async updateCorporationBillingConfig(
		corporationId: string,
		configId: string,
		input: UpdateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		const existing = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: and(
				eq(taxCorporationBillingConfigs.id, configId),
				eq(taxCorporationBillingConfigs.corporationId, corporationId)
			),
		})
		if (!existing) {
			throw new Error('Billing configuration not found')
		}

		const payload = this.normalizeBillingConfigInput(input)
		const hasPayeeId = input.billingPayeeId !== undefined
		const hasPayeeType = input.billingPayeeType !== undefined
		if (hasPayeeId !== hasPayeeType) {
			throw new Error('billingPayeeId and billingPayeeType must be provided together')
		}
		const now = new Date()
		const shouldBeDefault = input.isDefault === true

		try {
			const [updated] = await this.db
				.update(taxCorporationBillingConfigs)
				.set({
					isDefault: shouldBeDefault ? existing.isDefault : (input.isDefault ?? existing.isDefault),
					billingEnabled: payload.billingEnabled ?? existing.billingEnabled,
					billingIssuerUserId: payload.billingIssuerUserId ?? existing.billingIssuerUserId,
					billingPayeeId: payload.billingPayeeId ?? existing.billingPayeeId,
					billingPayeeType: payload.billingPayeeType ?? existing.billingPayeeType,
					billingDueDays: payload.billingDueDays ?? existing.billingDueDays,
					updatedAt: now,
				})
				.where(eq(taxCorporationBillingConfigs.id, configId))
				.returning()

			if (!updated) {
				throw new Error('Billing configuration not found')
			}

			if (shouldBeDefault) {
				return this.reconcileDefaultBillingConfig(corporationId, updated.id, now)
			}

			if (updated.isDefault === false) {
				const defaultRow = await this.db.query.taxCorporationBillingConfigs.findFirst({
					where: and(
						eq(taxCorporationBillingConfigs.corporationId, corporationId),
						eq(taxCorporationBillingConfigs.isDefault, true)
					),
					columns: { id: true },
				})
				if (!defaultRow) {
					throw new Error('A corporation must have a default billing configuration')
				}
			}

			return this.toBillingConfig(updated)
		} catch (error) {
			this.rethrowBillingConfigConstraintErrors(error)
		}
	}

	async deleteCorporationBillingConfig(corporationId: string, configId: string): Promise<void> {
		const existing = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: and(
				eq(taxCorporationBillingConfigs.id, configId),
				eq(taxCorporationBillingConfigs.corporationId, corporationId)
			),
		})
		if (!existing) {
			throw new Error('Billing configuration not found')
		}

		const countRows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(taxCorporationBillingConfigs)
			.where(eq(taxCorporationBillingConfigs.corporationId, corporationId))
		const count = countRows[0]?.count ?? 0
		if (count <= 1) {
			throw new Error('Cannot delete the only billing configuration for a corporation')
		}
		if (existing.isDefault) {
			throw new Error('Cannot delete the default billing configuration')
		}

		await this.db
			.delete(taxCorporationBillingConfigs)
			.where(eq(taxCorporationBillingConfigs.id, configId))
	}

	async setDefaultCorporationBillingConfig(
		corporationId: string,
		configId: string
	): Promise<TaxCorporationBillingConfig> {
		const existing = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: and(
				eq(taxCorporationBillingConfigs.id, configId),
				eq(taxCorporationBillingConfigs.corporationId, corporationId)
			),
		})
		if (!existing) {
			throw new Error('Billing configuration not found')
		}
		const now = new Date()
		return this.reconcileDefaultBillingConfig(corporationId, configId, now)
	}

	async createBillsForAssessment(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		const assessment = await this.db.query.taxAssessments.findFirst({
			where: and(
				eq(taxAssessments.id, assessmentId),
				eq(taxAssessments.corporationId, corporationId)
			),
		})
		if (!assessment) {
			throw new Error('Assessment not found')
		}
		if (assessment.assessmentScope !== 'corporation') {
			throw new Error('Only corporation-scope assessments can be billed')
		}
		if (assessment.status === 'draft') {
			throw new Error('Assessment must be finalized before billing')
		}

		const settings = await this.getDefaultBillingConfig(corporationId)
		if (!settings.billingEnabled) {
			throw new Error('Default billing configuration is disabled for this corporation')
		}
		if (!settings.billingPayeeId.trim()) {
			throw new Error('Billing payee configuration is incomplete')
		}
		if (settings.billingPayeeType !== 'character' && settings.billingPayeeType !== 'corporation') {
			throw new Error("billingPayeeType must be 'character' or 'corporation'")
		}

		const billIssuerUserId = settings.billingIssuerUserId.trim() || actorUserId
		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const dueDate = new Date(assessment.taxPeriodEnd)
		dueDate.setUTCDate(dueDate.getUTCDate() + settings.billingDueDays)

		const bill = await bills.createBillFromExternalSource(
			billIssuerUserId,
			{
				sourceType: 'corporation_tax_assessment',
				sourceId: assessment.id,
				metadata: {
					corporationId,
					assessmentScope: assessment.assessmentScope,
					scopeId: assessment.scopeId,
				},
			},
			{
				payerId: corporationId,
				payerType: 'corporation',
				payeeId: settings.billingPayeeId,
				payeeType: settings.billingPayeeType,
				title: `Tax Assessment ${assessment.taxPeriodStart.toISOString().slice(0, 10)} - ${assessment.taxPeriodEnd
					.toISOString()
					.slice(0, 10)}`,
				description: `Assessment ${assessment.id}`,
				amount: assessment.taxDue,
				dueDate,
			}
		)

		const [updated] = await this.db
			.update(taxAssessments)
			.set({
				billId: bill.id,
				billStatus: bill.status,
				billStatusLastSyncedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(taxAssessments.id, assessment.id))
			.returning()

		await this.recordBillSyncEvent({
			corporationId,
			assessmentId: assessment.id,
			billId: bill.id,
			eventType: 'bill_created',
			fromStatus: assessment.billStatus,
			toStatus: bill.status,
			payload: {
				actorUserId,
			},
		})

		return this.toAssessment(updated ?? assessment)
	}

	async issueBillsForPeriod(
		actorUserId: string,
		input: IssueBillsForPeriodInput
	): Promise<IssueBillsForPeriodResult> {
		const settings = await this.getDefaultBillingConfig(input.corporationId)
		const billIssuerUserId = settings.billingIssuerUserId.trim() || actorUserId
		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const assessments = await this.db.query.taxAssessments.findMany({
			where: and(
				eq(taxAssessments.corporationId, input.corporationId),
				eq(taxAssessments.assessmentScope, 'corporation'),
				gte(taxAssessments.taxPeriodStart, input.periodStart),
				lte(taxAssessments.taxPeriodEnd, input.periodEnd)
			),
			orderBy: [desc(taxAssessments.taxPeriodEnd)],
		})

		const issuedAssessmentIds: string[] = []
		const skippedAssessmentIds: string[] = []

		for (const assessment of assessments) {
			if (assessment.assessmentScope !== 'corporation') {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			if (!assessment.billId) {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			const billView = await bills.getBillIntegrationView(assessment.billId)
			if (!billView) {
				skippedAssessmentIds.push(assessment.id)
				continue
			}
			if (billView.status !== 'draft') {
				await this.db
					.update(taxAssessments)
					.set({
						billStatus: billView.status as TaxBillStatus,
						billStatusLastSyncedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(taxAssessments.id, assessment.id))
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			const issuedBill = await bills.issueBill(billIssuerUserId, assessment.billId)
			await this.db
				.update(taxAssessments)
				.set({
					billStatus: issuedBill.status as TaxBillStatus,
					billStatusLastSyncedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(taxAssessments.id, assessment.id))

			await this.recordBillSyncEvent({
				corporationId: input.corporationId,
				assessmentId: assessment.id,
				billId: assessment.billId,
				eventType: 'bill_issued',
				fromStatus: assessment.billStatus,
				toStatus: issuedBill.status,
				payload: {
					actorUserId,
				},
			})
			issuedAssessmentIds.push(assessment.id)
		}

		return {
			corporationId: input.corporationId,
			periodStart: input.periodStart,
			periodEnd: input.periodEnd,
			issuedAssessmentIds,
			skippedAssessmentIds,
		}
	}

	async syncAssessmentBillStatus(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		const assessment = await this.db.query.taxAssessments.findFirst({
			where: and(
				eq(taxAssessments.id, assessmentId),
				eq(taxAssessments.corporationId, corporationId)
			),
		})
		if (!assessment) {
			throw new Error('Assessment not found')
		}
		if (assessment.assessmentScope !== 'corporation') {
			throw new Error('Only corporation-scope assessments can be billed')
		}
		if (!assessment.billId) {
			throw new Error('Assessment has no linked bill')
		}

		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const bill = await bills.getBillIntegrationView(assessment.billId)
		if (!bill) {
			throw new Error('Linked bill not found')
		}

		let nextAssessmentStatus = assessment.status
		if (bill.status === 'paid') {
			nextAssessmentStatus = 'paid'
		}

		const [updated] = await this.db
			.update(taxAssessments)
			.set({
				billStatus: bill.status as TaxBillStatus,
				billStatusLastSyncedAt: new Date(),
				status: nextAssessmentStatus,
				updatedAt: new Date(),
			})
			.where(eq(taxAssessments.id, assessment.id))
			.returning()

		await this.recordBillSyncEvent({
			corporationId,
			assessmentId: assessment.id,
			billId: assessment.billId,
			eventType: 'bill_status_synced',
			fromStatus: assessment.billStatus,
			toStatus: bill.status,
			payload: {
				actorUserId,
				billPaidAt: bill.paidAt ? bill.paidAt.toISOString() : null,
			},
		})

		return this.toAssessment(updated ?? assessment)
	}

	async retractAssessmentBill(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		const assessment = await this.db.query.taxAssessments.findFirst({
			where: and(
				eq(taxAssessments.id, assessmentId),
				eq(taxAssessments.corporationId, corporationId)
			),
		})
		if (!assessment) {
			throw new Error('Assessment not found')
		}
		if (assessment.assessmentScope !== 'corporation') {
			throw new Error('Only corporation-scope assessments can be billed')
		}
		if (!assessment.billId) {
			throw new Error('Assessment has no linked bill')
		}

		const settings = await this.getDefaultBillingConfig(corporationId)
		if (!settings.billingEnabled) {
			throw new Error('Default billing configuration is disabled for this corporation')
		}

		const billIssuerUserId = settings.billingIssuerUserId.trim() || actorUserId
		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const cancelledBill = await bills.cancelBill(billIssuerUserId, assessment.billId)

		const [updated] = await this.db
			.update(taxAssessments)
			.set({
				billStatus: cancelledBill.status as TaxBillStatus,
				billStatusLastSyncedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(taxAssessments.id, assessment.id))
			.returning()

		await this.recordBillSyncEvent({
			corporationId,
			assessmentId: assessment.id,
			billId: assessment.billId,
			eventType: 'bill_retracted',
			fromStatus: assessment.billStatus,
			toStatus: cancelledBill.status,
			payload: {
				actorUserId,
			},
		})

		return this.toAssessment(updated ?? assessment)
	}

	private async getDefaultBillingConfig(corporationId: string) {
		const settings = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: and(
				eq(taxCorporationBillingConfigs.corporationId, corporationId),
				eq(taxCorporationBillingConfigs.isDefault, true)
			),
		})

		if (!settings) {
			throw new Error('Default billing configuration not found for this corporation')
		}

		return settings
	}

	private normalizeBillingConfigInput(
		input: CreateTaxCorporationBillingConfigInput | UpdateTaxCorporationBillingConfigInput
	): {
		isDefault: boolean
		billingEnabled?: boolean
		billingIssuerUserId?: string
		billingPayeeId?: string
		billingPayeeType?: 'character' | 'corporation'
		billingDueDays?: number
	} {
		if (
			input.billingPayeeType !== undefined &&
			input.billingPayeeType !== 'character' &&
			input.billingPayeeType !== 'corporation'
		) {
			throw new Error("billingPayeeType must be 'character' or 'corporation'")
		}
		if (input.billingPayeeId !== undefined && input.billingPayeeId.trim().length === 0) {
			throw new Error('billingPayeeId must not be empty')
		}
		if (input.billingDueDays !== undefined) {
			if (
				!Number.isInteger(input.billingDueDays) ||
				input.billingDueDays < 1 ||
				input.billingDueDays > 90
			) {
				throw new Error('billingDueDays must be an integer between 1 and 90')
			}
		}

		return {
			isDefault: Boolean(input.isDefault),
			billingEnabled: input.billingEnabled,
			billingIssuerUserId: input.billingIssuerUserId?.trim(),
			billingPayeeId: input.billingPayeeId?.trim(),
			billingPayeeType: input.billingPayeeType,
			billingDueDays: input.billingDueDays,
		}
	}

	private rethrowBillingConfigConstraintErrors(error: unknown): never {
		if (error instanceof Error) {
			const message = error.message.toLowerCase()
			if (
				message.includes('tax_corporation_billing_configs_payee_tuple_unique') ||
				message.includes('duplicate key value violates unique constraint')
			) {
				throw new Error('Duplicate billing configuration tuple for corporation')
			}
		}
		throw error
	}

	private async reconcileDefaultBillingConfig(
		corporationId: string,
		defaultConfigId: string,
		now: Date
	): Promise<TaxCorporationBillingConfig> {
		const rows = await this.db
			.update(taxCorporationBillingConfigs)
			.set({
				isDefault: sql`${taxCorporationBillingConfigs.id} = ${defaultConfigId}`,
				updatedAt: now,
			})
			.where(eq(taxCorporationBillingConfigs.corporationId, corporationId))
			.returning()

		const selected = rows.find((row) => row.id === defaultConfigId)
		if (!selected) {
			throw new Error('Billing configuration not found')
		}

		return this.toBillingConfig(selected)
	}

	private toBillingConfig(
		row: typeof taxCorporationBillingConfigs.$inferSelect
	): TaxCorporationBillingConfig {
		if (row.billingPayeeType !== 'character' && row.billingPayeeType !== 'corporation') {
			throw new Error("billingPayeeType must be 'character' or 'corporation'")
		}
		return {
			id: row.id,
			corporationId: row.corporationId,
			isDefault: row.isDefault,
			billingEnabled: row.billingEnabled,
			billingIssuerUserId: row.billingIssuerUserId,
			billingPayeeId: row.billingPayeeId,
			billingPayeeType: row.billingPayeeType,
			billingDueDays: row.billingDueDays,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	async getCorporationBillStatusHistory(
		corporationId: string,
		limit = 25,
		offset = 0
	): Promise<TaxAssessmentWithBillHistory[]> {
		const boundedLimit = Math.min(Math.max(limit, 1), 100)
		const boundedOffset = Math.max(offset, 0)
		const assessments = await this.db.query.taxAssessments.findMany({
			where: and(
				eq(taxAssessments.corporationId, corporationId),
				eq(taxAssessments.assessmentScope, 'corporation')
			),
			orderBy: [desc(taxAssessments.taxPeriodEnd), desc(taxAssessments.createdAt)],
			limit: boundedLimit,
			offset: boundedOffset,
		})

		const billedAssessments = assessments.filter(
			(assessment) => assessment.assessmentScope === 'corporation' && assessment.billId
		)
		if (billedAssessments.length === 0) {
			return []
		}

		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const billIds = billedAssessments.map((assessment) => assessment.billId!)
		const timelinesByBillId = await bills.getBillTimelines(billIds)

		return billedAssessments.map((assessment) => ({
			assessment: this.toAssessment(assessment),
			timeline: (timelinesByBillId[assessment.billId!] ?? []).map((event) => ({
				id: event.id,
				billId: event.billId,
				eventType: event.eventType,
				fromStatus: event.fromStatus,
				toStatus: event.toStatus,
				actorUserId: event.actorUserId,
				metadata: event.metadata,
				createdAt: event.createdAt,
			})),
		}))
	}

	async getAssessmentBillStatusHistory(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessmentWithBillHistory | null> {
		const assessment = await this.db.query.taxAssessments.findFirst({
			where: and(
				eq(taxAssessments.id, assessmentId),
				eq(taxAssessments.corporationId, corporationId)
			),
		})
		if (!assessment || !assessment.billId) {
			return null
		}
		if (assessment.assessmentScope !== 'corporation') {
			return null
		}

		const bills = getStub<Bills>(this.billsNamespace, 'default')
		const timeline = await bills.getBillTimeline(assessment.billId)

		return {
			assessment: this.toAssessment(assessment),
			timeline: timeline.map((event) => ({
				id: event.id,
				billId: event.billId,
				eventType: event.eventType,
				fromStatus: event.fromStatus,
				toStatus: event.toStatus,
				actorUserId: event.actorUserId,
				metadata: event.metadata,
				createdAt: event.createdAt,
			})),
		}
	}

	async syncCorporationBillStatuses(
		actorUserId: string,
		corporationId: string,
		limit = 100
	): Promise<SyncCorporationBillStatusesResult> {
		const boundedLimit = Math.min(Math.max(limit, 1), 250)
		const assessments = await this.db.query.taxAssessments.findMany({
			where: and(
				eq(taxAssessments.corporationId, corporationId),
				eq(taxAssessments.assessmentScope, 'corporation'),
				isNotNull(taxAssessments.billId)
			),
			orderBy: [desc(taxAssessments.updatedAt)],
			limit: boundedLimit,
		})

		const processedAssessmentIds: string[] = []
		const updatedAssessmentIds: string[] = []
		const skippedAssessmentIds: string[] = []
		const bills = getStub<Bills>(this.billsNamespace, 'default')

		for (const assessment of assessments) {
			processedAssessmentIds.push(assessment.id)
			if (assessment.assessmentScope !== 'corporation') {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			if (!assessment.billId) {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			const bill = await bills.getBillIntegrationView(assessment.billId)
			if (!bill) {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			const shouldUpdate =
				assessment.billStatus !== bill.status ||
				(bill.status === 'paid' && assessment.status !== 'paid')
			if (!shouldUpdate) {
				skippedAssessmentIds.push(assessment.id)
				continue
			}

			const nextAssessmentStatus = bill.status === 'paid' ? 'paid' : assessment.status
			await this.db
				.update(taxAssessments)
				.set({
					billStatus: bill.status as TaxBillStatus,
					billStatusLastSyncedAt: new Date(),
					status: nextAssessmentStatus,
					updatedAt: new Date(),
				})
				.where(eq(taxAssessments.id, assessment.id))

			await this.recordBillSyncEvent({
				corporationId,
				assessmentId: assessment.id,
				billId: assessment.billId,
				eventType: 'bill_status_bulk_synced',
				fromStatus: assessment.billStatus,
				toStatus: bill.status,
				payload: {
					actorUserId,
				},
			})
			updatedAssessmentIds.push(assessment.id)
		}

		return {
			corporationId,
			processedAssessmentIds,
			updatedAssessmentIds,
			skippedAssessmentIds,
		}
	}

	private async recordBillSyncEvent(input: {
		corporationId: string
		assessmentId: string
		billId: string
		eventType: string
		fromStatus: string | null
		toStatus: string | null
		payload: Record<string, string | number | boolean | null> | null
	}): Promise<void> {
		await this.db.insert(taxBillSyncEvents).values({
			corporationId: input.corporationId,
			assessmentId: input.assessmentId,
			billId: input.billId,
			eventType: input.eventType,
			fromStatus: input.fromStatus,
			toStatus: input.toStatus,
			payload: input.payload,
		})
	}

	private toAssessment(row: typeof taxAssessments.$inferSelect): TaxAssessment {
		return {
			id: row.id,
			corporationId: row.corporationId,
			taxPeriodStart: row.taxPeriodStart,
			taxPeriodEnd: row.taxPeriodEnd,
			assessmentScope: row.assessmentScope,
			scopeId: row.scopeId,
			taxableIncome: row.taxableIncome,
			nonTaxableIncome: row.nonTaxableIncome,
			taxDue: row.taxDue,
			taxPaid: row.taxPaid,
			taxDelta: row.taxDelta,
			status: row.status,
			inGameTaxRateBps: row.inGameTaxRateBps,
			portalTaxRateBps: row.portalTaxRateBps,
			billId: row.billId,
			billStatus: row.billStatus,
			billStatusLastSyncedAt: row.billStatusLastSyncedAt,
			approvedBy: row.approvedBy,
			approvedAt: row.approvedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
