import { isTaxDemoModeEnabled, resolveDemoEntityNames, taxDemoApi } from '@/dev/tax-demo-mode'

import { ApiClient } from './api'

import type {
	CreateTaxCorporationBillingConfigInput,
	IssueBillsForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxAssessment,
	TaxAssessmentWithBillHistory,
	TaxAuditLogEntry,
	TaxBillingEventHistoryRow,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationBillingConfig,
	TaxCorporationExclusion,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExportArtifact,
	TaxExportFormat,
	TaxExportRecord,
	TaxExportReportType,
	TaxExportSchedule,
	TaxExportStatus,
	TaxLedgerEntry,
	TaxMemberSummary,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	UpdateTaxCorporationBillingConfigInput,
} from '@repo/corporation-tax'
import type { TaxRollupReportQueryFilters } from '@/lib/tax-report-types'

const TAX_API_BASE = '/corporation-tax'

export interface ListTaxAlertsFilters {
	corporationId?: string
	status?: TaxAlertStatus
	severity?: TaxAlertSeverity
	limit?: number
	offset?: number
}

export interface TaxCapabilitiesResponse {
	corporationId: string | null
	global: {
		canRead: boolean
		canAudit: boolean
		canManage: boolean
	}
	scoped: {
		canRead: boolean
		canAudit: boolean
		canManage: boolean
	}
}

export interface TaxAuditActorSearchFilters {
	corporationId?: string
	q?: string
	ids?: string[]
	limit?: number
}

export interface TaxAuditActorSearchRow {
	userId: string
	name: string | null
}

export type TaxReportFilters = TaxRollupReportQueryFilters

export interface TaxMemberSummaryFilters {
	characterQuery?: string
	fromDate?: string
	toDate?: string
	topRefTypesLimit?: number
	limit?: number
	offset?: number
	sortBy?:
		| 'characterId'
		| 'contributionIncome'
		| 'taxableContributionIncome'
		| 'assessmentCount'
		| 'lastAssessmentAt'
	sortDir?: 'asc' | 'desc'
}

export interface TaxLedgerFilters {
	division?: number
	sourceTypes?: Array<
		| 'corporation_wallet_journal'
		| 'corporation_wallet_transaction'
		| 'character_wallet_journal'
		| 'character_wallet_transaction'
	>
	characterId?: string
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	fromDate?: string
	toDate?: string
	minAmount?: string
	maxAmount?: string
	limit?: number
	offset?: number
}

export interface TaxLedgerPartySearchFilters {
	fromDate?: string
	toDate?: string
	limit?: number
	q?: string
	direction?: 'any' | 'sender' | 'recipient'
}

export interface TaxLedgerPartySearchRow {
	entityId: string
	entityName: string | null
	lastSeenAt: Date
}

export interface ListTaxExportsFilters {
	corporationId?: string
	format?: TaxExportFormat
	status?: TaxExportStatus
	limit?: number
	offset?: number
}

export interface ListTaxExportSchedulesFilters {
	corporationId?: string
	activeOnly?: boolean
	limit?: number
	offset?: number
}

export interface ListTaxDiscrepancyReportFilters {
	corporationId?: string
	fromDate?: string
	toDate?: string
	onlyOpen?: boolean
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export interface ListTaxMissingEsiKeyReportFilters {
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export interface TaxCorporationScopeRow {
	corporationId: string
	included: boolean
	exclusionReason: string | null
	createdAt: Date
	updatedAt: Date
}

export interface ListTaxCorporationScopeFilters {
	limit?: number
	offset?: number
}

export interface TaxBillingPayeeCorporationSearchRow {
	corporationId: string
	name: string | null
}

export interface TaxBillingPayeeCharacterSearchRow {
	characterId: string
	characterName: string
}

export interface UpsertTaxExclusionInput {
	reason: string | null
}

export interface ListTaxRuleSetsFilters {
	corporationId?: string
	ruleGroupId?: string
	limit?: number
	offset?: number
}

export interface ListTaxRuleGroupsFilters {
	corporationId?: string
	limit?: number
	offset?: number
}

export interface ListTaxAssessmentsFilters {
	status?: 'draft' | 'underpaid' | 'paid' | 'overpaid' | 'excluded'
	assessmentScope?: 'corporation' | 'division' | 'character'
	withBillOnly?: boolean
	limit?: number
	offset?: number
}

export interface CreateTaxRuleSetInput {
	ruleGroupId: string
	name: string
	priority?: number
	isActive?: boolean
	appliesToRefType?: string
	taxRateBps: number
}

export interface CreateTaxRuleGroupInput {
	name: string
	description?: string | null
}

export interface ListTaxAuditLogFilters {
	corporationId?: string
	actorUserId?: string
	action?: string
	fromDate?: string
	toDate?: string
	limit?: number
	offset?: number
}

export interface ListTaxNotificationDestinationsFilters {
	limit?: number
	offset?: number
}

export interface UpsertTaxNotificationDestinationInput {
	name: string
	guildId: string
	channelId: string
}

export interface CreateBillingConfigInput extends CreateTaxCorporationBillingConfigInput {}
export interface UpdateBillingConfigInput extends UpdateTaxCorporationBillingConfigInput {}

export class CorporationTaxApiClient extends ApiClient {
	private shouldUseDemo(): boolean {
		return isTaxDemoModeEnabled()
	}

	private appendTaxReportFilters(params: URLSearchParams, filters?: TaxReportFilters): void {
		if (!filters) {
			return
		}
		if (filters.corporationId) params.set('corporationId', filters.corporationId)
		if (filters.fromDate) params.set('fromDate', filters.fromDate)
		if (filters.toDate) params.set('toDate', filters.toDate)
		if (filters.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters.offset !== undefined) params.set('offset', String(filters.offset))
		if (filters.sortBy) params.set('sortBy', filters.sortBy)
		if (filters.sortDir) params.set('sortDir', filters.sortDir)
	}

	async getCapabilities(corporationId?: string): Promise<TaxCapabilitiesResponse> {
		if (this.shouldUseDemo()) return taxDemoApi.getCapabilities(corporationId)
		const params = new URLSearchParams()
		if (corporationId) params.set('corporationId', corporationId)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/capabilities${query ? `?${query}` : ''}`)
	}

	async listCorporations(
		filters?: ListTaxCorporationScopeFilters
	): Promise<TaxCorporationScopeRow[]> {
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		const endpoint = `${TAX_API_BASE}/corporations${query ? `?${query}` : ''}`

		if (!this.shouldUseDemo()) {
			return this.get(endpoint)
		}

		const [demoRows, liveRows] = await Promise.all([
			taxDemoApi.listCorporations(filters),
			this.get<TaxCorporationScopeRow[]>(endpoint).catch(() => []),
		])

		const merged = new Map<string, TaxCorporationScopeRow>()
		for (const row of liveRows) {
			merged.set(row.corporationId, row)
		}
		for (const row of demoRows) {
			if (!merged.has(row.corporationId)) {
				merged.set(row.corporationId, row as TaxCorporationScopeRow)
			}
		}
		return Array.from(merged.values())
	}

	async listWalletDivisions(corporationId: string): Promise<number[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listWalletDivisions(corporationId)
		return this.get(`${TAX_API_BASE}/corporations/${corporationId}/divisions`)
	}

	async searchActivePayeeCorporations(
		corporationId: string,
		query: string
	): Promise<TaxBillingPayeeCorporationSearchRow[]> {
		const trimmed = query.trim()
		if (!trimmed) {
			return []
		}

		if (!this.shouldUseDemo()) {
			return this.get(
				`${TAX_API_BASE}/corporations/${corporationId}/payee-corporations/search?q=${encodeURIComponent(trimmed)}`
			)
		}

		const [demoRows, liveRows] = await Promise.all([
			taxDemoApi.listCorporations({ limit: 500, offset: 0 }),
			this.get<TaxBillingPayeeCorporationSearchRow[]>(
				`${TAX_API_BASE}/corporations/${corporationId}/payee-corporations/search?q=${encodeURIComponent(trimmed)}`
			).catch(() => []),
		])
		const demoNames = resolveDemoEntityNames(demoRows.map((row) => row.corporationId))
		const lowered = trimmed.toLowerCase()

		const demoMatches: TaxBillingPayeeCorporationSearchRow[] = demoRows
			.filter((row) => {
				if (row.corporationId.includes(trimmed)) return true
				const resolvedName = demoNames[row.corporationId]
				return resolvedName ? resolvedName.toLowerCase().includes(lowered) : false
			})
			.map((row) => ({
				corporationId: row.corporationId,
				name: demoNames[row.corporationId] ?? row.corporationId,
			}))

		const merged = new Map<string, TaxBillingPayeeCorporationSearchRow>()
		for (const row of liveRows) {
			merged.set(row.corporationId, row)
		}
		for (const row of demoMatches) {
			if (!merged.has(row.corporationId)) {
				merged.set(row.corporationId, row)
			}
		}
		return Array.from(merged.values())
	}

	async searchPayeeCharacters(
		corporationId: string,
		query: string
	): Promise<TaxBillingPayeeCharacterSearchRow[]> {
		const trimmed = query.trim()
		if (!trimmed) {
			return []
		}

		if (!this.shouldUseDemo()) {
			return this.get(
				`${TAX_API_BASE}/corporations/${corporationId}/payee-characters/search?q=${encodeURIComponent(trimmed)}`
			)
		}

		const [liveRows] = await Promise.all([
			this.get<TaxBillingPayeeCharacterSearchRow[]>(
				`${TAX_API_BASE}/corporations/${corporationId}/payee-characters/search?q=${encodeURIComponent(trimmed)}`
			).catch(() => []),
		])
		return liveRows
	}

	async listExclusions(filters?: {
		limit?: number
		offset?: number
	}): Promise<TaxCorporationExclusion[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listExclusions(filters)
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/exclusions${query ? `?${query}` : ''}`)
	}

	async upsertExclusion(
		corporationId: string,
		input: UpsertTaxExclusionInput
	): Promise<TaxCorporationExclusion> {
		if (this.shouldUseDemo()) return taxDemoApi.upsertExclusion(corporationId, input)
		return this.put(`${TAX_API_BASE}/exclusions/${corporationId}`, input)
	}

	async deleteExclusion(corporationId: string): Promise<void> {
		if (this.shouldUseDemo()) return taxDemoApi.deleteExclusion(corporationId)
		await this.delete(`${TAX_API_BASE}/exclusions/${corporationId}`)
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listRuleSets(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.ruleGroupId) params.set('ruleGroupId', filters.ruleGroupId)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/rules${query ? `?${query}` : ''}`)
	}

	async createRuleSet(
		_corporationId: string | undefined,
		input: CreateTaxRuleSetInput
	): Promise<TaxRuleSet> {
		if (this.shouldUseDemo()) return taxDemoApi.createRuleSet(undefined, input)
		return this.post(`${TAX_API_BASE}/rules`, input)
	}

	async updateRuleSet(
		ruleSetId: string,
		input: {
			isActive?: boolean
			name?: string
			priority?: number
			appliesToRefType?: string | null
			taxRateBps?: number
		}
	): Promise<TaxRuleSet> {
		if (this.shouldUseDemo()) return taxDemoApi.updateRuleSet(ruleSetId, input)
		return this.patch(`${TAX_API_BASE}/rules/${ruleSetId}`, input)
	}

	async deleteRuleSet(ruleSetId: string): Promise<void> {
		if (this.shouldUseDemo()) return taxDemoApi.deleteRuleSet(ruleSetId)
		await this.delete(`${TAX_API_BASE}/rules/${ruleSetId}`)
	}

	async listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listRuleGroups(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/rule-groups${query ? `?${query}` : ''}`)
	}

	async createRuleGroup(input: CreateTaxRuleGroupInput): Promise<TaxRuleGroup> {
		if (this.shouldUseDemo()) return taxDemoApi.createRuleGroup(input)
		return this.post(`${TAX_API_BASE}/rule-groups`, input)
	}

	async updateRuleGroup(
		ruleGroupId: string,
		input: { name?: string; description?: string | null }
	): Promise<TaxRuleGroup> {
		if (this.shouldUseDemo()) return taxDemoApi.updateRuleGroup(ruleGroupId, input)
		return this.patch(`${TAX_API_BASE}/rule-groups/${ruleGroupId}`, input)
	}

	async deleteRuleGroup(ruleGroupId: string): Promise<void> {
		if (this.shouldUseDemo()) return taxDemoApi.deleteRuleGroup(ruleGroupId)
		await this.delete(`${TAX_API_BASE}/rule-groups/${ruleGroupId}`)
	}

	async listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listRuleGroupAttachments(ruleGroupId)
		return this.get(`${TAX_API_BASE}/rule-groups/${ruleGroupId}/attachments`)
	}

	async attachCorporationToRuleGroup(
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment> {
		if (this.shouldUseDemo())
			return taxDemoApi.attachCorporationToRuleGroup(ruleGroupId, corporationId)
		return this.post(`${TAX_API_BASE}/rule-groups/${ruleGroupId}/attachments`, { corporationId })
	}

	async detachCorporationFromRuleGroup(ruleGroupId: string, corporationId: string): Promise<void> {
		if (this.shouldUseDemo()) {
			return taxDemoApi.detachCorporationFromRuleGroup(ruleGroupId, corporationId)
		}
		await this.delete(`${TAX_API_BASE}/rule-groups/${ruleGroupId}/attachments/${corporationId}`)
	}

	async listAssessments(
		corporationId: string,
		filters?: ListTaxAssessmentsFilters
	): Promise<TaxAssessment[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listAssessments(corporationId, filters)
		const params = new URLSearchParams()
		if (filters?.status) params.set('status', filters.status)
		if (filters?.assessmentScope) params.set('assessmentScope', filters.assessmentScope)
		if (filters?.withBillOnly !== undefined)
			params.set('withBillOnly', String(filters.withBillOnly))
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/assessments${query ? `?${query}` : ''}`
		)
	}

	async getLedgerEntries(
		corporationId: string,
		filters?: TaxLedgerFilters
	): Promise<TaxLedgerEntry[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getLedgerEntries(corporationId, filters as any)
		const params = new URLSearchParams()
		if (filters?.division !== undefined) params.set('division', String(filters.division))
		if (filters?.sourceTypes && filters.sourceTypes.length > 0) {
			params.set('sourceTypes', filters.sourceTypes.join(','))
		}
		if (filters?.characterId) params.set('characterId', filters.characterId)
		if (filters?.refTypes && filters.refTypes.length > 0) {
			params.set('refTypes', filters.refTypes.join(','))
		}
		if (filters?.firstPartyId) params.set('firstPartyId', filters.firstPartyId)
		if (filters?.secondPartyId) params.set('secondPartyId', filters.secondPartyId)
		if (filters?.fromDate) params.set('fromDate', filters.fromDate)
		if (filters?.toDate) params.set('toDate', filters.toDate)
		if (filters?.minAmount) params.set('minAmount', filters.minAmount)
		if (filters?.maxAmount) params.set('maxAmount', filters.maxAmount)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

		const query = params.toString()
		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/ledger/entries${query ? `?${query}` : ''}`
		)
	}

	async getLedgerParties(
		corporationId: string,
		filters?: TaxLedgerPartySearchFilters
	): Promise<TaxLedgerPartySearchRow[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getLedgerParties(corporationId, filters as any)
		const params = new URLSearchParams()
		if (filters?.fromDate) params.set('fromDate', filters.fromDate)
		if (filters?.toDate) params.set('toDate', filters.toDate)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.q) params.set('q', filters.q)
		if (filters?.direction) params.set('direction', filters.direction)
		const query = params.toString()
		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/ledger/parties${query ? `?${query}` : ''}`
		)
	}

	async createBillForAssessment(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		if (this.shouldUseDemo()) return taxDemoApi.createBillForAssessment(corporationId, assessmentId)
		return this.post(
			`${TAX_API_BASE}/corporations/${corporationId}/assessments/${assessmentId}/bills`
		)
	}

	async listBillingConfigs(corporationId: string): Promise<TaxCorporationBillingConfig[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listBillingConfigs(corporationId)
		return this.get(`${TAX_API_BASE}/corporations/${corporationId}/billing-configs`)
	}

	async createBillingConfig(
		corporationId: string,
		input: CreateBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		if (this.shouldUseDemo()) return taxDemoApi.createBillingConfig(corporationId, input)
		return this.post(`${TAX_API_BASE}/corporations/${corporationId}/billing-configs`, input)
	}

	async updateBillingConfig(
		corporationId: string,
		configId: string,
		input: UpdateBillingConfigInput
	): Promise<TaxCorporationBillingConfig> {
		if (this.shouldUseDemo()) return taxDemoApi.updateBillingConfig(corporationId, configId, input)
		return this.patch(
			`${TAX_API_BASE}/corporations/${corporationId}/billing-configs/${configId}`,
			input
		)
	}

	async deleteBillingConfig(corporationId: string, configId: string): Promise<void> {
		if (this.shouldUseDemo()) return taxDemoApi.deleteBillingConfig(corporationId, configId)
		await this.delete(`${TAX_API_BASE}/corporations/${corporationId}/billing-configs/${configId}`)
	}

	async setDefaultBillingConfig(
		corporationId: string,
		configId: string
	): Promise<TaxCorporationBillingConfig> {
		if (this.shouldUseDemo()) return taxDemoApi.setDefaultBillingConfig(corporationId, configId)
		return this.post(
			`${TAX_API_BASE}/corporations/${corporationId}/billing-configs/${configId}/default`
		)
	}

	async syncAssessmentBillStatus(
		corporationId: string,
		assessmentId: string
	): Promise<TaxAssessment> {
		if (this.shouldUseDemo())
			return taxDemoApi.syncAssessmentBillStatus(corporationId, assessmentId)
		return this.post(
			`${TAX_API_BASE}/corporations/${corporationId}/assessments/${assessmentId}/bills/sync`
		)
	}

	async retractAssessmentBill(corporationId: string, assessmentId: string): Promise<TaxAssessment> {
		if (this.shouldUseDemo()) {
			return taxDemoApi.retractAssessmentBill(corporationId, assessmentId)
		}
		return this.post(
			`${TAX_API_BASE}/corporations/${corporationId}/assessments/${assessmentId}/bills/retract`
		)
	}

	async issueBillsForPeriod(
		corporationId: string,
		input: { periodStart: string; periodEnd: string }
	): Promise<IssueBillsForPeriodResult> {
		if (this.shouldUseDemo()) return taxDemoApi.issueBillsForPeriod(corporationId)
		return this.post(`${TAX_API_BASE}/corporations/${corporationId}/periods/issue-bills`, input)
	}

	async syncCorporationBillStatuses(
		corporationId: string,
		limit?: number
	): Promise<SyncCorporationBillStatusesResult> {
		if (this.shouldUseDemo()) return taxDemoApi.syncCorporationBillStatuses(corporationId)
		return this.post(`${TAX_API_BASE}/corporations/${corporationId}/bills/sync`, { limit })
	}

	async listAlerts(filters?: ListTaxAlertsFilters): Promise<TaxAlert[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listAlerts(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.status) params.set('status', filters.status)
		if (filters?.severity) params.set('severity', filters.severity)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

		const query = params.toString()
		return this.get(`${TAX_API_BASE}/alerts${query ? `?${query}` : ''}`)
	}

	async acknowledgeAlert(alertId: string): Promise<TaxAlert> {
		if (this.shouldUseDemo()) return taxDemoApi.acknowledgeAlert(alertId)
		return this.post(`${TAX_API_BASE}/alerts/${alertId}/acknowledge`)
	}

	async resolveAlert(alertId: string): Promise<TaxAlert> {
		if (this.shouldUseDemo()) return taxDemoApi.resolveAlert(alertId)
		return this.post(`${TAX_API_BASE}/alerts/${alertId}/resolve`)
	}

	async retryFailedAlertDeliveries(limit?: number): Promise<{ retried: number }> {
		if (this.shouldUseDemo()) return taxDemoApi.retryFailedAlertDeliveries()
		return this.post(`${TAX_API_BASE}/alerts/retry-failed-deliveries`, { limit })
	}

	async getBillStatusReport(
		filters?: TaxReportFilters
	): Promise<TaxPagedResult<TaxBillStatusReportRow>> {
		if (this.shouldUseDemo()) return taxDemoApi.getBillStatusReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/bill-status${query ? `?${query}` : ''}`)
	}

	async getCorporationBillHistory(
		corporationId: string,
		filters?: { limit?: number; offset?: number }
	): Promise<TaxAssessmentWithBillHistory[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getCorporationBillHistory(corporationId, filters)
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()

		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/bills/history${query ? `?${query}` : ''}`
		)
	}

	async getCorporationBillEventHistory(
		corporationId: string,
		filters?: { limit?: number; offset?: number }
	): Promise<TaxPagedResult<TaxBillingEventHistoryRow>> {
		if (this.shouldUseDemo())
			return taxDemoApi.getCorporationBillEventHistory(corporationId, filters)
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()

		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/bills/history/events${query ? `?${query}` : ''}`
		)
	}

	async getSummaryReport(filters?: TaxReportFilters): Promise<TaxSummaryReport> {
		if (this.shouldUseDemo()) return taxDemoApi.getSummaryReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/summary${query ? `?${query}` : ''}`)
	}

	async getTotalTaxesReport(
		filters?: TaxReportFilters
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>> {
		if (this.shouldUseDemo()) return taxDemoApi.getTotalTaxesReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/total-taxes${query ? `?${query}` : ''}`)
	}

	async getTopIncomeSourcesReport(filters?: TaxReportFilters): Promise<TaxTopIncomeSourceRow[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getTopIncomeSourcesReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/top-income${query ? `?${query}` : ''}`)
	}

	async getTopIncomeSourcesMonthlyReport(
		filters?: TaxReportFilters
	): Promise<TaxTopIncomeSourceMonthlyRow[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getTopIncomeSourcesMonthlyReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/top-income-monthly${query ? `?${query}` : ''}`)
	}

	async getEssPayoutReport(filters?: TaxReportFilters): Promise<TaxPagedResult<TaxEssPayoutRow>> {
		if (this.shouldUseDemo()) return taxDemoApi.getEssPayoutReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/ess${query ? `?${query}` : ''}`)
	}

	async getComplianceReport(filters?: TaxReportFilters): Promise<TaxCompliancePoint[]> {
		if (this.shouldUseDemo()) return taxDemoApi.getComplianceReport(filters)
		const params = new URLSearchParams()
		this.appendTaxReportFilters(params, filters)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/compliance${query ? `?${query}` : ''}`)
	}

	async getDiscrepancyReport(
		filters?: ListTaxDiscrepancyReportFilters
	): Promise<TaxPagedResult<TaxDiscrepancy>> {
		if (this.shouldUseDemo()) return taxDemoApi.getDiscrepancyReport(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.fromDate) params.set('fromDate', filters.fromDate)
		if (filters?.toDate) params.set('toDate', filters.toDate)
		if (filters?.onlyOpen !== undefined) params.set('onlyOpen', String(filters.onlyOpen))
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		if (filters?.sortBy) params.set('sortBy', filters.sortBy)
		if (filters?.sortDir) params.set('sortDir', filters.sortDir)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/discrepancies${query ? `?${query}` : ''}`)
	}

	async getMissingEsiKeysReport(
		filters?: ListTaxMissingEsiKeyReportFilters
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>> {
		if (this.shouldUseDemo()) return taxDemoApi.getMissingEsiKeysReport(filters)
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		if (filters?.sortBy) params.set('sortBy', filters.sortBy)
		if (filters?.sortDir) params.set('sortDir', filters.sortDir)
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/reports/missing-esi-keys${query ? `?${query}` : ''}`)
	}

	async getMemberSummary(
		corporationId: string,
		filters?: TaxMemberSummaryFilters
	): Promise<TaxPagedResult<TaxMemberSummary>> {
		if (!corporationId?.trim()) {
			throw new Error('Corporation id is required for member summary')
		}
		if (this.shouldUseDemo()) return taxDemoApi.getMemberSummary(corporationId, filters)
		const params = new URLSearchParams()
		if (filters?.characterQuery) params.set('character', filters.characterQuery)
		if (filters?.fromDate) params.set('fromDate', filters.fromDate)
		if (filters?.toDate) params.set('toDate', filters.toDate)
		if (filters?.topRefTypesLimit !== undefined)
			params.set('topRefTypesLimit', String(filters.topRefTypesLimit))
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		if (filters?.sortBy) params.set('sortBy', filters.sortBy)
		if (filters?.sortDir) params.set('sortDir', filters.sortDir)
		const query = params.toString()
		return this.get(
			`${TAX_API_BASE}/corporations/${corporationId}/member-summary${query ? `?${query}` : ''}`
		)
	}

	async requestExport(input: {
		corporationId?: string
		format: TaxExportFormat
		reportType: TaxExportReportType
		filters?: Record<string, unknown> | null
		sourceEsiVersion?: string | null
	}): Promise<TaxExportRecord> {
		if (this.shouldUseDemo()) return taxDemoApi.requestExport(input)
		return this.post(`${TAX_API_BASE}/exports`, input)
	}

	async listExports(filters?: ListTaxExportsFilters): Promise<TaxExportRecord[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listExports(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.format) params.set('format', filters.format)
		if (filters?.status) params.set('status', filters.status)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/exports${query ? `?${query}` : ''}`)
	}

	async getExportArtifact(exportId: string): Promise<TaxExportArtifact> {
		if (this.shouldUseDemo()) return taxDemoApi.getExportArtifact(exportId)
		return this.get(`${TAX_API_BASE}/exports/${exportId}/artifact`)
	}

	async createExportSchedule(input: {
		name: string
		corporationId?: string
		format: TaxExportFormat
		frequency: 'weekly' | 'monthly'
		reportType: TaxExportReportType
		filters?: Record<string, unknown> | null
		nextRunAt?: string
		isActive?: boolean
	}): Promise<TaxExportSchedule> {
		if (this.shouldUseDemo()) return taxDemoApi.createExportSchedule(input)
		return this.post(`${TAX_API_BASE}/export-schedules`, input)
	}

	async listExportSchedules(filters?: ListTaxExportSchedulesFilters): Promise<TaxExportSchedule[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listExportSchedules(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.activeOnly !== undefined) params.set('activeOnly', String(filters.activeOnly))
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/export-schedules${query ? `?${query}` : ''}`)
	}

	async listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxPagedResult<TaxAuditLogEntry>> {
		if (this.shouldUseDemo()) return taxDemoApi.listAuditLog(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.actorUserId) params.set('actorUserId', filters.actorUserId)
		if (filters?.action) params.set('action', filters.action)
		if (filters?.fromDate) params.set('fromDate', filters.fromDate)
		if (filters?.toDate) params.set('toDate', filters.toDate)
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/audit-log${query ? `?${query}` : ''}`)
	}

	async searchAuditActors(filters?: TaxAuditActorSearchFilters): Promise<TaxAuditActorSearchRow[]> {
		if (this.shouldUseDemo()) return taxDemoApi.searchAuditActors(filters)
		const params = new URLSearchParams()
		if (filters?.corporationId) params.set('corporationId', filters.corporationId)
		if (filters?.q) params.set('q', filters.q)
		if (filters?.ids && filters.ids.length > 0) params.set('ids', filters.ids.join(','))
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/audit-actors${query ? `?${query}` : ''}`)
	}

	async listNotificationDestinations(
		filters?: ListTaxNotificationDestinationsFilters
	): Promise<TaxNotificationDestination[]> {
		if (this.shouldUseDemo()) return taxDemoApi.listNotificationDestinations(filters)
		const params = new URLSearchParams()
		if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
		if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
		const query = params.toString()
		return this.get(`${TAX_API_BASE}/notification-destinations${query ? `?${query}` : ''}`)
	}

	async upsertNotificationDestination(
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination> {
		if (this.shouldUseDemo()) return taxDemoApi.upsertNotificationDestination(input as any)
		return this.put(`${TAX_API_BASE}/notification-destinations`, input)
	}
}

export const corporationTaxApi = new CorporationTaxApiClient()
