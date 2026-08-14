import type {
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxExportFormat,
	TaxExportStatus,
} from '@repo/corporation-tax'
import type { TaxRollupReportQueryFilters } from './types'

export const corporationTaxKeys = {
	all: ['corporation-tax'] as const,
	capabilities: (corporationId?: string) =>
		[...corporationTaxKeys.all, 'capabilities', corporationId ?? 'global'] as const,
	corporations: () => [...corporationTaxKeys.all, 'corporations'] as const,
	corporationList: (filters?: { limit?: number; offset?: number }) =>
		[...corporationTaxKeys.corporations(), filters] as const,
	exclusions: () => [...corporationTaxKeys.all, 'exclusions'] as const,
	exclusionsList: (filters?: { limit?: number; offset?: number }) =>
		[...corporationTaxKeys.exclusions(), filters] as const,
	walletDivisions: (corporationId: string) =>
		[...corporationTaxKeys.all, 'wallet-divisions', corporationId] as const,
	rules: (filters?: {
		corporationId?: string
		ruleGroupId?: string
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.all, 'rules', filters] as const,
	ruleGroups: (filters?: { corporationId?: string; limit?: number; offset?: number }) =>
		[...corporationTaxKeys.all, 'rule-groups', filters] as const,
	ruleGroupAttachments: (ruleGroupId: string) =>
		[...corporationTaxKeys.all, 'rule-group-attachments', ruleGroupId] as const,
	notificationDestinations: (filters?: { limit?: number; offset?: number }) =>
		[...corporationTaxKeys.all, 'notification-destinations', filters] as const,
	auditLog: () => [...corporationTaxKeys.all, 'audit-log'] as const,
	auditActors: () => [...corporationTaxKeys.all, 'audit-actors'] as const,
	auditLogList: (filters?: {
		corporationId?: string
		actorUserId?: string
		action?: string
		fromDate?: string
		toDate?: string
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.auditLog(), filters] as const,
	auditActorSearch: (filters?: {
		corporationId?: string
		q?: string
		ids?: string[]
		limit?: number
	}) => [...corporationTaxKeys.auditActors(), filters] as const,
	alerts: () => [...corporationTaxKeys.all, 'alerts'] as const,
	alertList: (filters?: {
		corporationId?: string
		status?: TaxAlertStatus
		severity?: TaxAlertSeverity
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.alerts(), filters] as const,
	billStatus: () => [...corporationTaxKeys.all, 'bill-status'] as const,
	billStatusReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.billStatus(), filters] as const,
	totalTaxes: () => [...corporationTaxKeys.all, 'total-taxes'] as const,
	totalTaxesReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.totalTaxes(), filters] as const,
	topIncome: () => [...corporationTaxKeys.all, 'top-income'] as const,
	topIncomeReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.topIncome(), filters] as const,
	topIncomeMonthly: () => [...corporationTaxKeys.all, 'top-income-monthly'] as const,
	topIncomeMonthlyReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.topIncomeMonthly(), filters] as const,
	essPayout: () => [...corporationTaxKeys.all, 'ess-payout'] as const,
	essPayoutReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.essPayout(), filters] as const,
	compliance: () => [...corporationTaxKeys.all, 'compliance'] as const,
	complianceReport: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.compliance(), filters] as const,
	discrepancy: () => [...corporationTaxKeys.all, 'discrepancy'] as const,
	discrepancyReport: (filters?: {
		corporationId?: string
		fromDate?: string
		toDate?: string
		onlyOpen?: boolean
		limit?: number
		offset?: number
		sortBy?: string
		sortDir?: 'asc' | 'desc'
	}) => [...corporationTaxKeys.discrepancy(), filters] as const,
	missingEsiKeys: () => [...corporationTaxKeys.all, 'missing-esi-keys'] as const,
	missingEsiKeysReport: (filters?: {
		limit?: number
		offset?: number
		sortBy?: string
		sortDir?: 'asc' | 'desc'
	}) => [...corporationTaxKeys.missingEsiKeys(), filters] as const,
	billHistory: (corporationId: string, filters?: { limit?: number; offset?: number }) =>
		[...corporationTaxKeys.all, 'bill-history', corporationId, filters] as const,
	billEventHistory: (corporationId: string, filters?: { limit?: number; offset?: number }) =>
		[...corporationTaxKeys.all, 'bill-event-history', corporationId, filters] as const,
	billingConfigs: (corporationId: string) =>
		[...corporationTaxKeys.all, 'billing-configs', corporationId] as const,
	billingPayeeCorporationSearch: (corporationId: string, query: string) =>
		[...corporationTaxKeys.all, 'billing-payee-corporation-search', corporationId, query] as const,
	billingPayeeCharacterSearch: (corporationId: string, query: string) =>
		[...corporationTaxKeys.all, 'billing-payee-character-search', corporationId, query] as const,
	assessments: (
		corporationId: string,
		filters?: {
			status?: 'draft' | 'underpaid' | 'paid' | 'overpaid' | 'excluded'
			assessmentScope?: 'corporation' | 'division' | 'character'
			withBillOnly?: boolean
			limit?: number
			offset?: number
		}
	) => [...corporationTaxKeys.all, 'assessments', corporationId, filters] as const,
	ledgerEntries: (
		corporationId: string,
		filters?: {
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
	) => [...corporationTaxKeys.all, 'ledger-entries', corporationId, filters] as const,
	ledgerParties: (
		corporationId: string,
		filters?: {
			fromDate?: string
			toDate?: string
			limit?: number
			q?: string
			direction?: 'any' | 'sender' | 'recipient'
		}
	) => [...corporationTaxKeys.all, 'ledger-parties', corporationId, filters] as const,
	summary: (filters?: TaxRollupReportQueryFilters) =>
		[...corporationTaxKeys.all, 'summary', filters] as const,
	memberSummary: (
		corporationId: string,
		filters?: {
			characterQuery?: string
			refTypes?: string[]
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
	) => [...corporationTaxKeys.all, 'member-summary', corporationId, filters] as const,
	memberSummaryTaxableRefTypes: (corporationId: string) =>
		[...corporationTaxKeys.all, 'member-summary-taxable-ref-types', corporationId] as const,
	exports: (filters?: {
		corporationId?: string
		format?: TaxExportFormat
		status?: TaxExportStatus
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.all, 'exports', filters] as const,
	exportSchedules: (filters?: {
		corporationId?: string
		activeOnly?: boolean
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.all, 'export-schedules', filters] as const,
}
