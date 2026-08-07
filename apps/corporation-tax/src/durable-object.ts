import { DurableObject } from 'cloudflare:workers'

import { and, eq, inArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'

import { createDb } from './db'
import {
	managedCorporations,
	taxLedgerEntries,
	taxMemberSummaryVersions,
	taxRuleGroupAttachments,
} from './db/schema'
import { TaxBillingRpc } from './rpc/billing-rpc'
import { TaxLedgerRpc } from './rpc/ledger-rpc'
import { TaxOperationsRpc } from './rpc/operations-rpc'
import { TaxReportsRpc } from './rpc/reports-rpc'
import { TaxRulesRpc } from './rpc/rules-rpc'
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
	CreateTaxCorporationBillingConfigInput,
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
	ListTaxDiscrepanciesFilters,
	ListTaxDiscrepancyReportFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxLedgerPartiesFilters,
	ListTaxMissingEsiKeyReportFilters,
	ListTaxNotificationDestinationsFilters,
	ListTaxRuleGroupsFilters,
	ListTaxRuleSetsFilters,
	RequestTaxExportInput,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	SyncBillStatusesByBillIdsResult,
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAssessment,
	TaxAssessmentLine,
	TaxAssessmentWithBillHistory,
	TaxAuditLogEntry,
	TaxBillingEventHistoryRow,
	TaxBillStateSyncInput,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationBillingConfig,
	TaxCorporationExclusion,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExportArtifact,
	TaxExportRecord,
	TaxExportSchedule,
	TaxLedgerEntry,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerParty,
	TaxLedgerRetentionResult,
	TaxLedgerWindowFilters,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxRollupReportFilters,
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
	UpdateTaxCorporationBillingConfigInput,
	UpdateTaxRuleGroupInput,
	UpdateTaxRuleSetInput,
	UpsertTaxCorporationExclusionInput,
	UpsertTaxNotificationDestinationInput,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from './context'
import type { CorporationTaxDb } from './db'

const DEFAULT_ESS_ALERT_THRESHOLD_ISK = 1_000_000_000
const TRIGGERED_INGEST_OVERLAP_WINDOW_MS = 48 * 60 * 60 * 1000
const TAX_PROJECTION_RETRY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const TAX_PROJECTION_RETRY_KEY_PREFIX = 'tax-projection-retry-intent:'

type TaxProjectionRetryIntentEnvelope = {
	value: string
	expiresAt: number
}
export class CorporationTaxDO extends DurableObject<Env, {}> implements CorporationTax {
	private readonly logger = logger.withTags({ service: 'corporation-tax-durable-object' })
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
	private rulesRpc: TaxRulesRpc
	private ledgerRpc: TaxLedgerRpc
	private billingRpc: TaxBillingRpc
	private reportsRpc: TaxReportsRpc
	private operationsRpc: TaxOperationsRpc
	private corporationIngestLocks = new Map<string, Promise<void>>()

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		try {
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
			this.rulesRpc = new TaxRulesRpc({
				env,
				exclusionsService: this.exclusionsService,
				auditService: this.auditService,
				ruleGroupService: this.ruleGroupService,
				rulesService: this.rulesService,
				getCorporationIdsForRuleGroup: this.getCorporationIdsForRuleGroup.bind(this),
				touchRuleMembershipMutation: this.touchRuleMembershipMutation.bind(this),
				toAuditPayload: this.toAuditPayload.bind(this),
			})
			this.ledgerRpc = new TaxLedgerRpc({
				db: this.db,
				ledgerService: this.ledgerService,
				assessmentService: this.assessmentService,
				auditService: this.auditService,
				alertService: this.alertService,
				rulesService: this.rulesService,
				triggerEssQualityAlerts: this.triggerEssQualityAlerts.bind(this),
				triggerUnexpectedIncomeRefTypeAlerts: this.triggerUnexpectedIncomeRefTypeAlerts.bind(this),
				getCurrentMonthWindow: this.getCurrentMonthWindow.bind(this),
				runAssessmentForPeriod: this.runAssessmentForPeriod.bind(this),
				clearRuleMembershipMutation: this.clearRuleMembershipMutation.bind(this),
				withCorporationIngestLock: this.withCorporationIngestLock.bind(this),
				triggeredIngestOverlapWindowMs: TRIGGERED_INGEST_OVERLAP_WINDOW_MS,
			})
			this.billingRpc = new TaxBillingRpc({
				billingService: this.billingService,
				auditService: this.auditService,
				toAuditPayload: this.toAuditPayload.bind(this),
				triggerBillSyncFailureAlert: this.triggerBillSyncFailureAlert.bind(this),
			})
			this.reportsRpc = new TaxReportsRpc({
				reportService: this.reportService,
			})
			this.operationsRpc = new TaxOperationsRpc({
				db: this.db,
				ledgerService: this.ledgerService,
				exportService: this.exportService,
				alertService: this.alertService,
				auditService: this.auditService,
				listProcessableCorporationIds: this.listProcessableCorporationIds.bind(this),
				shouldRunDailyIngest: this.shouldRunDailyIngest.bind(this),
				triggerProjectionRefreshFromWalletSync:
					this.triggerProjectionRefreshFromWalletSync.bind(this),
				buildScheduledProjectionRefreshInput: this.buildScheduledProjectionRefreshInput.bind(this),
				runAssessmentForPeriod: this.runAssessmentForPeriod.bind(this),
				triggerSchedulerOperationFailureAlert:
					this.triggerSchedulerOperationFailureAlert.bind(this),
				triggerScheduledExportFailureAlerts: this.triggerScheduledExportFailureAlerts.bind(this),
				triggerCorporationCoverageAlerts: this.triggerCorporationCoverageAlerts.bind(this),
				getPreviousMonthWindow: this.getPreviousMonthWindow.bind(this),
				runWithConcurrency: this.runWithConcurrency.bind(this),
			})
		} catch (error) {
			this.logger.error('[CorporationTaxDO] constructor initialization failed', {
				...this.toSafeErrorLogDetails(error),
				hasDatabaseUrl: Boolean(env.DATABASE_URL),
				hasEveCorporationDataBinding: Boolean(env.EVE_CORPORATION_DATA),
				hasEveCharacterDataBinding: Boolean(env.EVE_CHARACTER_DATA),
				hasBillsBinding: Boolean(env.BILLS),
				hasDiscordBinding: Boolean(env.DISCORD),
			})
			throw error
		}
	}

	private async rpcGuard<T>(
		method: string,
		context: Record<string, unknown>,
		fn: () => Promise<T>
	): Promise<T> {
		try {
			return await fn()
		} catch (error) {
			this.logger.error('[CorporationTaxDO] RPC method failed', {
				method,
				...this.toSafeErrorLogDetails(error),
				...context,
			})
			throw error
		}
	}

	private toSafeErrorLogDetails(error: unknown): Record<string, unknown> {
		const details = toErrorLogDetails(error) as unknown as Record<string, unknown>
		const safe: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(details)) {
			if (typeof value === 'string') {
				safe[key] = this.sanitizeErrorText(value, key === 'stack' ? 1600 : 800)
				continue
			}
			safe[key] = value
		}
		return safe
	}

	private sanitizeErrorText(value: string, maxLength: number): string {
		let next = value
		next = this.sanitizeParamsSection(next)
		next = next.replace(/values\s*\(([\s\S]{200,}?)\)/gi, 'values(<redacted>)')
		if (next.length > maxLength) {
			return `${next.slice(0, maxLength)}…[truncated]`
		}
		return next
	}

	private sanitizeParamsSection(value: string): string {
		const marker = '\nparams:'
		const markerIndex = value.toLowerCase().indexOf(marker)
		if (markerIndex < 0) {
			return value
		}

		const paramsStart = markerIndex + marker.length
		const paramsRaw = value.slice(paramsStart).trim()
		const commaSeparated = paramsRaw.length > 0 ? paramsRaw.split(',') : []
		const valueCount = commaSeparated.length
		const shouldSummarizeList = valueCount > 10 || paramsRaw.length > 240

		if (!shouldSummarizeList) {
			return value
		}

		return `${value.slice(0, paramsStart)} [ ... (${valueCount} values) ... ]`
	}

	private summarizeForLog(value: unknown): unknown {
		if (value === null || value === undefined) {
			return value
		}
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			return value
		}
		if (value instanceof Date) {
			return value.toISOString()
		}
		if (Array.isArray(value)) {
			return { kind: 'array', length: value.length }
		}
		if (typeof value === 'object') {
			const record = value as Record<string, unknown>
			const keys = Object.keys(record)
			const summary: Record<string, unknown> = { kind: 'object', keys: keys.slice(0, 12) }
			for (const key of ['corporationId', 'assessmentId', 'actorUserId', 'fromDate', 'toDate']) {
				if (key in record) {
					summary[key] = this.summarizeForLog(record[key])
				}
			}
			return summary
		}
		return { kind: typeof value }
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
		return this.rulesRpc.upsertCorporationExclusion(actorUserId, corporationId, input)
	}

	async deleteCorporationExclusion(actorUserId: string, corporationId: string): Promise<void> {
		return this.rulesRpc.deleteCorporationExclusion(actorUserId, corporationId)
	}

	async listCorporationExclusions(
		filters?: ListTaxCorporationExclusionsFilters
	): Promise<TaxCorporationExclusion[]> {
		return this.rpcGuard(
			'listCorporationExclusions',
			{ filters: this.summarizeForLog(filters) },
			() => this.rulesRpc.listCorporationExclusions(filters)
		)
	}

	async listWalletDivisions(corporationId: string): Promise<number[]> {
		return this.rpcGuard('listWalletDivisions', { corporationId }, () =>
			this.rulesRpc.listWalletDivisions(corporationId)
		)
	}

	async listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxPagedResult<TaxAuditLogEntry>> {
		return this.rulesRpc.listAuditLog(filters)
	}

	async createRuleGroup(
		actorUserId: string,
		input: CreateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		return this.rulesRpc.createRuleGroup(actorUserId, input)
	}

	async updateRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		input: UpdateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		return this.rulesRpc.updateRuleGroup(actorUserId, ruleGroupId, input)
	}

	async deleteRuleGroup(actorUserId: string, ruleGroupId: string): Promise<void> {
		return this.rulesRpc.deleteRuleGroup(actorUserId, ruleGroupId)
	}

	async listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]> {
		return this.rulesRpc.listRuleGroups(filters)
	}

	async attachCorporationToRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment> {
		return this.rulesRpc.attachCorporationToRuleGroup(actorUserId, ruleGroupId, corporationId)
	}

	async detachCorporationFromRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<void> {
		return this.rulesRpc.detachCorporationFromRuleGroup(actorUserId, ruleGroupId, corporationId)
	}

	async listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]> {
		return this.rulesRpc.listRuleGroupAttachments(ruleGroupId)
	}

	async createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet> {
		return this.rulesRpc.createRuleSet(actorUserId, input)
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		return this.rulesRpc.listRuleSets(filters)
	}

	async updateRuleSet(
		actorUserId: string,
		ruleSetId: string,
		input: UpdateTaxRuleSetInput
	): Promise<TaxRuleSet> {
		return this.rulesRpc.updateRuleSet(actorUserId, ruleSetId, input)
	}

	async deleteRuleSet(actorUserId: string, ruleSetId: string): Promise<void> {
		return this.rulesRpc.deleteRuleSet(actorUserId, ruleSetId)
	}

	async ingestCorporationLedgerWindow(
		actorUserId: string,
		corporationId: string,
		input?: IngestTaxLedgerWindowInput
	): Promise<TaxLedgerIngestionResult> {
		return this.ledgerRpc.ingestCorporationLedgerWindow(actorUserId, corporationId, input)
	}

	async triggerProjectionRefreshFromWalletSync(
		actorUserId: string,
		input: TriggerTaxProjectionRefreshInput
	): Promise<TriggerTaxProjectionRefreshResult> {
		this.logger.info('[CorporationTaxDO] triggerProjectionRefreshFromWalletSync started', {
			actorUserId,
			corporationId: input.corporationId,
			upstreamRunId: input.upstreamRunId,
			triggeredAt: input.triggeredAt,
			hasWalletJournalWatermark: Boolean(input.walletJournal),
			hasWalletTransactionsWatermark: Boolean(input.walletTransactions),
			includeCharacterWallets: input.includeCharacterWallets ?? false,
		})

		try {
			const result = await this.ledgerRpc.triggerProjectionRefreshFromWalletSync(actorUserId, input)
			this.logger.info('[CorporationTaxDO] triggerProjectionRefreshFromWalletSync completed', {
				actorUserId,
				corporationId: input.corporationId,
				upstreamRunId: input.upstreamRunId,
				resultReason: result.reason,
				triggered: result.triggered,
				ingestionUpsertedCount: result.ingestionResult?.upsertedCount ?? 0,
			})
			return result
		} catch (error) {
			this.logger.error('[CorporationTaxDO] triggerProjectionRefreshFromWalletSync failed', {
				actorUserId,
				corporationId: input.corporationId,
				upstreamRunId: input.upstreamRunId,
				...this.toSafeErrorLogDetails(error),
			})
			throw error
		}
	}

	async getTaxProjectionRetryIntent(corporationId: string): Promise<string | null> {
		const value = await this.state.storage.get(this.getTaxProjectionRetryKey(corporationId))
		if (typeof value !== 'string') {
			return null
		}

		try {
			const parsed = JSON.parse(value) as Partial<TaxProjectionRetryIntentEnvelope>
			if (
				typeof parsed.value === 'string' &&
				typeof parsed.expiresAt === 'number' &&
				Number.isFinite(parsed.expiresAt)
			) {
				if (Date.now() >= parsed.expiresAt) {
					await this.state.storage.delete(this.getTaxProjectionRetryKey(corporationId))
					return null
				}

				return parsed.value
			}
		} catch {
			// Fall through to legacy raw-string compatibility.
		}

		return value
	}

	async putTaxProjectionRetryIntent(corporationId: string, payload: string): Promise<void> {
		const envelope: TaxProjectionRetryIntentEnvelope = {
			value: payload,
			expiresAt: Date.now() + TAX_PROJECTION_RETRY_TTL_MS,
		}
		await this.state.storage.put(
			this.getTaxProjectionRetryKey(corporationId),
			JSON.stringify(envelope)
		)
	}

	async deleteTaxProjectionRetryIntent(corporationId: string): Promise<void> {
		await this.state.storage.delete(this.getTaxProjectionRetryKey(corporationId))
	}

	async listLedgerEntries(
		corporationId: string,
		filters?: TaxLedgerWindowFilters
	): Promise<TaxLedgerEntry[]> {
		return this.rpcGuard(
			'listLedgerEntries',
			{
				corporationId,
				filters: this.summarizeForLog(filters),
			},
			() => this.ledgerRpc.listLedgerEntries(corporationId, filters)
		)
	}

	async listLedgerParties(
		corporationId: string,
		filters?: ListTaxLedgerPartiesFilters
	): Promise<TaxLedgerParty[]> {
		return this.ledgerRpc.listLedgerParties(corporationId, filters)
	}

	async getLedgerIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth> {
		return this.ledgerRpc.getLedgerIngestionHealth(corporationId)
	}

	async trimLedgerEntries(
		actorUserId: string,
		corporationId: string,
		retentionDays?: number
	): Promise<TaxLedgerRetentionResult> {
		return this.ledgerRpc.trimLedgerEntries(actorUserId, corporationId, retentionDays)
	}

	async listAssessments(filters?: ListTaxAssessmentsFilters): Promise<TaxAssessment[]> {
		return this.ledgerRpc.listAssessments(filters)
	}

	async runAssessmentForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		return this.ledgerRpc.runAssessmentForPeriod(actorUserId, input)
	}

	async rebuildFinalizedRollupsForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		return this.ledgerRpc.rebuildFinalizedRollupsForPeriod(actorUserId, input)
	}

	async listAssessmentLines(filters: ListTaxAssessmentLinesFilters): Promise<TaxAssessmentLine[]> {
		return this.ledgerRpc.listAssessmentLines(filters)
	}

	async listDiscrepancies(filters: ListTaxDiscrepanciesFilters): Promise<TaxDiscrepancy[]> {
		return this.ledgerRpc.listDiscrepancies(filters)
	}

	async createBillsForAssessment(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		return this.billingRpc.createBillsForAssessment(actorUserId, corporationId, assessmentId)
	}

	async issueBillsForPeriod(
		actorUserId: string,
		input: IssueBillsForPeriodInput
	): Promise<IssueBillsForPeriodResult> {
		return this.billingRpc.issueBillsForPeriod(actorUserId, input)
	}

	async syncAssessmentBillStatus(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		return this.billingRpc.syncAssessmentBillStatus(actorUserId, corporationId, assessmentId)
	}

	async retractAssessmentBill(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		return this.billingRpc.retractAssessmentBill(actorUserId, corporationId, assessmentId)
	}

	async getCorporationBillStatusHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxAssessmentWithBillHistory[]> {
		return this.billingRpc.getCorporationBillStatusHistory(corporationId, limit, offset)
	}

	async getCorporationBillEventHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxPagedResult<TaxBillingEventHistoryRow>> {
		return this.billingRpc.getCorporationBillEventHistory(corporationId, limit, offset)
	}

	async getAssessmentBillStatusHistory(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessmentWithBillHistory | null> {
		return this.billingRpc.getAssessmentBillStatusHistory(corporationId, assessmentId)
	}

	async syncCorporationBillStatuses(
		actorUserId: string,
		corporationId: string,
		limit?: number
	): Promise<SyncCorporationBillStatusesResult> {
		return this.billingRpc.syncCorporationBillStatuses(actorUserId, corporationId, limit)
	}

	async syncBillStatus(
		actorUserId: string,
		billState: TaxBillStateSyncInput
	): Promise<SyncBillStatusesByBillIdsResult> {
		return this.billingRpc.syncBillStatus(actorUserId, billState)
	}

	async listCorporationBillingConfigs(
		corporationId: string
	): Promise<TaxCorporationBillingConfig[]> {
		return this.billingRpc.listCorporationBillingConfigs(corporationId)
	}

	async createCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		input: CreateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		return this.billingRpc.createCorporationBillingConfig(actorUserId, corporationId, input)
	}

	async updateCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string,
		input: UpdateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		return this.billingRpc.updateCorporationBillingConfig(
			actorUserId,
			corporationId,
			configId,
			input
		)
	}

	async deleteCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<void> {
		return this.billingRpc.deleteCorporationBillingConfig(actorUserId, corporationId, configId)
	}

	async setDefaultCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<TaxCorporationBillingConfig> {
		return this.billingRpc.setDefaultCorporationBillingConfig(actorUserId, corporationId, configId)
	}

	async getSummaryReport(filters?: TaxRollupReportFilters): Promise<TaxSummaryReport> {
		return this.rpcGuard('getSummaryReport', { filters: this.summarizeForLog(filters) }, () =>
			this.reportsRpc.getSummaryReport(filters)
		)
	}

	async getTotalTaxesByCorporationReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>> {
		return this.reportsRpc.getTotalTaxesByCorporationReport(filters)
	}

	async getTopIncomeSourcesReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxTopIncomeSourceRow[]> {
		return this.reportsRpc.getTopIncomeSourcesReport(filters)
	}

	async getTopIncomeSourcesMonthlyReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxTopIncomeSourceMonthlyRow[]> {
		return this.reportsRpc.getTopIncomeSourcesMonthlyReport(filters)
	}

	async getEssPayoutReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxEssPayoutRow>> {
		return this.reportsRpc.getEssPayoutReport(filters)
	}

	async getComplianceOverTimeReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxCompliancePoint[]> {
		return this.reportsRpc.getComplianceOverTimeReport(filters)
	}

	async getTaxDiscrepancyReport(
		filters?: ListTaxDiscrepancyReportFilters
	): Promise<TaxPagedResult<TaxDiscrepancy>> {
		return this.reportsRpc.getTaxDiscrepancyReport(filters)
	}

	async getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>> {
		return this.reportsRpc.getMissingEsiKeysReport(filters)
	}

	async getBillStatusReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxBillStatusReportRow>> {
		return this.reportsRpc.getBillStatusReport(filters)
	}

	async getMemberSummaryReport(
		filters: TaxMemberSummaryReportFilters
	): Promise<TaxPagedResult<TaxMemberSummary>> {
		return this.rpcGuard('getMemberSummaryReport', { filters: this.summarizeForLog(filters) }, () =>
			this.reportsRpc.getMemberSummaryReport(filters)
		)
	}

	async requestExport(actorUserId: string, input: RequestTaxExportInput): Promise<TaxExportRecord> {
		return this.operationsRpc.requestExport(actorUserId, input)
	}

	async listExports(filters?: ListTaxExportsFilters): Promise<TaxExportRecord[]> {
		return this.operationsRpc.listExports(filters)
	}

	async getExportById(exportId: string): Promise<TaxExportRecord | null> {
		return this.operationsRpc.getExportById(exportId)
	}

	async getExportArtifact(exportId: string): Promise<TaxExportArtifact> {
		return this.operationsRpc.getExportArtifact(exportId)
	}

	async createExportSchedule(
		actorUserId: string,
		input: CreateTaxExportScheduleInput
	): Promise<TaxExportSchedule> {
		return this.operationsRpc.createExportSchedule(actorUserId, input)
	}

	async listExportSchedules(filters?: ListTaxExportSchedulesFilters): Promise<TaxExportSchedule[]> {
		return this.operationsRpc.listExportSchedules(filters)
	}

	async runScheduledOperations(
		actorUserId: string,
		asOf?: Date,
		exportScheduleLimit?: number,
		alertRetryLimit?: number
	): Promise<TaxScheduledOperationsResult> {
		return this.operationsRpc.runScheduledOperations(
			actorUserId,
			asOf,
			exportScheduleLimit,
			alertRetryLimit
		)
	}

	async triggerAlert(actorUserId: string, input: TriggerTaxAlertInput): Promise<TaxAlert> {
		return this.operationsRpc.triggerAlert(actorUserId, input)
	}

	async listAlerts(filters?: ListTaxAlertsFilters): Promise<TaxAlert[]> {
		return this.rpcGuard('listAlerts', { filters: this.summarizeForLog(filters) }, () =>
			this.operationsRpc.listAlerts(filters)
		)
	}

	async acknowledgeAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		return this.operationsRpc.acknowledgeAlert(actorUserId, alertId)
	}

	async resolveAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		return this.operationsRpc.resolveAlert(actorUserId, alertId)
	}

	async retryFailedAlertDeliveries(actorUserId: string, limit?: number): Promise<number> {
		return this.operationsRpc.retryFailedAlertDeliveries(actorUserId, limit)
	}

	async upsertNotificationDestination(
		actorUserId: string,
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination> {
		return this.operationsRpc.upsertNotificationDestination(actorUserId, input)
	}

	async listNotificationDestinations(
		filters?: ListTaxNotificationDestinationsFilters
	): Promise<TaxNotificationDestination[]> {
		return this.operationsRpc.listNotificationDestinations(filters)
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
		const [eligibleRows, attachedRuleRows, exclusionRows] = await Promise.all([
			this.db
				.select({ corporationId: managedCorporations.corporationId })
				.from(managedCorporations)
				.where(
					and(
						eq(managedCorporations.isActive, true),
						eq(managedCorporations.isMemberCorporation, true)
					)
				)
				.groupBy(managedCorporations.corporationId),
			this.db
				.select({ corporationId: taxRuleGroupAttachments.corporationId })
				.from(taxRuleGroupAttachments)
				.groupBy(taxRuleGroupAttachments.corporationId),
			this.db.query.taxCorporationExclusions.findMany({
				columns: { corporationId: true },
				limit: 10_000,
			}),
		])
		const excludedSet = new Set(exclusionRows.map((row) => row.corporationId))
		const attachedSet = new Set(attachedRuleRows.map((row) => row.corporationId))
		const ids = new Set<string>()
		for (const row of eligibleRows) {
			if (
				row.corporationId &&
				attachedSet.has(row.corporationId) &&
				!excludedSet.has(row.corporationId)
			) {
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

	private buildScheduledProjectionRefreshInput(
		corporationId: string,
		runAt: Date
	): TriggerTaxProjectionRefreshInput {
		const watermark = {
			// Force checkpoint freshness evaluation against current scheduled run time.
			// The projection planner will derive overlap from current checkpoint lastSeenAt.
			maxId: null,
			maxDate: runAt,
			fetchedCount: 1,
		}
		return {
			corporationId,
			upstreamRunId: `scheduled-${corporationId}-${runAt.toISOString()}`,
			triggeredAt: runAt,
			walletJournal: watermark,
			walletTransactions: watermark,
			// Static override: scheduled projection ingest remains corporation-wallet only.
			includeCharacterWallets: false,
		}
	}

	private async withCorporationIngestLock<T>(
		corporationId: string,
		run: () => Promise<T>
	): Promise<T> {
		const previousTail = this.corporationIngestLocks.get(corporationId) ?? Promise.resolve()
		let release: (() => void) | undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const lockTail = previousTail.then(() => gate)
		this.corporationIngestLocks.set(corporationId, lockTail)

		await previousTail

		try {
			return await run()
		} finally {
			release?.()
			if (this.corporationIngestLocks.get(corporationId) === lockTail) {
				this.corporationIngestLocks.delete(corporationId)
			}
		}
	}

	private getTaxProjectionRetryKey(corporationId: string): string {
		return `${TAX_PROJECTION_RETRY_KEY_PREFIX}${corporationId}`
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
		} catch (error) {
			this.logger.warn('[CorporationTaxDO] Failed to load corporation ESI auth status', {
				corporationId,
				...this.toSafeErrorLogDetails(error),
			})
			return null
		}
	}

	private async getWalletDivisions(corporationId: string): Promise<number[]> {
		try {
			const stub = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
			return await stub.getWalletDivisions(corporationId)
		} catch (error) {
			this.logger.warn('[CorporationTaxDO] Failed to load wallet divisions', {
				corporationId,
				...this.toSafeErrorLogDetails(error),
			})
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
		try {
			const url = new URL(request.url)

			if (url.pathname === '/health') {
				return Response.json(await this.getHealth())
			}

			return new Response('Corporation Tax Durable Object - Use RPC methods', { status: 200 })
		} catch (error) {
			this.logger.error('[CorporationTaxDO] fetch handler failed', {
				...this.toSafeErrorLogDetails(error),
				requestUrl: request.url,
				requestMethod: request.method,
			})
			throw error
		}
	}

	private toAuditPayload(value: unknown): Record<string, unknown> | null {
		if (!value || typeof value !== 'object') {
			return null
		}
		const payload = { ...(value as Record<string, unknown>) }
		for (const key of ['createdAt', 'updatedAt']) {
			const field = payload[key]
			if (field instanceof Date) {
				payload[key] = field.toISOString()
			}
		}
		return payload
	}
}
