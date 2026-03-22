/**
 * @repo/corporation-tax
 *
 * Shared types and interfaces for the Corporation Tax Durable Object.
 */

import type {
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
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAlertDiscordDeliveryStatus,
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxAssessment,
	TaxAssessmentLine,
	TaxAssessmentScope,
	TaxAssessmentStatus,
	TaxAssessmentWithBillHistory,
	TaxAuditLogEntry,
	TaxBillingEventHistoryRow,
	TaxBillingPayeeType,
	TaxBillStatus,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationBillingConfig,
	TaxCorporationEsiAuthStatus,
	TaxCorporationExclusion,
	TaxDiscrepancy,
	TaxDivisionAssessmentSummary,
	TaxEssPayoutRow,
	TaxExportArtifact,
	TaxExportFormat,
	TaxExportFrequency,
	TaxExportRecord,
	TaxExportReportType,
	TaxExportSchedule,
	TaxExportStatus,
	TaxLedgerDirection,
	TaxLedgerEntry,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerParty,
	TaxLedgerRetentionResult,
	TaxLedgerSourceType,
	TaxLedgerWindowFilters,
	TaxMemberComplianceStatus,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMemberSummaryTopRefType,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxPeriod,
	TaxPeriodStatus,
	TaxRefTypeAssessmentSummary,
	TaxReportWindowFilters,
	TaxRollupReportFilters,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxScheduledOperationsResult,
	TaxSummaryReport,
	TaxSyncCheckpoint,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	TaxWalletSourceWatermark,
	TriggerTaxAlertInput,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	UpdateTaxCorporationBillingConfigInput,
	UpdateTaxRuleGroupInput,
	UpdateTaxRuleSetInput,
	UpsertTaxCorporationExclusionInput,
	UpsertTaxNotificationDestinationInput,
} from './types'

export {
	TAX_INCOME_REF_TYPES,
	filterTaxIncomeRefTypes,
	isTaxIncomeRefType,
	type TaxIncomeRefType,
} from './ref-types'

/**
 * Public RPC interface for Corporation Tax Durable Object.
 */
export interface CorporationTax {
	/**
	 * Health check for integration diagnostics.
	 */
	getHealth(): Promise<CorporationTaxHealth>

	/**
	 * Upsert a corporation exclusion row.
	 */
	upsertCorporationExclusion(
		actorUserId: string,
		corporationId: string,
		input: UpsertTaxCorporationExclusionInput
	): Promise<TaxCorporationExclusion>

	/**
	 * Remove a corporation exclusion row.
	 */
	deleteCorporationExclusion(actorUserId: string, corporationId: string): Promise<void>

	/**
	 * List configured corporation exclusions.
	 */
	listCorporationExclusions(
		filters?: ListTaxCorporationExclusionsFilters
	): Promise<TaxCorporationExclusion[]>

	/**
	 * List known wallet divisions for a corporation.
	 */
	listWalletDivisions(corporationId: string): Promise<number[]>

	/**
	 * List audit log records for taxation operations.
	 */
	listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxAuditLogEntry[]>

	/**
	 * Create a tax rule group.
	 */
	createRuleGroup(actorUserId: string, input: CreateTaxRuleGroupInput): Promise<TaxRuleGroup>

	/**
	 * Update a tax rule group.
	 */
	updateRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		input: UpdateTaxRuleGroupInput
	): Promise<TaxRuleGroup>

	/**
	 * Delete a tax rule group.
	 */
	deleteRuleGroup(actorUserId: string, ruleGroupId: string): Promise<void>

	/**
	 * List tax rule groups.
	 */
	listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]>

	/**
	 * Attach a corporation to a rule group.
	 */
	attachCorporationToRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment>

	/**
	 * Detach a corporation from a rule group.
	 */
	detachCorporationFromRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<void>

	/**
	 * List corporation attachments for a rule group.
	 */
	listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]>

	/**
	 * Create a taxation rule set.
	 */
	createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet>

	/**
	 * Update a tax rule set.
	 */
	updateRuleSet(
		actorUserId: string,
		ruleSetId: string,
		input: UpdateTaxRuleSetInput
	): Promise<TaxRuleSet>

	/**
	 * Delete a tax rule set.
	 */
	deleteRuleSet(actorUserId: string, ruleSetId: string): Promise<void>

	/**
	 * List taxation rule sets.
	 */
	listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]>

	/**
	 * List tax assessments.
	 */
	listAssessments(filters?: ListTaxAssessmentsFilters): Promise<TaxAssessment[]>

	/**
	 * Compute or recompute corporation tax assessment for a period.
	 */
	runAssessmentForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult>

	/**
	 * Explicit closed-period finalized rollup rebuild/backfill command.
	 */
	rebuildFinalizedRollupsForPeriod(
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult>

	/**
	 * List assessment line items.
	 */
	listAssessmentLines(filters: ListTaxAssessmentLinesFilters): Promise<TaxAssessmentLine[]>

	/**
	 * List discrepancies for a corporation or assessment.
	 */
	listDiscrepancies(filters: ListTaxDiscrepanciesFilters): Promise<TaxDiscrepancy[]>

	/**
	 * Create or return bill for a corporation-scope assessment via external source idempotency.
	 */
	createBillsForAssessment(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment>

	/**
	 * Issue bills for billed corporation-scope assessments within a period window.
	 */
	issueBillsForPeriod(
		actorUserId: string,
		input: IssueBillsForPeriodInput
	): Promise<IssueBillsForPeriodResult>

	/**
	 * Sync one corporation-scope assessment's bill status from the bills domain.
	 */
	syncAssessmentBillStatus(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment>

	/**
	 * Retract (cancel) one corporation-scope assessment's linked bill in bills domain.
	 */
	retractAssessmentBill(
		actorUserId: string,
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment>

	/**
	 * Get bill status/timeline history for a corporation's corporation-scope assessments.
	 */
	getCorporationBillStatusHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxAssessmentWithBillHistory[]>

	/**
	 * Get billing-domain event history for a corporation's billed corporation-scope assessments.
	 */
	getCorporationBillEventHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxPagedResult<TaxBillingEventHistoryRow>>

	/**
	 * Get bill status/timeline history for one corporation-scope assessment.
	 */
	getAssessmentBillStatusHistory(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessmentWithBillHistory | null>

	/**
	 * Sync all billed corporation-scope assessments for a corporation from bills status.
	 */
	syncCorporationBillStatuses(
		actorUserId: string,
		corporationId: string,
		limit?: number
	): Promise<SyncCorporationBillStatusesResult>

	/**
	 * List billing configurations for a corporation.
	 */
	listCorporationBillingConfigs(corporationId: string): Promise<TaxCorporationBillingConfig[]>

	/**
	 * Create a billing configuration for a corporation.
	 */
	createCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		input: CreateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig>

	/**
	 * Update one billing configuration row.
	 */
	updateCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string,
		input: UpdateTaxCorporationBillingConfigInput
	): Promise<TaxCorporationBillingConfig>

	/**
	 * Delete one billing configuration row.
	 */
	deleteCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<void>

	/**
	 * Mark one billing configuration row as the corporation default.
	 */
	setDefaultCorporationBillingConfig(
		actorUserId: string,
		corporationId: string,
		configId: string
	): Promise<TaxCorporationBillingConfig>

	/**
	 * Ingest corporation wallet ledger data into tax ledger entries.
	 */
	ingestCorporationLedgerWindow(
		actorUserId: string,
		corporationId: string,
		input?: IngestTaxLedgerWindowInput
	): Promise<TaxLedgerIngestionResult>

	/**
	 * Trigger an incremental projection refresh from upstream wallet sync watermarks.
	 */
	triggerProjectionRefreshFromWalletSync(
		actorUserId: string,
		input: TriggerTaxProjectionRefreshInput
	): Promise<TriggerTaxProjectionRefreshResult>

	/**
	 * List tax ledger entries for a corporation.
	 */
	listLedgerEntries(
		corporationId: string,
		filters?: TaxLedgerWindowFilters
	): Promise<TaxLedgerEntry[]>

	/**
	 * List distinct sender/recipient entity IDs present in ledger entries.
	 */
	listLedgerParties(
		corporationId: string,
		filters?: ListTaxLedgerPartiesFilters
	): Promise<TaxLedgerParty[]>

	/**
	 * Ledger ingestion and checkpoint health for a corporation.
	 */
	getLedgerIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth>

	/**
	 * Trim detailed ledger records older than the retention window.
	 */
	trimLedgerEntries(
		actorUserId: string,
		corporationId: string,
		retentionDays?: number
	): Promise<TaxLedgerRetentionResult>

	/**
	 * Summary dashboard report for selected scope and window.
	 */
	getSummaryReport(filters?: TaxRollupReportFilters): Promise<TaxSummaryReport>

	/**
	 * Aggregate taxes due/paid by corporation.
	 */
	getTotalTaxesByCorporationReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>>

	/**
	 * Top income sources grouped by ref_type.
	 */
	getTopIncomeSourcesReport(filters?: TaxRollupReportFilters): Promise<TaxTopIncomeSourceRow[]>

	/**
	 * Taxable inflow grouped by ref_type and month.
	 */
	getTopIncomeSourcesMonthlyReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxTopIncomeSourceMonthlyRow[]>

	/**
	 * ESS transfer report.
	 */
	getEssPayoutReport(filters?: TaxRollupReportFilters): Promise<TaxPagedResult<TaxEssPayoutRow>>

	/**
	 * Tax compliance trend points over time.
	 */
	getComplianceOverTimeReport(filters?: TaxRollupReportFilters): Promise<TaxCompliancePoint[]>

	/**
	 * Tax discrepancy report with optional open-only filtering.
	 */
	getTaxDiscrepancyReport(
		filters?: ListTaxDiscrepancyReportFilters
	): Promise<TaxPagedResult<TaxDiscrepancy>>

	/**
	 * Corporations missing ESI key coverage or required scopes.
	 */
	getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>>

	/**
	 * Bill status rollup report for tax assessments.
	 */
	getBillStatusReport(
		filters?: TaxRollupReportFilters
	): Promise<TaxPagedResult<TaxBillStatusReportRow>>

	/**
	 * Member-level tax summary for one corporation.
	 */
	getMemberSummaryReport(filters: TaxMemberSummaryReportFilters): Promise<TaxMemberSummary[]>

	/**
	 * Request a tax report export run.
	 */
	requestExport(actorUserId: string, input: RequestTaxExportInput): Promise<TaxExportRecord>

	/**
	 * List export run history.
	 */
	listExports(filters?: ListTaxExportsFilters): Promise<TaxExportRecord[]>

	/**
	 * Get one export record by id.
	 */
	getExportById(exportId: string): Promise<TaxExportRecord | null>

	/**
	 * Get generated export artifact content for download.
	 */
	getExportArtifact(exportId: string): Promise<TaxExportArtifact>

	/**
	 * Create a recurring export schedule.
	 */
	createExportSchedule(
		actorUserId: string,
		input: CreateTaxExportScheduleInput
	): Promise<TaxExportSchedule>

	/**
	 * List export schedules.
	 */
	listExportSchedules(filters?: ListTaxExportSchedulesFilters): Promise<TaxExportSchedule[]>

	/**
	 * Run scheduled export + alert retry operations for the tax domain.
	 */
	runScheduledOperations(
		actorUserId: string,
		asOf?: Date,
		exportScheduleLimit?: number,
		alertRetryLimit?: number
	): Promise<TaxScheduledOperationsResult>

	/**
	 * Trigger or update a deduplicated alert.
	 */
	triggerAlert(actorUserId: string, input: TriggerTaxAlertInput): Promise<TaxAlert>

	/**
	 * List alerts.
	 */
	listAlerts(filters?: ListTaxAlertsFilters): Promise<TaxAlert[]>

	/**
	 * Acknowledge an alert.
	 */
	acknowledgeAlert(actorUserId: string, alertId: string): Promise<TaxAlert>

	/**
	 * Resolve an alert.
	 */
	resolveAlert(actorUserId: string, alertId: string): Promise<TaxAlert>

	/**
	 * Retry failed Discord deliveries for alert dispatches.
	 */
	retryFailedAlertDeliveries(actorUserId: string, limit?: number): Promise<number>

	/**
	 * Create or update a notification destination.
	 */
	upsertNotificationDestination(
		actorUserId: string,
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination>

	/**
	 * List configured notification destinations.
	 */
	listNotificationDestinations(
		filters?: ListTaxNotificationDestinationsFilters
	): Promise<TaxNotificationDestination[]>
}

export type {
	CorporationTaxHealth,
	CreateTaxCorporationBillingConfigInput,
	CreateTaxExportScheduleInput,
	CreateTaxRuleGroupInput,
	CreateTaxRuleSetInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	IngestTaxLedgerWindowInput,
	ListTaxAlertsFilters,
	ListTaxAuditLogFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxDiscrepancyReportFilters,
	ListTaxMissingEsiKeyReportFilters,
	ListTaxNotificationDestinationsFilters,
	ListTaxAssessmentLinesFilters,
	ListTaxLedgerPartiesFilters,
	ListTaxAssessmentsFilters,
	ListTaxRuleSetsFilters,
	ListTaxRuleGroupsFilters,
	ListTaxCorporationExclusionsFilters,
	ListTaxDiscrepanciesFilters,
	RequestTaxExportInput,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAuditLogEntry,
	TaxAlertDiscordDeliveryStatus,
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxAssessmentLine,
	TaxDivisionAssessmentSummary,
	TaxDiscrepancy,
	TaxRefTypeAssessmentSummary,
	TaxPeriod,
	TaxPeriodStatus,
	TaxLedgerEntry,
	TaxLedgerParty,
	TaxLedgerDirection,
	TaxLedgerSourceType,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerRetentionResult,
	TaxLedgerWindowFilters,
	TaxAssessment,
	TaxBillingEventHistoryRow,
	TaxAssessmentScope,
	TaxAssessmentStatus,
	TaxAssessmentWithBillHistory,
	TaxExportFormat,
	TaxExportArtifact,
	TaxExportFrequency,
	TaxExportRecord,
	TaxExportReportType,
	TaxExportSchedule,
	TaxExportStatus,
	TaxBillStatusReportRow,
	TaxBillStatus,
	TaxBillingPayeeType,
	TaxCorporationEsiAuthStatus,
	TaxCompliancePoint,
	TaxCorporationBillingConfig,
	TaxCorporationExclusion,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxScheduledOperationsResult,
	TaxSyncCheckpoint,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	TaxWalletSourceWatermark,
	TaxEssPayoutRow,
	TaxMissingEsiKeyRow,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMemberComplianceStatus,
	TaxRollupReportFilters,
	TaxReportWindowFilters,
	TaxMemberSummaryTopRefType,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	TriggerTaxAlertInput,
	UpdateTaxCorporationBillingConfigInput,
	UpdateTaxRuleGroupInput,
	UpdateTaxRuleSetInput,
	UpsertTaxNotificationDestinationInput,
	UpsertTaxCorporationExclusionInput,
} from './types'
