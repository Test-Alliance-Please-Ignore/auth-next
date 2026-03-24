export interface CorporationTaxHealth {
	status: 'ok'
	service: 'corporation-tax'
	timestamp: string
}

export interface TaxCorporationEsiAuthStatus {
	isConfigured: boolean
	isVerified: boolean
	lastVerified: Date | null
	directorCount: number
	healthyDirectorCount: number
	requiredScopes: string[]
	missingRequiredScopes: string[]
	hasRequiredScopes: boolean
	hasCorporationWalletScope: boolean
	hasCharacterWalletScope: boolean
	hasCorporationMembershipScope: boolean
	grantedScopeCount: number
}

export interface TaxCorporationExclusion {
	corporationId: string
	reason: string | null
	createdBy: string
	updatedBy: string
	createdAt: Date
	updatedAt: Date
}

export interface UpsertTaxCorporationExclusionInput {
	reason?: string | null
}

export interface ListTaxCorporationExclusionsFilters {
	limit?: number
	offset?: number
}

export interface TaxAuditLogEntry {
	id: string
	corporationId: string | null
	actorUserId: string
	action: string
	before: Record<string, unknown> | null
	after: Record<string, unknown> | null
	createdAt: Date
}

export interface ListTaxAuditLogFilters {
	corporationId?: string
	actorUserId?: string
	action?: string
	fromDate?: Date
	toDate?: Date
	limit?: number
	offset?: number
}

export interface TaxRuleSet {
	id: string
	ruleGroupId: string
	name: string
	priority: number
	isActive: boolean
	appliesToRefType: string | null
	taxRateBps: number
	createdBy: string
	createdAt: Date
	updatedAt: Date
}

export interface TaxRuleGroup {
	id: string
	name: string
	description: string | null
	isDefaultGlobal: boolean
	isSystem: boolean
	createdBy: string
	createdAt: Date
	updatedAt: Date
}

export interface TaxRuleGroupAttachment {
	id: string
	ruleGroupId: string
	corporationId: string
	isExcluded?: boolean
	exclusionReason?: string | null
	createdAt: Date
	updatedAt: Date
}

export interface CreateTaxRuleGroupInput {
	name: string
	description?: string | null
}

export interface UpdateTaxRuleGroupInput {
	name?: string
	description?: string | null
}

export interface ListTaxRuleGroupsFilters {
	corporationId?: string
	limit?: number
	offset?: number
}

export interface CreateTaxRuleSetInput {
	ruleGroupId: string
	name: string
	priority?: number
	isActive?: boolean
	appliesToRefType?: string | null
	taxRateBps: number
}

export interface ListTaxRuleSetsFilters {
	ruleGroupId?: string
	corporationId?: string
	includeGlobal?: boolean
	limit?: number
	offset?: number
}

export interface UpdateTaxRuleSetInput {
	name?: string
	priority?: number
	isActive?: boolean
	appliesToRefType?: string | null
	taxRateBps?: number
}

export type TaxAssessmentScope = 'corporation' | 'division' | 'character'
export type TaxAssessmentStatus = 'draft' | 'underpaid' | 'paid' | 'overpaid' | 'excluded'
export type TaxBillStatus = 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue'
export type TaxPeriodStatus = 'open' | 'assessed' | 'closed'

export interface TaxAssessment {
	id: string
	corporationId: string
	taxPeriodStart: Date
	taxPeriodEnd: Date
	assessmentScope: TaxAssessmentScope
	scopeId: string
	taxableIncome: string
	nonTaxableIncome: string
	taxDue: string
	taxDelta: string
	status: TaxAssessmentStatus
	inGameTaxRateBps: number | null
	billId: string | null
	billStatus: TaxBillStatus | null
	billStatusLastSyncedAt: Date | null
	approvedBy: string | null
	approvedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface TaxPeriod {
	id: string
	corporationId: string
	periodStart: Date
	periodEnd: Date
	status: TaxPeriodStatus
	closedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface TaxAssessmentLine {
	id: string
	assessmentId: string
	ledgerEntryId: string
	appliedRuleSetId: string | null
	taxRateBps: number
	taxableAmount: string
	taxAmount: string
	classification: string
	createdAt: Date
	updatedAt: Date
}

export interface TaxDiscrepancy {
	id: string
	corporationId: string
	assessmentId: string | null
	discrepancyType: string
	severity: string
	details: Record<string, unknown> | null
	resolvedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface ListTaxAssessmentsFilters {
	corporationId?: string
	status?: TaxAssessmentStatus
	assessmentScope?: TaxAssessmentScope
	withBillOnly?: boolean
	periodStart?: Date
	periodEnd?: Date
	limit?: number
	offset?: number
}

export interface RunTaxAssessmentForPeriodInput {
	corporationId: string
	periodStart: Date
	periodEnd: Date
	includeCharacterWallets?: boolean
}

export interface RunTaxAssessmentForPeriodResult {
	assessment: TaxAssessment
	period: TaxPeriod
	lineCount: number
	discrepancyCount: number
	divisionSummaries: TaxDivisionAssessmentSummary[]
	refTypeSummaries: TaxRefTypeAssessmentSummary[]
}

export interface TaxDivisionAssessmentSummary {
	division: number | null
	taxableIncome: string
	nonTaxableIncome: string
	taxDue: string
	taxPaid: string
	taxDelta: string
	status: TaxAssessmentStatus
}

export interface TaxRefTypeAssessmentSummary {
	refType: string
	taxableIncome: string
	nonTaxableIncome: string
	taxDue: string
	taxPaid: string
	taxDelta: string
	status: TaxAssessmentStatus
}

export interface ListTaxAssessmentLinesFilters {
	corporationId: string
	assessmentId: string
	limit?: number
	offset?: number
}

export interface ListTaxDiscrepanciesFilters {
	corporationId: string
	assessmentId?: string
	onlyOpen?: boolean
	limit?: number
	offset?: number
}

export interface TaxBillTimelineEvent {
	id: string
	billId: string
	eventType: string
	fromStatus: string | null
	toStatus: string | null
	actorUserId: string | null
	metadata: Record<string, string | number | boolean | null> | null
	createdAt: Date
}

export interface TaxBillSyncEvent {
	id: string
	corporationId: string
	assessmentId: string
	billId: string
	eventType: string
	fromStatus: string | null
	toStatus: string | null
	payload: Record<string, string | number | boolean | null> | null
	syncedAt: Date
}

export interface TaxAssessmentWithBillHistory {
	assessment: TaxAssessment
	timeline: TaxBillTimelineEvent[]
}

export interface TaxBillingEventHistoryRow {
	id: string
	billId: string
	assessmentId: string
	eventType: string
	fromStatus: string | null
	toStatus: string | null
	actorUserId: string | null
	metadata: Record<string, string | number | boolean | null> | null
	createdAt: Date
}

export interface IssueBillsForPeriodInput {
	corporationId: string
	periodStart: Date
	periodEnd: Date
}

export interface IssueBillsForPeriodResult {
	corporationId: string
	periodStart: Date
	periodEnd: Date
	issuedAssessmentIds: string[]
	skippedAssessmentIds: string[]
}

export interface SyncCorporationBillStatusesResult {
	corporationId: string
	processedAssessmentIds: string[]
	updatedAssessmentIds: string[]
	skippedAssessmentIds: string[]
}

export interface TaxBillStateSyncInput {
	id: string
	status: TaxBillStatus
}

export interface SyncBillStatusesByBillIdsResult {
	processedBillIds: string[]
	processedAssessmentIds: string[]
	updatedAssessmentIds: string[]
	skippedAssessmentIds: string[]
	corporationIds: string[]
}

export type TaxBillingPayeeType = 'character' | 'corporation'

export interface TaxCorporationBillingConfig {
	id: string
	corporationId: string
	isDefault: boolean
	billingEnabled: boolean
	billingIssuerUserId: string
	billingPayeeId: string
	billingPayeeType: TaxBillingPayeeType
	billingDueDays: number
	createdAt: Date
	updatedAt: Date
}

export interface CreateTaxCorporationBillingConfigInput {
	isDefault?: boolean
	billingEnabled?: boolean
	billingIssuerUserId?: string
	billingPayeeId?: string
	billingPayeeType?: TaxBillingPayeeType
	billingDueDays?: number
}

export interface UpdateTaxCorporationBillingConfigInput {
	isDefault?: boolean
	billingEnabled?: boolean
	billingIssuerUserId?: string
	billingPayeeId?: string
	billingPayeeType?: TaxBillingPayeeType
	billingDueDays?: number
}

export type TaxLedgerDirection = 'inflow' | 'outflow' | 'neutral'
export type TaxLedgerSourceType =
	| 'corporation_wallet_journal'
	| 'corporation_wallet_transaction'
	| 'character_wallet_journal'
	| 'character_wallet_transaction'

export interface TaxLedgerEntry {
	id: string
	corporationId: string
	sourceType: string
	sourcePrimaryId: string
	sourceSecondaryId: string | null
	characterId: string | null
	division: number | null
	refType: string
	amount: string
	balance: string | null
	direction: TaxLedgerDirection
	firstPartyId: string | null
	secondPartyId: string | null
	entryDate: Date
	createdAt: Date
	updatedAt: Date
}

export interface TaxLedgerParty {
	entityId: string
	senderCount: number
	recipientCount: number
	lastSeenAt: Date
}

export interface TaxSyncCheckpoint {
	id: string
	corporationId: string
	sourceType: TaxLedgerSourceType
	cursor: string | null
	lastSeenAt: Date | null
	lastSuccessfulSyncAt: Date | null
	lastError: string | null
	createdAt: Date
	updatedAt: Date
}

export interface TaxLedgerIngestionHealth {
	ready: boolean
	lastEntryUpdatedAt: Date | null
	checkpoints: TaxSyncCheckpoint[]
	message: string
}

export interface TaxLedgerWindowFilters {
	division?: number
	sourceTypes?: TaxLedgerSourceType[]
	characterId?: string
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	fromDate?: Date
	toDate?: Date
	minAmount?: string
	maxAmount?: string
	limit?: number
	offset?: number
}

export interface ListTaxLedgerPartiesFilters {
	fromDate?: Date
	toDate?: Date
	limit?: number
}

export interface IngestTaxLedgerWindowInput extends TaxLedgerWindowFilters {
	includeJournal?: boolean
	includeTransactions?: boolean
	includeCharacterWallets?: boolean
	memberCharacterIds?: string[]
	maxMemberCharacters?: number
}

export interface TaxLedgerIngestionResult {
	corporationId: string
	journalProcessed: number
	transactionProcessed: number
	upsertedCount: number
	checkpointsUpdated: number
	essDuplicateRecordCount: number
	essDuplicateSourceKeys: string[]
	essMissingRecordCount: number
	essMissingSourceKeys: string[]
	unexpectedIncomeRefTypeCount: number
	unexpectedIncomeEntryCount: number
	unexpectedIncomeRefTypes: Array<{
		refType: string
		entryCount: number
		sampleSourceType: TaxLedgerSourceType
		sampleSourceKey: string
		sampleAmount: string
		sampleEntryDate: Date
	}>
}

export interface TaxWalletSourceWatermark {
	maxId: string | null
	maxDate: Date | null
	fetchedCount: number
}

export interface TriggerTaxProjectionRefreshInput {
	corporationId: string
	upstreamRunId: string
	triggeredAt: Date
	walletJournal?: TaxWalletSourceWatermark | null
	walletTransactions?: TaxWalletSourceWatermark | null
	includeCharacterWallets?: boolean
}

export interface TriggerTaxProjectionRefreshResult {
	corporationId: string
	triggered: boolean
	reason: 'no_sources' | 'up_to_date' | 'ingested' | 'rule_mutation' | 'not_processable'
	ingestionResult?: TaxLedgerIngestionResult
}

export interface TaxLedgerRetentionResult {
	corporationId: string
	retentionDays: number
	cutoffDate: Date
	deletedEntryCount: number
}

export interface TaxReportWindowFilters {
	corporationId?: string
	fromDate?: Date
	toDate?: Date
	division?: number
	refType?: string
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	minAmount?: string
	limit?: number
	offset?: number
	sortBy?: string
	sortDirection?: 'asc' | 'desc'
}

export interface TaxRollupReportFilters {
	corporationId?: string
	fromDate?: Date
	toDate?: Date
	limit?: number
	offset?: number
	sortBy?: string
	sortDirection?: 'asc' | 'desc'
}

export interface TaxPagedResult<TRow> {
	rows: TRow[]
	totalRows: number
}

export interface TaxSummaryReport {
	corporationId: string | null
	fromDate: Date | null
	toDate: Date | null
	assessmentCount: number
	discrepancyOpenCount: number
	includedCorporationCount: number
	excludedCorporationCount: number
	billedAssessmentCount: number
	taxableIncome: string
	taxDue: string
	taxPaid: string
	taxDelta: string
	essIncome: string
	essTransferCount: number
}

export interface TaxTotalTaxesByCorporationRow {
	corporationId: string
	taxableItemCount: number
	assessmentCount: number
	billedAssessmentCount: number
	underpaidCount: number
	paidCount: number
	overpaidCount: number
	draftCount: number
	excludedCount: number
	taxableIncome: string
	taxDue: string
	taxPaid: string
	taxDelta: string
	taxDueCenti: string
	taxPaidCenti: string
	taxDeltaCenti: string
	lastAssessmentAt: Date | null
}

export interface TaxTopIncomeSourceRow {
	refType: string
	entryCount: number
	essEntryCount: number
	totalIncome: string
}

export interface TaxTopIncomeSourceMonthlyRow {
	monthStart: Date
	refType: string
	entryCount: number
	essEntryCount: number
	totalIncome: string
}

export interface TaxEssPayoutRow {
	id: string
	corporationId: string
	entryDate: Date
	division: number | null
	amount: string
	sourceType: string
	sourcePrimaryId: string
	firstPartyId: string | null
	secondPartyId: string | null
}

export interface TaxCompliancePoint {
	rollupDate: Date
	taxDue: string
	taxPaid: string
	taxDelta: string
	entryCount: number
}

export interface TaxMissingEsiKeyRow {
	corporationId: string
	isConfigured: boolean
	hasRequiredScopes: boolean
	hasCorporationWalletScope: boolean
	missingRequiredScopes: string[]
	directorCount: number
	healthyDirectorCount: number
	lastVerified: Date | null
}

export interface TaxBillStatusReportRow {
	assessmentId: string
	corporationId: string
	taxPeriodStart: Date
	taxPeriodEnd: Date
	billId: string | null
	billStatus: TaxBillStatus | 'unbilled'
	issueDate: Date | null
	dueDate: Date | null
	taxDue: string
	taxPaid: string
	taxDelta: string
	taxDueCenti: string
	taxPaidCenti: string
	taxDeltaCenti: string
}

export type TaxMemberComplianceStatus = 'underpaid' | 'paid' | 'overpaid' | 'no_data'

export interface TaxMemberSummaryTopRefType {
	refType: string
	lineCount: number
	contributionAmount?: string
	taxableAmount: string
	taxAmount: string
}

export interface TaxMemberSummary {
	corporationId: string
	characterId: string
	fromDate: Date | null
	toDate: Date | null
	assessmentCount: number
	contributionIncome: string
	taxableContributionIncome: string
	lastAssessmentAt: Date | null
	topRefTypes: TaxMemberSummaryTopRefType[]
}

export interface TaxMemberSummaryReportFilters {
	corporationId: string
	characterIds?: string[]
	fromDate?: Date
	toDate?: Date
	topRefTypesLimit?: number
	limit?: number
	offset?: number
	sortBy?:
		| 'characterId'
		| 'contributionIncome'
		| 'taxableContributionIncome'
		| 'assessmentCount'
		| 'lastAssessmentAt'
	sortDirection?: 'asc' | 'desc'
}

export interface ListTaxDiscrepancyReportFilters {
	corporationId?: string
	fromDate?: Date
	toDate?: Date
	onlyOpen?: boolean
	limit?: number
	offset?: number
	sortBy?: string
	sortDirection?: 'asc' | 'desc'
}

export interface ListTaxMissingEsiKeyReportFilters {
	limit?: number
	offset?: number
	sortBy?: string
	sortDirection?: 'asc' | 'desc'
}

export type TaxExportFormat = 'csv' | 'xlsx'
export type TaxExportStatus = 'queued' | 'running' | 'completed' | 'failed'
export type TaxExportFrequency = 'weekly' | 'monthly'
export type TaxExportReportType =
	| 'summary'
	| 'total_taxes_by_corporation'
	| 'top_income_sources'
	| 'ess_payout'
	| 'compliance_over_time'
	| 'discrepancies'
	| 'bill_status'

export interface RequestTaxExportInput {
	corporationId?: string
	format: TaxExportFormat
	reportType: TaxExportReportType
	filters?: Record<string, unknown> | null
	sourceEsiVersion?: string | null
}

export interface ListTaxExportsFilters {
	corporationId?: string
	format?: TaxExportFormat
	status?: TaxExportStatus
	limit?: number
	offset?: number
}

export interface TaxExportRecord {
	id: string
	corporationId: string | null
	requestedByUserId: string
	format: TaxExportFormat
	reportType: TaxExportReportType
	status: TaxExportStatus
	filters: Record<string, unknown> | null
	rowCount: number | null
	sourceEsiVersion: string | null
	error: string | null
	requestedAt: Date
	completedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface TaxExportArtifact {
	exportId: string
	corporationId: string | null
	reportType: TaxExportReportType
	requestedFormat: TaxExportFormat
	deliveredFormat: 'csv'
	fileName: string
	contentType: string
	contentBase64: string
	rowCount: number
	generatedAt: Date
	note: string | null
}

export interface CreateTaxExportScheduleInput {
	name: string
	corporationId?: string
	format: TaxExportFormat
	frequency: TaxExportFrequency
	reportType: TaxExportReportType
	filters?: Record<string, unknown> | null
	nextRunAt?: Date
	isActive?: boolean
}

export interface ListTaxExportSchedulesFilters {
	corporationId?: string
	activeOnly?: boolean
	limit?: number
	offset?: number
}

export interface TaxExportSchedule {
	id: string
	name: string
	corporationId: string | null
	createdByUserId: string
	format: TaxExportFormat
	frequency: TaxExportFrequency
	reportType: TaxExportReportType
	filters: Record<string, unknown> | null
	isActive: boolean
	nextRunAt: Date
	lastRunAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface TaxScheduledOperationsResult {
	asOf: Date
	includedCorporationCount: number
	dailyIngestCorporationsProcessed: number
	dailyIngestFailures: number
	monthlyAssessmentCorporationsProcessed: number
	monthlyAssessmentFailures: number
	ledgerRetentionCorporationsProcessed: number
	ledgerRetentionFailures: number
	ledgerRetentionEntriesDeleted: number
	dueExportSchedulesProcessed: number
	failedAlertDeliveriesRetried: number
}

export type TaxAlertSeverity = 'critical' | 'warning' | 'info'
export type TaxAlertStatus = 'open' | 'acknowledged' | 'resolved'
export type TaxAlertDiscordDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface TaxAlert {
	id: string
	corporationId: string | null
	alertType: string
	severity: TaxAlertSeverity
	status: TaxAlertStatus
	dedupeKey: string
	payload: Record<string, unknown> | null
	firstTriggeredAt: Date
	lastTriggeredAt: Date
	acknowledgedAt: Date | null
	acknowledgedByUserId: string | null
	resolvedAt: Date | null
	resolvedByUserId: string | null
	discordDeliveryStatus: TaxAlertDiscordDeliveryStatus
	discordAttemptCount: number
	discordLastAttemptAt: Date | null
	discordLastError: string | null
	nextRetryAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface TriggerTaxAlertInput {
	corporationId?: string | null
	alertType: string
	severity: TaxAlertSeverity
	dedupeKey: string
	payload?: Record<string, unknown> | null
}

export interface ListTaxAlertsFilters {
	corporationId?: string
	status?: TaxAlertStatus
	severity?: TaxAlertSeverity
	limit?: number
	offset?: number
}

export interface TaxNotificationDestination {
	id: string
	name: string
	guildId: string
	channelId: string
	createdByUserId: string
	updatedByUserId: string
	createdAt: Date
	updatedAt: Date
}

export interface UpsertTaxNotificationDestinationInput {
	name: string
	guildId: string
	channelId: string
}

export interface ListTaxNotificationDestinationsFilters {
	limit?: number
	offset?: number
}
