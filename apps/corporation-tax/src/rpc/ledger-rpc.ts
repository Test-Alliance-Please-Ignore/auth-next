import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { taxMemberSummaryVersions } from '../db/schema'
import { planProjectionRefreshFromWalletSync } from '../services/projection-refresh-plan'
import { computeRuleMutationRecalcStart } from '../services/projection-rule-freshness'

import type {
	IngestTaxLedgerWindowInput,
	ListTaxLedgerPartiesFilters,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	TaxAssessment,
	TaxAssessmentLine,
	TaxDiscrepancy,
	TaxLedgerEntry,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerParty,
	TaxLedgerRetentionResult,
	TaxLedgerWindowFilters,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'
import type { TaxAlertService } from '../services/tax-alert.service'
import type { TaxAssessmentService } from '../services/tax-assessment.service'
import type { TaxAuditService } from '../services/tax-audit.service'
import type { TaxLedgerService } from '../services/tax-ledger.service'
import type { TaxRulesService } from '../services/tax-rules.service'

type LedgerRpcContext = {
	db: CorporationTaxDb
	ledgerService: TaxLedgerService
	assessmentService: TaxAssessmentService
	auditService: TaxAuditService
	alertService: TaxAlertService
	rulesService: TaxRulesService
	triggerEssQualityAlerts: (
		actorUserId: string,
		corporationId: string,
		input: IngestTaxLedgerWindowInput | undefined,
		result: TaxLedgerIngestionResult
	) => Promise<void>
	triggerUnexpectedIncomeRefTypeAlerts: (
		actorUserId: string,
		corporationId: string,
		input: IngestTaxLedgerWindowInput | undefined,
		result: TaxLedgerIngestionResult
	) => Promise<void>
	getCurrentMonthWindow: (asOf: Date) => { periodStart: Date; periodEnd: Date }
	runAssessmentForPeriod: (
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	) => Promise<RunTaxAssessmentForPeriodResult>
	clearRuleMembershipMutation: (corporationId: string) => Promise<void>
	withCorporationIngestLock: <T>(corporationId: string, run: () => Promise<T>) => Promise<T>
	triggeredIngestOverlapWindowMs: number
}

export class TaxLedgerRpc {
	constructor(private readonly ctx: LedgerRpcContext) {}

	async ingestCorporationLedgerWindow(
		actorUserId: string,
		corporationId: string,
		input?: IngestTaxLedgerWindowInput
	): Promise<TaxLedgerIngestionResult> {
		return this.ctx.withCorporationIngestLock(corporationId, async () => {
			const result = await this.ctx.ledgerService.ingestCorporationLedgerWindow(
				corporationId,
				input
			)

			await this.ctx.auditService.logAction({
				corporationId,
				actorUserId,
				action: 'tax.ledger.ingest',
				before: null,
				after: {
					journalProcessed: result.journalProcessed,
					transactionProcessed: result.transactionProcessed,
					upsertedCount: result.upsertedCount,
					essDuplicateRecordCount: result.essDuplicateRecordCount,
					essMissingRecordCount: result.essMissingRecordCount,
					unexpectedIncomeRefTypeCount: result.unexpectedIncomeRefTypeCount,
					unexpectedIncomeEntryCount: result.unexpectedIncomeEntryCount,
				},
			})

			await this.ctx.triggerEssQualityAlerts(actorUserId, corporationId, input, result)
			await this.ctx.triggerUnexpectedIncomeRefTypeAlerts(actorUserId, corporationId, input, result)

			if (result.upsertedCount > 0) {
				const currentMonthWindow = this.ctx.getCurrentMonthWindow(new Date())
				try {
					await this.ctx.runAssessmentForPeriod(actorUserId, {
						corporationId,
						periodStart: currentMonthWindow.periodStart,
						periodEnd: currentMonthWindow.periodEnd,
						includeCharacterWallets: false,
					})
				} catch (_error) {
					// Best-effort follow-up only.
				}
			}

			return result
		})
	}

	async triggerProjectionRefreshFromWalletSync(
		actorUserId: string,
		input: TriggerTaxProjectionRefreshInput
	): Promise<TriggerTaxProjectionRefreshResult> {
		const startedAtMs = Date.now()
		const includeJournal = Boolean(input.walletJournal)
		const includeTransactions = Boolean(input.walletTransactions)
		logger.info('[CorporationTaxDO] Projection refresh trigger received', {
			corporationId: input.corporationId,
			upstreamRunId: input.upstreamRunId,
			includeJournal,
			includeTransactions,
		})
		const health = await this.ctx.ledgerService.getIngestionHealth(input.corporationId)
		const plan = planProjectionRefreshFromWalletSync(
			input,
			health,
			this.ctx.triggeredIngestOverlapWindowMs
		)
		if (!plan.shouldTrigger) {
			const currentMonthWindow = this.ctx.getCurrentMonthWindow(new Date())
			const versionRow = await this.ctx.db.query.taxMemberSummaryVersions.findFirst({
				where: eq(taxMemberSummaryVersions.corporationId, input.corporationId),
				columns: {
					projectionUpdatedAt: true,
					ruleMembershipMutatedAt: true,
				},
			})
			const projectionUpdatedAt = versionRow?.projectionUpdatedAt ?? new Date(0)
			const earliestRuleSetMutationAt = await this.ctx.rulesService.getEarliestRuleSetMutationAfter(
				input.corporationId,
				projectionUpdatedAt
			)
			const membershipMutationAt = versionRow?.ruleMembershipMutatedAt ?? null
			const recalcStart = computeRuleMutationRecalcStart({
				projectionUpdatedAt,
				openPeriodStart: currentMonthWindow.periodStart,
				earliestRuleSetMutationAt,
				membershipMutationAt,
			})
			if (recalcStart !== null) {
				await this.ctx.runAssessmentForPeriod(actorUserId, {
					corporationId: input.corporationId,
					periodStart: recalcStart,
					periodEnd: currentMonthWindow.periodEnd,
					includeCharacterWallets: false,
				})
				await this.ctx.clearRuleMembershipMutation(input.corporationId)

				logger.info('[CorporationTaxDO] Projection refresh triggered by rule mutation', {
					corporationId: input.corporationId,
					upstreamRunId: input.upstreamRunId,
					earliestRuleSetMutationAt: earliestRuleSetMutationAt?.toISOString() ?? null,
					membershipMutationAt: membershipMutationAt?.toISOString() ?? null,
					recalcStart: recalcStart.toISOString(),
					projectionUpdatedAt: projectionUpdatedAt.toISOString(),
					durationMs: Date.now() - startedAtMs,
				})

				return {
					corporationId: input.corporationId,
					triggered: true,
					reason: 'rule_mutation',
				}
			}
			return {
				corporationId: input.corporationId,
				triggered: false,
				reason: plan.reason,
			}
		}

		const ingestionResult = await this.ingestCorporationLedgerWindow(
			actorUserId,
			input.corporationId,
			plan.ingestInput
		)

		logger.info('[CorporationTaxDO] Projection refresh trigger completed', {
			corporationId: input.corporationId,
			upstreamRunId: input.upstreamRunId,
			fromDate: plan.ingestInput.fromDate?.toISOString() ?? null,
			upsertedCount: ingestionResult.upsertedCount,
			checkpointsUpdated: ingestionResult.checkpointsUpdated,
			durationMs: Date.now() - startedAtMs,
		})

		return {
			corporationId: input.corporationId,
			triggered: true,
			reason: 'ingested',
			ingestionResult,
		}
	}

	async listLedgerEntries(
		corporationId: string,
		filters?: TaxLedgerWindowFilters
	): Promise<TaxLedgerEntry[]> {
		return this.ctx.ledgerService.listLedgerEntries(corporationId, filters)
	}

	async listLedgerParties(
		corporationId: string,
		filters?: ListTaxLedgerPartiesFilters
	): Promise<TaxLedgerParty[]> {
		return this.ctx.ledgerService.listLedgerParties(corporationId, filters)
	}

	async getLedgerIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth> {
		return this.ctx.ledgerService.getIngestionHealth(corporationId)
	}

	async trimLedgerEntries(
		actorUserId: string,
		corporationId: string,
		retentionDays?: number
	): Promise<TaxLedgerRetentionResult> {
		const result = await this.ctx.ledgerService.trimLedgerEntries(corporationId, retentionDays)

		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.ledger.trim',
			before: null,
			after: {
				retentionDays: result.retentionDays,
				cutoffDate: result.cutoffDate.toISOString(),
				deletedEntryCount: result.deletedEntryCount,
			},
		})

		return result
	}

	async listAssessments(
		filters?: import('@repo/corporation-tax').ListTaxAssessmentsFilters
	): Promise<TaxAssessment[]> {
		return this.ctx.assessmentService.listAssessments(filters)
	}

	async runAssessmentForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		const result = await this.ctx.assessmentService.runAssessmentForPeriod(input)

		await this.ctx.auditService.logAction({
			corporationId: input.corporationId,
			actorUserId,
			action: 'tax.assessment.period.run',
			before: null,
			after: {
				assessmentId: result.assessment.id,
				periodStart: input.periodStart.toISOString(),
				periodEnd: input.periodEnd.toISOString(),
				lineCount: result.lineCount,
				discrepancyCount: result.discrepancyCount,
				status: result.assessment.status,
			},
		})

		if (result.discrepancyCount > 0) {
			await this.ctx.alertService.triggerAlert(actorUserId, {
				corporationId: input.corporationId,
				alertType: 'tax_discrepancy_threshold_exceeded',
				severity: 'warning',
				dedupeKey: `tax-discrepancy:${input.corporationId}:${input.periodStart.toISOString()}:${input.periodEnd.toISOString()}`,
				payload: {
					corporationId: input.corporationId,
					periodStart: input.periodStart.toISOString(),
					periodEnd: input.periodEnd.toISOString(),
					discrepancyCount: result.discrepancyCount,
					assessmentId: result.assessment.id,
				},
			})
		}

		return result
	}

	async rebuildFinalizedRollupsForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		const result = await this.ctx.assessmentService.rebuildFinalizedRollupsForPeriod(input)

		await this.ctx.auditService.logAction({
			corporationId: input.corporationId,
			actorUserId,
			action: 'tax.assessment.finalized_rollups.rebuild',
			before: null,
			after: {
				assessmentId: result.assessment.id,
				periodStart: input.periodStart.toISOString(),
				periodEnd: input.periodEnd.toISOString(),
				lineCount: result.lineCount,
				discrepancyCount: result.discrepancyCount,
				status: result.assessment.status,
			},
		})

		return result
	}

	async listAssessmentLines(
		filters: import('@repo/corporation-tax').ListTaxAssessmentLinesFilters
	): Promise<TaxAssessmentLine[]> {
		return this.ctx.assessmentService.listAssessmentLines(filters)
	}

	async listDiscrepancies(
		filters: import('@repo/corporation-tax').ListTaxDiscrepanciesFilters
	): Promise<TaxDiscrepancy[]> {
		return this.ctx.assessmentService.listDiscrepancies(filters)
	}
}
