import { and, desc, eq, gte, isNotNull, lte } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { taxAssessments, taxBillSyncEvents, taxCorporationBillingConfigs } from '../db/schema'

import type { Bills } from '@repo/bills'
import type {
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAssessment,
	TaxAssessmentWithBillHistory,
	TaxBillStatus,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

export class TaxBillingService {
	constructor(
		private db: CorporationTaxDb,
		private billsNamespace: DurableObjectNamespace
	) {}

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

		const settings = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: eq(taxCorporationBillingConfigs.corporationId, corporationId),
		})
		if (!settings || !settings.billingEnabled) {
			throw new Error('Billing is not enabled for this corporation')
		}
		if (!settings.billingPayeeId || !settings.billingPayeeType) {
			throw new Error('Billing payee configuration is incomplete')
		}

		const billIssuerUserId = settings.billingIssuerUserId ?? actorUserId
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
				payeeType: settings.billingPayeeType as 'character' | 'corporation',
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
		const settings = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: eq(taxCorporationBillingConfigs.corporationId, input.corporationId),
		})
		if (!settings) {
			throw new Error('Corporation settings not found')
		}

		const billIssuerUserId = settings.billingIssuerUserId ?? actorUserId
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

		const settings = await this.db.query.taxCorporationBillingConfigs.findFirst({
			where: eq(taxCorporationBillingConfigs.corporationId, corporationId),
		})
		if (!settings || !settings.billingEnabled) {
			throw new Error('Billing is not enabled for this corporation')
		}

		const billIssuerUserId = settings.billingIssuerUserId ?? actorUserId
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
		const results: TaxAssessmentWithBillHistory[] = []

		for (const assessment of billedAssessments) {
			const timeline = await bills.getBillTimeline(assessment.billId!)
			results.push({
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
			})
		}

		return results
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
