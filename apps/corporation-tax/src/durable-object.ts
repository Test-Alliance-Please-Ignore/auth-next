import { DurableObject } from 'cloudflare:workers'

import { and, eq, inArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import {
	taxAssessments,
	taxCorporationExclusions,
	taxLedgerEntries,
	taxMemberSummaryVersions,
	taxSyncCheckpoints,
} from './db/schema'
import { planProjectionRefreshFromWalletSync } from './services/projection-refresh-plan'
import { computeRuleMutationRecalcStart } from './services/projection-rule-freshness'
import { TaxAlertService } from './services/tax-alert.service'
import { TaxAssessmentService } from './services/tax-assessment.service'
import { TaxAuditService } from './services/tax-audit.service'
import { TaxBillingService } from './services/tax-billing.service'
import { TaxCorporationExclusionsService } from './services/tax-corporation-exclusions.service'
import { TaxExportService } from './services/tax-export.service'
import { TaxLedgerService } from './services/tax-ledger.service'
import { TaxReportService } from './services/tax-report.service'
import { TaxRuleGroupService } from './services/tax-rule-groups.service'
import { TaxRulesService } from './services/tax-rules.service'

import type {
	CorporationTax,
	CorporationTaxHealth,
	CreateTaxExportScheduleInput,
	CreateTaxRuleGroupInput,
	CreateTaxRuleSetInput,
	IngestTaxLedgerWindowInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	ListTaxAlertsFilters,
	ListTaxAssessmentLinesFilters,
	ListTaxAssessmentsFilters,
	ListTaxAuditLogFilters,
	ListTaxCorporationExclusionsFilters,
	ListTaxDailyRollupsFilters,
	ListTaxDiscrepanciesFilters,
	ListTaxDiscrepancyReportFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxMissingEsiKeyReportFilters,
	ListTaxNotificationDestinationsFilters,
	ListTaxRuleGroupsFilters,
	ListTaxRuleSetsFilters,
	RequestTaxExportInput,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAssessment,
	TaxAssessmentLine,
	TaxAssessmentWithBillHistory,
	TaxAuditLogEntry,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationExclusion,
	TaxDailyRollup,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExportArtifact,
	TaxExportRecord,
	TaxExportSchedule,
	TaxLedgerEntry,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerRetentionResult,
	TaxLedgerWindowFilters,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxReportWindowFilters,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxScheduledOperationsResult,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	TriggerTaxAlertInput,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	UpdateTaxRuleGroupInput,
	UpdateTaxRuleSetInput,
	UpsertTaxCorporationExclusionInput,
	UpsertTaxNotificationDestinationInput,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from './context'
import type { CorporationTaxDb } from './db'

const LEDGER_RETENTION_DAYS = 90
const DEFAULT_ESS_ALERT_THRESHOLD_ISK = 1_000_000_000
const SCHEDULED_CORPORATION_CONCURRENCY = 5
const TRIGGERED_INGEST_OVERLAP_WINDOW_MS = 48 * 60 * 60 * 1000

export class CorporationTaxDO extends DurableObject<Env, {}> implements CorporationTax {
	private db: CorporationTaxDb
	private exclusionsService: TaxCorporationExclusionsService
	private ledgerService: TaxLedgerService
	private assessmentService: TaxAssessmentService
	private alertService: TaxAlertService
	private billingService: TaxBillingService
	private exportService: TaxExportService
	private reportService: TaxReportService
	private auditService: TaxAuditService
	private ruleGroupService: TaxRuleGroupService
	private rulesService: TaxRulesService

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		this.db = createDb(env.DATABASE_URL)
		this.exclusionsService = new TaxCorporationExclusionsService(this.db)
		this.ledgerService = new TaxLedgerService(
			this.db,
			env.EVE_CORPORATION_DATA,
			env.EVE_CHARACTER_DATA
		)
		this.assessmentService = new TaxAssessmentService(this.db, env.EVE_CORPORATION_DATA)
		this.alertService = new TaxAlertService(this.db, env.DISCORD)
		this.billingService = new TaxBillingService(this.db, env.BILLS)
		this.reportService = new TaxReportService(this.db, env.EVE_CORPORATION_DATA)
		this.exportService = new TaxExportService(this.db, this.reportService)
		this.auditService = new TaxAuditService(this.db)
		this.ruleGroupService = new TaxRuleGroupService(this.db)
		this.rulesService = new TaxRulesService(this.db)
	}

	async getHealth(): Promise<CorporationTaxHealth> {
		void this.ledgerService
		void this.assessmentService
		void this.billingService
		void this.exportService
		return {
			status: 'ok',
			service: 'corporation-tax',
			timestamp: new Date().toISOString(),
		}
	}

	async upsertCorporationExclusion(
		actorUserId: string,
		corporationId: string,
		input: UpsertTaxCorporationExclusionInput
	): Promise<TaxCorporationExclusion> {
		const before = await this.exclusionsService.getExclusion(corporationId)
		const after = await this.exclusionsService.upsertExclusion(actorUserId, corporationId, input)

		await this.auditService.logAction({
			corporationId,
			actorUserId,
			action: before ? 'tax.exclusion.updated' : 'tax.exclusion.created',
			before: this.toAuditPayload(before),
			after: this.toAuditPayload(after),
		})
		return after
	}

	async deleteCorporationExclusion(actorUserId: string, corporationId: string): Promise<void> {
		const before = await this.exclusionsService.getExclusion(corporationId)
		await this.exclusionsService.deleteExclusion(corporationId)
		await this.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.exclusion.deleted',
			before: this.toAuditPayload(before),
			after: null,
		})
	}

	async listCorporationExclusions(
		filters?: ListTaxCorporationExclusionsFilters
	): Promise<TaxCorporationExclusion[]> {
		return this.exclusionsService.listExclusions(filters)
	}

	async listWalletDivisions(corporationId: string): Promise<number[]> {
		try {
			const stub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			return await stub.getWalletDivisions(corporationId)
		} catch (_error) {
			return []
		}
	}

	async listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxAuditLogEntry[]> {
		return this.auditService.listAuditLog(filters)
	}

	async createRuleGroup(
		actorUserId: string,
		input: CreateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		await this.ruleGroupService.ensureDefaultGlobalGroup(actorUserId)
		const created = await this.ruleGroupService.createRuleGroup(actorUserId, input)
		await this.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.created',
			before: null,
			after: this.toAuditPayload(created),
		})
		return created
	}

	async updateRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		input: UpdateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		const updated = await this.ruleGroupService.updateRuleGroup(ruleGroupId, input)
		await this.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.updated',
			before: null,
			after: this.toAuditPayload(updated),
		})
		return updated
	}

	async deleteRuleGroup(actorUserId: string, ruleGroupId: string): Promise<void> {
		await this.ruleGroupService.deleteRuleGroup(ruleGroupId)
		await this.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.deleted',
			before: { ruleGroupId },
			after: null,
		})
	}

	async listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]> {
		await this.ruleGroupService.ensureDefaultGlobalGroup('system:tax:rule-groups')
		return this.ruleGroupService.listRuleGroups(filters)
	}

	async attachCorporationToRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment> {
		const attached = await this.ruleGroupService.attachCorporation(ruleGroupId, corporationId)
		await this.touchRuleMembershipMutation(corporationId)
		await this.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.rule-group.corporation.attached',
			before: null,
			after: this.toAuditPayload(attached),
		})
		return attached
	}

	async detachCorporationFromRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<void> {
		await this.ruleGroupService.detachCorporation(ruleGroupId, corporationId)
		await this.touchRuleMembershipMutation(corporationId)
		await this.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.rule-group.corporation.detached',
			before: { ruleGroupId, corporationId },
			after: null,
		})
	}

	async listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]> {
		return this.ruleGroupService.listRuleGroupAttachments(ruleGroupId)
	}

	async createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet> {
		const created = await this.rulesService.createRuleSet(actorUserId, input)
		const affectedCorporationIds = await this.getCorporationIdsForRuleGroup(created.ruleGroupId)

		await this.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.created',
			before: null,
			after: {
				id: created.id,
				ruleGroupId: created.ruleGroupId,
				name: created.name,
				priority: created.priority,
				isActive: created.isActive,
				effectiveFrom: created.effectiveFrom.toISOString(),
				effectiveTo: created.effectiveTo?.toISOString() ?? null,
				appliesToRefType: created.appliesToRefType,
				taxRateBps: created.taxRateBps,
			},
		})

		return created
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		return this.rulesService.listRuleSets(filters)
	}

	async updateRuleSet(
		actorUserId: string,
		ruleSetId: string,
		input: UpdateTaxRuleSetInput
	): Promise<TaxRuleSet> {
		const updated = await this.rulesService.updateRuleSet(ruleSetId, input)
		const affectedCorporationIds = await this.getCorporationIdsForRuleGroup(updated.ruleGroupId)
		await this.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.updated',
			before: { ruleSetId },
			after: {
				id: updated.id,
				ruleGroupId: updated.ruleGroupId,
				name: updated.name,
				priority: updated.priority,
				isActive: updated.isActive,
			},
		})
		return updated
	}

	async deleteRuleSet(actorUserId: string, ruleSetId: string): Promise<void> {
		const existing = await this.rulesService.getRuleSetById(ruleSetId)
		if (!existing) {
			throw new Error('Rule set not found')
		}
		const affectedCorporationIds = await this.getCorporationIdsForRuleGroup(existing.ruleGroupId)
		await this.rulesService.deleteRuleSet(ruleSetId)
		await this.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.deleted',
			before: {
				id: existing.id,
				ruleGroupId: existing.ruleGroupId,
				name: existing.name,
			},
			after: null,
		})
	}

	async ingestCorporationLedgerWindow(
		actorUserId: string,
		corporationId: string,
		input?: IngestTaxLedgerWindowInput
	): Promise<TaxLedgerIngestionResult> {
		const result = await this.ledgerService.ingestCorporationLedgerWindow(corporationId, input)

		await this.auditService.logAction({
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

		await this.triggerEssQualityAlerts(actorUserId, corporationId, input, result)
		await this.triggerUnexpectedIncomeRefTypeAlerts(actorUserId, corporationId, input, result)

		// Keep open-period member projections warm after successful ingest.
		// This is best-effort and must not fail ingestion.
		if (result.upsertedCount > 0) {
			const currentMonthWindow = this.getCurrentMonthWindow(new Date())
			try {
				await this.runAssessmentForPeriod(actorUserId, {
					corporationId,
					periodStart: currentMonthWindow.periodStart,
					periodEnd: currentMonthWindow.periodEnd,
					includeCharacterWallets: true,
				})
			} catch (_error) {
				// Best-effort follow-up only.
			}
		}

		return result
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
		const health = await this.ledgerService.getIngestionHealth(input.corporationId)
		const plan = planProjectionRefreshFromWalletSync(
			input,
			health,
			TRIGGERED_INGEST_OVERLAP_WINDOW_MS
		)
		if (!plan.shouldTrigger) {
			const currentMonthWindow = this.getCurrentMonthWindow(new Date())
			const versionRow = await this.db.query.taxMemberSummaryVersions.findFirst({
				where: eq(taxMemberSummaryVersions.corporationId, input.corporationId),
				columns: {
					projectionUpdatedAt: true,
					ruleMembershipMutatedAt: true,
				},
			})
			const projectionUpdatedAt = versionRow?.projectionUpdatedAt ?? new Date(0)
			const earliestRuleSetMutationAt = await this.rulesService.getEarliestRuleSetMutationAfter(
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
				await this.runAssessmentForPeriod(actorUserId, {
					corporationId: input.corporationId,
					periodStart: recalcStart,
					periodEnd: currentMonthWindow.periodEnd,
					includeCharacterWallets: true,
				})
				await this.clearRuleMembershipMutation(input.corporationId)

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
		return this.ledgerService.listLedgerEntries(corporationId, filters)
	}

	async getLedgerIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth> {
		return this.ledgerService.getIngestionHealth(corporationId)
	}

	async listDailyRollups(
		corporationId: string,
		filters?: ListTaxDailyRollupsFilters
	): Promise<TaxDailyRollup[]> {
		return this.ledgerService.listDailyRollups(corporationId, filters)
	}

	async trimLedgerEntries(
		actorUserId: string,
		corporationId: string,
		retentionDays?: number
	): Promise<TaxLedgerRetentionResult> {
		const result = await this.ledgerService.trimLedgerEntries(corporationId, retentionDays)

		await this.auditService.logAction({
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

	async listAssessments(filters?: ListTaxAssessmentsFilters): Promise<TaxAssessment[]> {
		return this.assessmentService.listAssessments(filters)
	}

	async runAssessmentForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		const result = await this.assessmentService.runAssessmentForPeriod(input)

		await this.auditService.logAction({
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
			await this.alertService.triggerAlert(actorUserId, {
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
		const result = await this.assessmentService.rebuildFinalizedRollupsForPeriod(input)

		await this.auditService.logAction({
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

	async listAssessmentLines(filters: ListTaxAssessmentLinesFilters): Promise<TaxAssessmentLine[]> {
		return this.assessmentService.listAssessmentLines(filters)
	}

	async listDiscrepancies(filters: ListTaxDiscrepanciesFilters): Promise<TaxDiscrepancy[]> {
		return this.assessmentService.listDiscrepancies(filters)
	}

	async createBillsForAssessment(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		try {
			return await this.billingService.createBillsForAssessment(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.triggerBillSyncFailureAlert({
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
			return await this.billingService.issueBillsForPeriod(actorUserId, input)
		} catch (error) {
			await this.triggerBillSyncFailureAlert({
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
			return await this.billingService.syncAssessmentBillStatus(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.triggerBillSyncFailureAlert({
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
			return await this.billingService.retractAssessmentBill(
				actorUserId,
				corporationId,
				assessmentId
			)
		} catch (error) {
			await this.triggerBillSyncFailureAlert({
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
	): Promise<TaxAssessmentWithBillHistory[]> {
		return this.billingService.getCorporationBillStatusHistory(corporationId, limit, offset)
	}

	async getAssessmentBillStatusHistory(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessmentWithBillHistory | null> {
		return this.billingService.getAssessmentBillStatusHistory(corporationId, assessmentId)
	}

	async syncCorporationBillStatuses(
		actorUserId: string,
		corporationId: string,
		limit?: number
	): Promise<SyncCorporationBillStatusesResult> {
		try {
			return await this.billingService.syncCorporationBillStatuses(
				actorUserId,
				corporationId,
				limit
			)
		} catch (error) {
			await this.triggerBillSyncFailureAlert({
				actorUserId,
				corporationId,
				operation: 'sync_corporation_bill_statuses',
				error,
			})
			throw error
		}
	}

	async getSummaryReport(filters?: TaxReportWindowFilters): Promise<TaxSummaryReport> {
		return this.reportService.getSummaryReport(filters)
	}

	async getTotalTaxesByCorporationReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>> {
		return this.reportService.getTotalTaxesByCorporationReport(filters)
	}

	async getTopIncomeSourcesReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxTopIncomeSourceRow[]> {
		return this.reportService.getTopIncomeSourcesReport(filters)
	}

	async getTopIncomeSourcesMonthlyReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxTopIncomeSourceMonthlyRow[]> {
		return this.reportService.getTopIncomeSourcesMonthlyReport(filters)
	}

	async getEssPayoutReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxPagedResult<TaxEssPayoutRow>> {
		return this.reportService.getEssPayoutReport(filters)
	}

	async getComplianceOverTimeReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxCompliancePoint[]> {
		return this.reportService.getComplianceOverTimeReport(filters)
	}

	async getTaxDiscrepancyReport(
		filters?: ListTaxDiscrepancyReportFilters
	): Promise<TaxPagedResult<TaxDiscrepancy>> {
		return this.reportService.getTaxDiscrepancyReport(filters)
	}

	async getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>> {
		return this.reportService.getMissingEsiKeysReport(filters)
	}

	async getBillStatusReport(filters?: TaxReportWindowFilters): Promise<TaxBillStatusReportRow[]> {
		return this.reportService.getBillStatusReport(filters)
	}

	async getMemberSummaryReport(
		filters: TaxMemberSummaryReportFilters
	): Promise<TaxMemberSummary[]> {
		return this.reportService.getMemberSummaryReport(filters)
	}

	async requestExport(actorUserId: string, input: RequestTaxExportInput): Promise<TaxExportRecord> {
		const created = await this.exportService.requestExport(actorUserId, input)
		await this.auditService.logAction({
			corporationId: created.corporationId ?? undefined,
			actorUserId,
			action: 'tax.export.requested',
			before: null,
			after: {
				exportId: created.id,
				reportType: created.reportType,
				format: created.format,
				status: created.status,
				rowCount: created.rowCount,
			},
		})
		return created
	}

	async listExports(filters?: ListTaxExportsFilters): Promise<TaxExportRecord[]> {
		return this.exportService.listExports(filters)
	}

	async getExportById(exportId: string): Promise<TaxExportRecord | null> {
		return this.exportService.getExportById(exportId)
	}

	async getExportArtifact(exportId: string): Promise<TaxExportArtifact> {
		return this.exportService.getExportArtifact(exportId)
	}

	async createExportSchedule(
		actorUserId: string,
		input: CreateTaxExportScheduleInput
	): Promise<TaxExportSchedule> {
		const schedule = await this.exportService.createExportSchedule(actorUserId, input)
		await this.auditService.logAction({
			corporationId: schedule.corporationId ?? undefined,
			actorUserId,
			action: 'tax.export.schedule.created',
			before: null,
			after: {
				scheduleId: schedule.id,
				name: schedule.name,
				frequency: schedule.frequency,
				reportType: schedule.reportType,
				format: schedule.format,
				isActive: schedule.isActive,
				nextRunAt: schedule.nextRunAt.toISOString(),
			},
		})
		return schedule
	}

	async listExportSchedules(filters?: ListTaxExportSchedulesFilters): Promise<TaxExportSchedule[]> {
		return this.exportService.listExportSchedules(filters)
	}

	async runScheduledOperations(
		actorUserId: string,
		asOf?: Date,
		exportScheduleLimit?: number,
		alertRetryLimit?: number
	): Promise<TaxScheduledOperationsResult> {
		const runAt = asOf ?? new Date()
		const processingCorporationIds = await this.listProcessableCorporationIds()
		let dailyIngestCorporationsProcessed = 0
		let dailyIngestFailures = 0
		let monthlyAssessmentCorporationsProcessed = 0
		let monthlyAssessmentFailures = 0
		let ledgerRetentionCorporationsProcessed = 0
		let ledgerRetentionFailures = 0
		let ledgerRetentionEntriesDeleted = 0
		const previousMonthWindow = this.getPreviousMonthWindow(runAt)

		await this.runWithConcurrency(
			processingCorporationIds,
			SCHEDULED_CORPORATION_CONCURRENCY,
			async (corporationId) => {
				await this.triggerCorporationCoverageAlerts(actorUserId, corporationId)
				const shouldIngest = await this.shouldRunDailyIngest(corporationId, runAt)
				if (shouldIngest) {
					try {
						await this.ingestCorporationLedgerWindow(actorUserId, corporationId, {
							includeCharacterWallets: true,
						})
						dailyIngestCorporationsProcessed += 1
					} catch (error) {
						dailyIngestFailures += 1
						await this.triggerSchedulerOperationFailureAlert({
							actorUserId,
							corporationId,
							operation: 'daily_ingest',
							asOf: runAt,
							error,
						})
					}
				}

				try {
					const existingMonthlyAssessment = await this.db.query.taxAssessments.findFirst({
						where: and(
							eq(taxAssessments.corporationId, corporationId),
							eq(taxAssessments.assessmentScope, 'corporation'),
							eq(taxAssessments.taxPeriodStart, previousMonthWindow.periodStart),
							eq(taxAssessments.taxPeriodEnd, previousMonthWindow.periodEnd)
						),
						columns: {
							id: true,
						},
					})

					if (!existingMonthlyAssessment) {
						await this.runAssessmentForPeriod(actorUserId, {
							corporationId,
							periodStart: previousMonthWindow.periodStart,
							periodEnd: previousMonthWindow.periodEnd,
							includeCharacterWallets: true,
						})
						monthlyAssessmentCorporationsProcessed += 1
					}
				} catch (error) {
					monthlyAssessmentFailures += 1
					await this.triggerSchedulerOperationFailureAlert({
						actorUserId,
						corporationId,
						operation: 'monthly_assessment',
						asOf: runAt,
						error,
					})
				}

				try {
					const retentionResult = await this.ledgerService.trimLedgerEntries(
						corporationId,
						LEDGER_RETENTION_DAYS
					)
					ledgerRetentionCorporationsProcessed += 1
					ledgerRetentionEntriesDeleted += retentionResult.deletedEntryCount
				} catch (error) {
					ledgerRetentionFailures += 1
					await this.triggerSchedulerOperationFailureAlert({
						actorUserId,
						corporationId,
						operation: 'ledger_retention',
						asOf: runAt,
						error,
					})
				}
			}
		)

		const exportScheduleResult = await this.exportService.runDueExportSchedules(
			runAt,
			exportScheduleLimit
		)
		const dueExportSchedulesProcessed = exportScheduleResult.processed
		await this.triggerScheduledExportFailureAlerts(
			actorUserId,
			runAt,
			exportScheduleResult.failures
		)
		const failedAlertDeliveriesRetried = await this.alertService.retryFailedAlertDeliveries(
			actorUserId,
			alertRetryLimit
		)

		await this.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.scheduled.operations.run',
			before: null,
			after: {
				asOf: runAt.toISOString(),
				includedCorporationCount: processingCorporationIds.length,
				dailyIngestCorporationsProcessed,
				dailyIngestFailures,
				monthlyAssessmentCorporationsProcessed,
				monthlyAssessmentFailures,
				ledgerRetentionCorporationsProcessed,
				ledgerRetentionFailures,
				ledgerRetentionEntriesDeleted,
				dueExportSchedulesProcessed,
				dueExportScheduleFailures: exportScheduleResult.failures.length,
				failedAlertDeliveriesRetried,
			},
		})

		return {
			asOf: runAt,
			includedCorporationCount: processingCorporationIds.length,
			dailyIngestCorporationsProcessed,
			dailyIngestFailures,
			monthlyAssessmentCorporationsProcessed,
			monthlyAssessmentFailures,
			ledgerRetentionCorporationsProcessed,
			ledgerRetentionFailures,
			ledgerRetentionEntriesDeleted,
			dueExportSchedulesProcessed,
			failedAlertDeliveriesRetried,
		}
	}

	async triggerAlert(actorUserId: string, input: TriggerTaxAlertInput): Promise<TaxAlert> {
		const alert = await this.alertService.triggerAlert(actorUserId, input)
		await this.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.triggered',
			before: null,
			after: {
				alertId: alert.id,
				alertType: alert.alertType,
				severity: alert.severity,
				status: alert.status,
				dedupeKey: alert.dedupeKey,
			},
		})
		return alert
	}

	async listAlerts(filters?: ListTaxAlertsFilters): Promise<TaxAlert[]> {
		return this.alertService.listAlerts(filters)
	}

	async acknowledgeAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const alert = await this.alertService.acknowledgeAlert(actorUserId, alertId)
		await this.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.acknowledged',
			before: null,
			after: {
				alertId: alert.id,
			},
		})
		return alert
	}

	async resolveAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const alert = await this.alertService.resolveAlert(actorUserId, alertId)
		await this.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.resolved',
			before: null,
			after: {
				alertId: alert.id,
			},
		})
		return alert
	}

	async retryFailedAlertDeliveries(actorUserId: string, limit?: number): Promise<number> {
		const retried = await this.alertService.retryFailedAlertDeliveries(actorUserId, limit)
		await this.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.alert.retry_failed_deliveries',
			before: null,
			after: {
				retried,
			},
		})
		return retried
	}

	async upsertNotificationDestination(
		actorUserId: string,
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination> {
		const destination = await this.alertService.upsertNotificationDestination(actorUserId, input)
		await this.auditService.logAction({
			corporationId: destination.corporationId ?? undefined,
			actorUserId,
			action: 'tax.notification_destination.upserted',
			before: null,
			after: {
				destinationId: destination.id,
				scope: destination.scope,
				corporationId: destination.corporationId,
				guildId: destination.guildId,
				channelId: destination.channelId,
				isActive: destination.isActive,
			},
		})
		return destination
	}

	async listNotificationDestinations(
		filters?: ListTaxNotificationDestinationsFilters
	): Promise<TaxNotificationDestination[]> {
		return this.alertService.listNotificationDestinations(filters)
	}

	private async triggerEssQualityAlerts(
		actorUserId: string,
		corporationId: string,
		input: IngestTaxLedgerWindowInput | undefined,
		result: TaxLedgerIngestionResult
	): Promise<void> {
		const windowKey = this.toLedgerWindowDedupeKey(input)
		const basePayload = {
			corporationId,
			fromDate: input?.fromDate?.toISOString() ?? null,
			toDate: input?.toDate?.toISOString() ?? null,
		}

		if (result.essDuplicateRecordCount > 0) {
			await this.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'ess_duplicate_records_detected',
				severity: 'warning',
				dedupeKey: `ess-duplicate-records:${corporationId}:${windowKey}`,
				payload: {
					...basePayload,
					count: result.essDuplicateRecordCount,
					sampleSourceKeys: result.essDuplicateSourceKeys,
				},
			})
		}

		if (result.essMissingRecordCount > 0) {
			await this.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'ess_missing_records_detected',
				severity: 'warning',
				dedupeKey: `ess-missing-records:${corporationId}:${windowKey}`,
				payload: {
					...basePayload,
					count: result.essMissingRecordCount,
					sampleSourceKeys: result.essMissingSourceKeys,
				},
			})
		}

		await this.triggerEssThresholdAlert(actorUserId, corporationId, input, windowKey)
	}

	private async triggerUnexpectedIncomeRefTypeAlerts(
		actorUserId: string,
		corporationId: string,
		input: IngestTaxLedgerWindowInput | undefined,
		result: TaxLedgerIngestionResult
	): Promise<void> {
		if (result.unexpectedIncomeRefTypes.length === 0) {
			return
		}

		const basePayload = {
			corporationId,
			fromDate: input?.fromDate?.toISOString() ?? null,
			toDate: input?.toDate?.toISOString() ?? null,
		}

		for (const signal of result.unexpectedIncomeRefTypes) {
			await this.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'unexpected_income_ref_type_detected',
				severity: 'warning',
				// Deduped by corporation + ref type to avoid alert storms across recurring ingests.
				dedupeKey: `unexpected-income-ref-type:${corporationId}:${signal.refType}`,
				payload: {
					...basePayload,
					refType: signal.refType,
					entryCountInBatch: signal.entryCount,
					sampleSourceType: signal.sampleSourceType,
					sampleSourceKey: signal.sampleSourceKey,
					sampleAmount: signal.sampleAmount,
					sampleEntryDate: signal.sampleEntryDate.toISOString(),
				},
			})
		}
	}

	private toLedgerWindowDedupeKey(input?: IngestTaxLedgerWindowInput): string {
		const fromDate = input?.fromDate?.toISOString() ?? 'none'
		const toDate = input?.toDate?.toISOString() ?? 'none'
		return `${fromDate}:${toDate}`
	}

	private async listProcessableCorporationIds(): Promise<string[]> {
		const [checkpointRows, ledgerRows, assessmentRows, exclusionRows] = await Promise.all([
			this.db
				.select({ corporationId: taxSyncCheckpoints.corporationId })
				.from(taxSyncCheckpoints)
				.groupBy(taxSyncCheckpoints.corporationId),
			this.db
				.select({ corporationId: taxLedgerEntries.corporationId })
				.from(taxLedgerEntries)
				.groupBy(taxLedgerEntries.corporationId),
			this.db
				.select({ corporationId: taxAssessments.corporationId })
				.from(taxAssessments)
				.groupBy(taxAssessments.corporationId),
			this.db.query.taxCorporationExclusions.findMany({
				columns: { corporationId: true },
				limit: 10_000,
			}),
		])
		const excludedSet = new Set(exclusionRows.map((row) => row.corporationId))
		const ids = new Set<string>()
		for (const row of [...checkpointRows, ...ledgerRows, ...assessmentRows]) {
			if (row.corporationId && !excludedSet.has(row.corporationId)) {
				ids.add(row.corporationId)
			}
		}
		return Array.from(ids)
	}

	private async shouldRunDailyIngest(corporationId: string, asOf: Date): Promise<boolean> {
		const health = await this.ledgerService.getIngestionHealth(corporationId)
		const utcDayStart = new Date(
			Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), 0, 0, 0, 0)
		)

		if (health.lastEntryUpdatedAt === null) {
			return true
		}
		if (health.lastEntryUpdatedAt < utcDayStart) {
			return true
		}
		return health.checkpoints.some(
			(checkpoint) =>
				checkpoint.lastSuccessfulSyncAt === null || checkpoint.lastSuccessfulSyncAt < utcDayStart
		)
	}

	private async getCorporationEsiAuthStatus(corporationId: string) {
		try {
			const stub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			const status = await stub.getCorporationAuthStatus(corporationId)
			return {
				isConfigured: status.isConfigured,
				isVerified: status.isVerified,
				lastVerified: status.lastVerified,
				directorCount: status.directorCount,
				healthyDirectorCount: status.healthyDirectorCount,
				requiredScopes: status.requiredScopes,
				missingRequiredScopes: status.missingRequiredScopes,
				hasRequiredScopes: status.hasRequiredScopes,
				hasCorporationWalletScope: status.hasCorporationWalletScope,
				hasCharacterWalletScope: status.hasCharacterWalletScope,
				hasCorporationMembershipScope: status.hasCorporationMembershipScope,
				grantedScopeCount: status.grantedScopeCount,
			}
		} catch (_error) {
			return null
		}
	}

	private async getWalletDivisions(corporationId: string): Promise<number[]> {
		try {
			const stub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			return await stub.getWalletDivisions(corporationId)
		} catch (_error) {
			return []
		}
	}

	private getPreviousMonthWindow(asOf: Date): {
		periodStart: Date
		periodEnd: Date
	} {
		const previousMonthDate = new Date(
			Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1, 0, 0, 0, 0)
		)
		const periodStart = new Date(
			Date.UTC(previousMonthDate.getUTCFullYear(), previousMonthDate.getUTCMonth(), 1, 0, 0, 0, 0)
		)
		const periodEnd = new Date(
			Date.UTC(
				previousMonthDate.getUTCFullYear(),
				previousMonthDate.getUTCMonth() + 1,
				0,
				23,
				59,
				59,
				999
			)
		)

		return {
			periodStart,
			periodEnd,
		}
	}

	private getCurrentMonthWindow(asOf: Date): {
		periodStart: Date
		periodEnd: Date
	} {
		const periodStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1, 0, 0, 0, 0))
		const periodEnd = new Date(
			Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0, 23, 59, 59, 999)
		)

		return {
			periodStart,
			periodEnd,
		}
	}

	private async getCorporationIdsForRuleGroup(ruleGroupId: string): Promise<string[]> {
		const rows = await this.ruleGroupService.listRuleGroupAttachments(ruleGroupId)
		return rows.map((row) => row.corporationId)
	}

	private async touchRuleMembershipMutation(corporationId: string): Promise<void> {
		const now = new Date()
		await this.db
			.insert(taxMemberSummaryVersions)
			.values({
				corporationId,
				ruleMembershipMutatedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: taxMemberSummaryVersions.corporationId,
				set: {
					ruleMembershipMutatedAt: sql`coalesce(${taxMemberSummaryVersions.ruleMembershipMutatedAt}, ${now})`,
					updatedAt: now,
				},
			})
	}

	private async clearRuleMembershipMutation(corporationId: string): Promise<void> {
		await this.db
			.update(taxMemberSummaryVersions)
			.set({
				ruleMembershipMutatedAt: null,
				updatedAt: new Date(),
			})
			.where(eq(taxMemberSummaryVersions.corporationId, corporationId))
	}

	private async triggerSchedulerOperationFailureAlert(input: {
		actorUserId: string
		corporationId: string
		operation: 'daily_ingest' | 'monthly_assessment' | 'ledger_retention'
		asOf: Date
		error: unknown
	}): Promise<void> {
		const dayKey = input.asOf.toISOString().slice(0, 10)
		const errorMessage = input.error instanceof Error ? input.error.message : String(input.error)
		await this.alertService.triggerAlert(input.actorUserId, {
			corporationId: input.corporationId,
			alertType: 'scheduled_operations_failed',
			severity: 'warning',
			dedupeKey: `scheduled-operation-failed:${input.operation}:${input.corporationId}:${dayKey}`,
			payload: {
				operation: input.operation,
				corporationId: input.corporationId,
				asOf: input.asOf.toISOString(),
				error: errorMessage,
			},
		})
	}

	private async triggerScheduledExportFailureAlerts(
		actorUserId: string,
		asOf: Date,
		failures: Array<{
			scheduleId: string
			corporationId: string | null
			error: string
		}>
	): Promise<void> {
		const dayKey = asOf.toISOString().slice(0, 10)
		for (const failure of failures) {
			await this.alertService.triggerAlert(actorUserId, {
				corporationId: failure.corporationId,
				alertType: 'scheduled_export_failed',
				severity: 'warning',
				dedupeKey: `scheduled-export-failed:${failure.scheduleId}:${dayKey}`,
				payload: {
					scheduleId: failure.scheduleId,
					corporationId: failure.corporationId,
					asOf: asOf.toISOString(),
					error: failure.error,
				},
			})
		}
	}

	private async triggerCorporationCoverageAlerts(
		actorUserId: string,
		corporationId: string
	): Promise<void> {
		const status = await this.getCorporationEsiAuthStatus(corporationId)
		if (!status || !status.isConfigured || status.healthyDirectorCount < 1) {
			await this.alertService.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'corp_token_invalid',
				severity: 'critical',
				dedupeKey: `corp-token-invalid:${corporationId}`,
				payload: {
					corporationId,
					isConfigured: status?.isConfigured ?? false,
					directorCount: status?.directorCount ?? 0,
					healthyDirectorCount: status?.healthyDirectorCount ?? 0,
					lastVerified: status?.lastVerified?.toISOString() ?? null,
				},
			})
		}

		if (status && !status.hasCorporationWalletScope) {
			await this.alertService.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'corp_missing_wallet_scope',
				severity: 'critical',
				dedupeKey: `corp-missing-wallet-scope:${corporationId}`,
				payload: {
					corporationId,
					requiredScopes: status.requiredScopes,
					missingRequiredScopes: status.missingRequiredScopes,
				},
			})
		}

		const divisions = await this.getWalletDivisions(corporationId)
		if (divisions.length === 0) {
			await this.alertService.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'wallet_division_config_missing',
				severity: 'warning',
				dedupeKey: `wallet-division-config-missing:${corporationId}`,
				payload: {
					corporationId,
					divisions,
				},
			})
			return
		}

		const knownDivisionRows = await this.db
			.select({
				division: taxLedgerEntries.division,
			})
			.from(taxLedgerEntries)
			.where(
				and(
					eq(taxLedgerEntries.corporationId, corporationId),
					inArray(taxLedgerEntries.sourceType, [
						'corporation_wallet_journal',
						'corporation_wallet_transaction',
					])
				)
			)
			.groupBy(taxLedgerEntries.division)

		const knownDivisions = knownDivisionRows
			.map((row) => row.division)
			.filter((division): division is number => Number.isInteger(division))
			.sort((left, right) => left - right)

		// Skip drift checks until we've ingested at least one wallet division baseline.
		if (knownDivisions.length === 0) {
			return
		}

		const discoveredDivisions = [...new Set(divisions)].sort((left, right) => left - right)
		const knownDivisionSet = new Set(knownDivisions)
		const discoveredDivisionSet = new Set(discoveredDivisions)
		const newDivisions = discoveredDivisions.filter((division) => !knownDivisionSet.has(division))
		const missingDivisions = knownDivisions.filter(
			(division) => !discoveredDivisionSet.has(division)
		)

		if (newDivisions.length > 0 || missingDivisions.length > 0) {
			await this.alertService.triggerAlert(actorUserId, {
				corporationId,
				alertType: 'wallet_division_config_missing',
				severity: 'warning',
				dedupeKey: `wallet-division-config-missing:${corporationId}`,
				payload: {
					corporationId,
					discoveredDivisions,
					knownDivisions,
					newDivisions,
					missingDivisions,
				},
			})
		}
	}

	private getEssAlertThresholdIsk(): number {
		const raw = this.env.ESS_ALERT_THRESHOLD_ISK
		const parsed = typeof raw === 'string' ? Number(raw) : NaN
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return DEFAULT_ESS_ALERT_THRESHOLD_ISK
		}
		return Math.floor(parsed)
	}

	private async triggerEssThresholdAlert(
		actorUserId: string,
		corporationId: string,
		input: IngestTaxLedgerWindowInput | undefined,
		windowKey: string
	): Promise<void> {
		const rows = await this.ledgerService.listLedgerEntries(corporationId, {
			refTypes: ['ess_escrow_transfer'],
			fromDate: input?.fromDate,
			toDate: input?.toDate,
			limit: 10_000,
		})
		const totalEssIncome = rows.reduce((sum, row) => {
			const amount = Number(row.amount)
			if (!Number.isFinite(amount) || amount <= 0) {
				return sum
			}
			return sum + amount
		}, 0)

		const thresholdIsk = this.getEssAlertThresholdIsk()
		if (totalEssIncome < thresholdIsk) {
			return
		}

		await this.alertService.triggerAlert(actorUserId, {
			corporationId,
			alertType: 'ess_threshold_exceeded',
			severity: 'warning',
			dedupeKey: `ess-threshold-exceeded:${corporationId}:${windowKey}`,
			payload: {
				corporationId,
				threshold: thresholdIsk,
				totalEssIncome,
				fromDate: input?.fromDate?.toISOString() ?? null,
				toDate: input?.toDate?.toISOString() ?? null,
			},
		})
	}

	private async triggerBillSyncFailureAlert(input: {
		actorUserId: string
		corporationId: string
		assessmentId?: string
		operation: string
		error: unknown
	}): Promise<void> {
		const errorMessage = input.error instanceof Error ? input.error.message : String(input.error)
		await this.alertService.triggerAlert(input.actorUserId, {
			corporationId: input.corporationId,
			alertType: 'bill_sync_failed',
			severity: 'warning',
			dedupeKey: `bill-sync-failed:${input.operation}:${input.corporationId}:${input.assessmentId ?? 'none'}`,
			payload: {
				corporationId: input.corporationId,
				assessmentId: input.assessmentId ?? null,
				operation: input.operation,
				error: errorMessage,
			},
		})
	}

	private async runWithConcurrency<T>(
		items: readonly T[],
		concurrency: number,
		worker: (item: T) => Promise<void>
	): Promise<void> {
		if (items.length === 0) {
			return
		}

		const boundedConcurrency = Math.min(Math.max(concurrency, 1), 20)
		let cursor = 0
		const workerCount = Math.min(boundedConcurrency, items.length)

		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (cursor < items.length) {
					const index = cursor
					cursor += 1
					await worker(items[index]!)
				}
			})
		)
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/health') {
			return Response.json(await this.getHealth())
		}

		return new Response('Corporation Tax Durable Object - Use RPC methods', { status: 200 })
	}

	private toAuditPayload(value: unknown): Record<string, unknown> | null {
		if (!value || typeof value !== 'object') {
			return null
		}
		const payload = { ...(value as Record<string, unknown>) }
		for (const key of ['createdAt', 'updatedAt', 'effectiveFrom', 'effectiveTo']) {
			const field = payload[key]
			if (field instanceof Date) {
				payload[key] = field.toISOString()
			}
		}
		return payload
	}
}
