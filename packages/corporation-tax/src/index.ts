/**
 * @repo/corporation-tax
 *
 * Shared types and interfaces for the Corporation Tax Durable Object.
 */

import type {
	CorporationTaxHealth,
	CreateTaxExportScheduleInput,
	CreateTaxRuleSetInput,
	IngestTaxLedgerWindowInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	ListTaxAlertsFilters,
	ListTaxAssessmentLinesFilters,
	ListTaxAssessmentsFilters,
	ListTaxAuditLogFilters,
	ListTaxCorporationSettingsFilters,
	ListTaxDailyRollupsFilters,
	ListTaxDiscrepanciesFilters,
	ListTaxDiscrepancyReportFilters,
	ListTaxExcludedCorporationsReportFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxMissingEsiKeyReportFilters,
	ListTaxNotificationDestinationsFilters,
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
	TaxBillStatus,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationEsiAuthStatus,
	TaxCorporationSettings,
	TaxDailyRollup,
	TaxDiscrepancy,
	TaxDivisionAssessmentSummary,
	TaxEssPayoutRow,
	TaxExcludedCorporationRow,
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
	TaxLedgerRetentionResult,
	TaxLedgerSourceType,
	TaxLedgerWindowFilters,
	TaxMemberComplianceStatus,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMemberSummaryTopRefType,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPeriod,
	TaxPeriodStatus,
	TaxRefTypeAssessmentSummary,
	TaxReportWindowFilters,
	TaxRuleSet,
	TaxScheduledOperationsResult,
	TaxSummaryReport,
	TaxSyncCheckpoint,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	TaxWalletSourceWatermark,
	TriggerTaxAlertInput,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	UpsertTaxCorporationSettingsInput,
	UpsertTaxNotificationDestinationInput,
} from './types'

/**
 * Public RPC interface for Corporation Tax Durable Object.
 */
export interface CorporationTax {
	/**
	 * Health check for integration diagnostics.
	 */
	getHealth(): Promise<CorporationTaxHealth>

	/**
	 * Get corporation taxation settings.
	 */
	getCorporationSettings(corporationId: string): Promise<TaxCorporationSettings | null>

	/**
	 * Create or update corporation taxation settings.
	 */
	upsertCorporationSettings(
		actorUserId: string,
		corporationId: string,
		input: UpsertTaxCorporationSettingsInput
	): Promise<TaxCorporationSettings>

	/**
	 * List corporation settings with optional filters.
	 */
	listCorporationSettings(
		filters?: ListTaxCorporationSettingsFilters
	): Promise<TaxCorporationSettings[]>

	/**
	 * List known wallet divisions for a corporation.
	 */
	listWalletDivisions(corporationId: string): Promise<number[]>

	/**
	 * List audit log records for taxation operations.
	 */
	listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxAuditLogEntry[]>

	/**
	 * Create a taxation rule set with conditions and actions.
	 */
	createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet>

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
	 * Get bill status/timeline history for a corporation's corporation-scope assessments.
	 */
	getCorporationBillStatusHistory(
		corporationId: string,
		limit?: number,
		offset?: number
	): Promise<TaxAssessmentWithBillHistory[]>

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
	 * Ledger ingestion and checkpoint health for a corporation.
	 */
	getLedgerIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth>

	/**
	 * Daily rollups generated from normalized ledger entries.
	 */
	listDailyRollups(
		corporationId: string,
		filters?: ListTaxDailyRollupsFilters
	): Promise<TaxDailyRollup[]>

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
	getSummaryReport(filters?: TaxReportWindowFilters): Promise<TaxSummaryReport>

	/**
	 * Aggregate taxes due/paid by corporation.
	 */
	getTotalTaxesByCorporationReport(
		filters?: TaxReportWindowFilters
	): Promise<TaxTotalTaxesByCorporationRow[]>

	/**
	 * Top income sources grouped by ref_type.
	 */
	getTopIncomeSourcesReport(filters?: TaxReportWindowFilters): Promise<TaxTopIncomeSourceRow[]>

	/**
	 * ESS transfer report.
	 */
	getEssPayoutReport(filters?: TaxReportWindowFilters): Promise<TaxEssPayoutRow[]>

	/**
	 * Tax compliance trend points over time.
	 */
	getComplianceOverTimeReport(filters?: TaxReportWindowFilters): Promise<TaxCompliancePoint[]>

	/**
	 * Tax discrepancy report with optional open-only filtering.
	 */
	getTaxDiscrepancyReport(filters?: ListTaxDiscrepancyReportFilters): Promise<TaxDiscrepancy[]>

	/**
	 * Corporations missing ESI key coverage or required scopes.
	 */
	getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxMissingEsiKeyRow[]>

	/**
	 * Excluded corporations and exclusion reasons.
	 */
	getExcludedCorporationsReport(
		filters?: ListTaxExcludedCorporationsReportFilters
	): Promise<TaxExcludedCorporationRow[]>

	/**
	 * Bill status rollup report for tax assessments.
	 */
	getBillStatusReport(filters?: TaxReportWindowFilters): Promise<TaxBillStatusReportRow[]>

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
	CreateTaxExportScheduleInput,
	CreateTaxRuleSetInput,
	IssueBillsForPeriodInput,
	IssueBillsForPeriodResult,
	IngestTaxLedgerWindowInput,
	ListTaxAlertsFilters,
	ListTaxAuditLogFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxDiscrepancyReportFilters,
	ListTaxExcludedCorporationsReportFilters,
	ListTaxMissingEsiKeyReportFilters,
	ListTaxNotificationDestinationsFilters,
	ListTaxAssessmentLinesFilters,
	ListTaxDailyRollupsFilters,
	ListTaxAssessmentsFilters,
	ListTaxRuleSetsFilters,
	ListTaxCorporationSettingsFilters,
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
	TaxDailyRollup,
	TaxLedgerEntry,
	TaxLedgerDirection,
	TaxLedgerSourceType,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerRetentionResult,
	TaxLedgerWindowFilters,
	TaxAssessment,
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
	TaxCorporationEsiAuthStatus,
	TaxCompliancePoint,
	TaxCorporationSettings,
	TaxNotificationDestination,
	TaxRuleSet,
	TaxScheduledOperationsResult,
	TaxSyncCheckpoint,
	TaxSummaryReport,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	TaxWalletSourceWatermark,
	TaxEssPayoutRow,
	TaxMissingEsiKeyRow,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMemberComplianceStatus,
	TaxExcludedCorporationRow,
	TaxReportWindowFilters,
	TaxMemberSummaryTopRefType,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	TriggerTaxAlertInput,
	UpsertTaxNotificationDestinationInput,
	UpsertTaxCorporationSettingsInput,
} from './types'
