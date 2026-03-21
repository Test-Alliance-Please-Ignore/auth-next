import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import type {
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxExportFormat,
	TaxExportReportType,
	TaxExportStatus,
} from '@repo/corporation-tax'

type TaxReportQueryFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	division?: number
	refType?: string
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	minAmount?: string
	maxAmount?: string
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

type TaxReportQueryOptions = TaxReportQueryFilters & {
	enabled?: boolean
}

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
		onlyActive?: boolean
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.all, 'rules', filters] as const,
	ruleGroups: (filters?: { corporationId?: string; limit?: number; offset?: number }) =>
		[...corporationTaxKeys.all, 'rule-groups', filters] as const,
	ruleGroupAttachments: (ruleGroupId: string) =>
		[...corporationTaxKeys.all, 'rule-group-attachments', ruleGroupId] as const,
	notificationDestinations: (filters?: {
		scope?: 'global' | 'corporation'
		corporationId?: string
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.all, 'notification-destinations', filters] as const,
	auditLog: () => [...corporationTaxKeys.all, 'audit-log'] as const,
	auditLogList: (filters?: {
		corporationId?: string
		actorUserId?: string
		action?: string
		fromDate?: string
		toDate?: string
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.auditLog(), filters] as const,
	alerts: () => [...corporationTaxKeys.all, 'alerts'] as const,
	alertList: (filters?: {
		corporationId?: string
		status?: TaxAlertStatus
		severity?: TaxAlertSeverity
		limit?: number
		offset?: number
	}) => [...corporationTaxKeys.alerts(), filters] as const,
	billStatus: () => [...corporationTaxKeys.all, 'bill-status'] as const,
	billStatusReport: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.billStatus(), filters] as const,
	totalTaxes: () => [...corporationTaxKeys.all, 'total-taxes'] as const,
	totalTaxesReport: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.totalTaxes(), filters] as const,
	topIncome: () => [...corporationTaxKeys.all, 'top-income'] as const,
	topIncomeReport: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.topIncome(), filters] as const,
	topIncomeMonthly: () => [...corporationTaxKeys.all, 'top-income-monthly'] as const,
	topIncomeMonthlyReport: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.topIncomeMonthly(), filters] as const,
	essPayout: () => [...corporationTaxKeys.all, 'ess-payout'] as const,
	essPayoutReport: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.essPayout(), filters] as const,
	compliance: () => [...corporationTaxKeys.all, 'compliance'] as const,
	complianceReport: (filters?: TaxReportQueryFilters) =>
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
	summary: (filters?: TaxReportQueryFilters) =>
		[...corporationTaxKeys.all, 'summary', filters] as const,
	memberSummary: (
		corporationId: string,
		filters?: {
			characterQuery?: string
			fromDate?: string
			toDate?: string
			topRefTypesLimit?: number
		}
	) => [...corporationTaxKeys.all, 'member-summary', corporationId, filters] as const,
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

export function useTaxCapabilities(corporationId?: string, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.capabilities(corporationId),
		queryFn: () => corporationTaxApi.getCapabilities(corporationId),
		staleTime: 1000 * 30,
		enabled,
	})
}

export function useTaxCorporations(filters?: {
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.corporationList(filters),
		queryFn: () => corporationTaxApi.listCorporations(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxWalletDivisions(corporationId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.walletDivisions(corporationId ?? 'none'),
		queryFn: () => corporationTaxApi.listWalletDivisions(corporationId!),
		staleTime: 1000 * 60 * 5,
		enabled: Boolean(corporationId) && enabled,
	})
}

export function useTaxExclusions(filters?: { limit?: number; offset?: number; enabled?: boolean }) {
	return useQuery({
		queryKey: corporationTaxKeys.exclusionsList(filters),
		queryFn: () => corporationTaxApi.listExclusions(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useUpsertTaxExclusion() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; reason: string | null }) =>
			corporationTaxApi.upsertExclusion(input.corporationId, { reason: input.reason }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.corporations(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.exclusions(),
			})
		},
	})
}

export function useDeleteTaxExclusion() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (corporationId: string) => corporationTaxApi.deleteExclusion(corporationId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.corporations(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.exclusions(),
			})
		},
	})
}

export function useTaxRuleSets(filters?: {
	corporationId?: string
	ruleGroupId?: string
	onlyActive?: boolean
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	const hasFilter = Boolean(filters?.corporationId || filters?.ruleGroupId)
	return useQuery({
		queryKey: corporationTaxKeys.rules(filters),
		queryFn: () => corporationTaxApi.listRuleSets(filters),
		staleTime: 1000 * 30,
		enabled: hasFilter && (filters?.enabled ?? true),
	})
}

export function useCreateTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			corporationId?: string
			ruleSet: {
				name: string
				ruleGroupId: string
				priority?: number
				isActive?: boolean
				effectiveFrom?: string
				effectiveTo?: string
				appliesToRefType?: string
				partyType?: string
				taxRateBps: number
				label: string
			}
		}) => corporationTaxApi.createRuleSet(input.corporationId, input.ruleSet),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: [...corporationTaxKeys.all, 'rules'],
			})
		},
	})
}

export function useUpdateTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			ruleSetId: string
			updates: {
				isActive?: boolean
				name?: string
				priority?: number
				appliesToRefType?: string | null
				partyType?: string | null
				taxRateBps?: number
				label?: string
			}
		}) => corporationTaxApi.updateRuleSet(input.ruleSetId, input.updates),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useDeleteTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (ruleSetId: string) => corporationTaxApi.deleteRuleSet(ruleSetId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useTaxRuleGroups(filters?: {
	corporationId?: string
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.ruleGroups(filters),
		queryFn: () => corporationTaxApi.listRuleGroups(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useCreateTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { name: string; description?: string | null }) =>
			corporationTaxApi.createRuleGroup(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
		},
	})
}

export function useUpdateTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			ruleGroupId: string
			updates: { name?: string; description?: string | null }
		}) => corporationTaxApi.updateRuleGroup(input.ruleGroupId, input.updates),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
		},
	})
}

export function useDeleteTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (ruleGroupId: string) => corporationTaxApi.deleteRuleGroup(ruleGroupId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useTaxRuleGroupAttachments(ruleGroupId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.ruleGroupAttachments(ruleGroupId ?? 'none'),
		queryFn: () => corporationTaxApi.listRuleGroupAttachments(ruleGroupId!),
		staleTime: 1000 * 30,
		enabled: Boolean(ruleGroupId) && enabled,
	})
}

export function useAttachCorporationToRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { ruleGroupId: string; corporationId: string }) =>
			corporationTaxApi.attachCorporationToRuleGroup(input.ruleGroupId, input.corporationId),
		onMutate: async (variables) => {
			const queryKey = corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId)
			await queryClient.cancelQueries({ queryKey })
			const previous =
				queryClient.getQueryData<Array<{ id: string; ruleGroupId: string; corporationId: string }>>(
					queryKey
				) ?? []

			const exists = previous.some((row) => row.corporationId === variables.corporationId)
			if (!exists) {
				queryClient.setQueryData(queryKey, [
					...previous,
					{
						id: `optimistic-${variables.ruleGroupId}-${variables.corporationId}`,
						ruleGroupId: variables.ruleGroupId,
						corporationId: variables.corporationId,
					},
				])
			}

			return { previous, queryKey }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(context.queryKey, context.previous)
		},
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId),
			})
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.corporations() })
		},
	})
}

export function useDetachCorporationFromRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { ruleGroupId: string; corporationId: string }) =>
			corporationTaxApi.detachCorporationFromRuleGroup(input.ruleGroupId, input.corporationId),
		onMutate: async (variables) => {
			const queryKey = corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId)
			await queryClient.cancelQueries({ queryKey })
			const previous =
				queryClient.getQueryData<Array<{ id: string; ruleGroupId: string; corporationId: string }>>(
					queryKey
				) ?? []

			queryClient.setQueryData(
				queryKey,
				previous.filter((row) => row.corporationId !== variables.corporationId)
			)

			return { previous, queryKey }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(context.queryKey, context.previous)
		},
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId),
			})
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useTaxNotificationDestinations(filters?: {
	scope?: 'global' | 'corporation'
	corporationId?: string
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.notificationDestinations(filters),
		queryFn: () => corporationTaxApi.listNotificationDestinations(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useUpsertTaxNotificationDestination() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			scope: 'global' | 'corporation'
			corporationId?: string
			guildId: string
			channelId: string
			isActive?: boolean
		}) => corporationTaxApi.upsertNotificationDestination(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: [...corporationTaxKeys.all, 'notification-destinations'],
			})
		},
	})
}

export function useTaxAlerts(filters?: {
	corporationId?: string
	status?: TaxAlertStatus
	severity?: TaxAlertSeverity
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.alertList(filters),
		queryFn: () => corporationTaxApi.listAlerts(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxAuditLog(filters?: {
	corporationId?: string
	actorUserId?: string
	action?: string
	fromDate?: string
	toDate?: string
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.auditLogList(filters),
		queryFn: () => corporationTaxApi.listAuditLog(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useAcknowledgeTaxAlert() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (alertId: string) => corporationTaxApi.acknowledgeAlert(alertId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.alerts() })
		},
	})
}

export function useResolveTaxAlert() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (alertId: string) => corporationTaxApi.resolveAlert(alertId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.alerts() })
		},
	})
}

export function useRetryFailedTaxAlertDeliveries() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (limit?: number) => corporationTaxApi.retryFailedAlertDeliveries(limit),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.alerts() })
		},
	})
}

export function useTaxBillStatusReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.billStatusReport(filters),
		queryFn: () => corporationTaxApi.getBillStatusReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTotalTaxesReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.totalTaxesReport(filters),
		queryFn: () => corporationTaxApi.getTotalTaxesReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTopIncomeSourcesReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.topIncomeReport(filters),
		queryFn: () => corporationTaxApi.getTopIncomeSourcesReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTopIncomeSourcesMonthlyReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.topIncomeMonthlyReport(filters),
		queryFn: () => corporationTaxApi.getTopIncomeSourcesMonthlyReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxEssPayoutReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.essPayoutReport(filters),
		queryFn: () => corporationTaxApi.getEssPayoutReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxComplianceReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.complianceReport(filters),
		queryFn: () => corporationTaxApi.getComplianceReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxDiscrepancyReport(filters?: {
	corporationId?: string
	fromDate?: string
	toDate?: string
	onlyOpen?: boolean
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.discrepancyReport(filters),
		queryFn: () => corporationTaxApi.getDiscrepancyReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxMissingEsiKeysReport(filters?: {
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.missingEsiKeysReport(filters),
		queryFn: () => corporationTaxApi.getMissingEsiKeysReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxCorporationBillHistory(
	corporationId: string | undefined,
	filters?: {
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.billHistory(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getCorporationBillHistory(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxAssessments(
	corporationId: string | undefined,
	filters?: {
		status?: 'draft' | 'underpaid' | 'paid' | 'overpaid' | 'excluded'
		assessmentScope?: 'corporation' | 'division' | 'character'
		withBillOnly?: boolean
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.assessments(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.listAssessments(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxLedgerEntries(
	corporationId: string | undefined,
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
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.ledgerEntries(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getLedgerEntries(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useCreateTaxBillForAssessment() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.createBillForAssessment(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useSyncTaxAssessmentBillStatus() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.syncAssessmentBillStatus(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useRetractTaxAssessmentBill() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.retractAssessmentBill(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useIssueTaxBillsForPeriod() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; periodStart: string; periodEnd: string }) =>
			corporationTaxApi.issueBillsForPeriod(input.corporationId, {
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
			}),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(variables.corporationId),
			})
		},
	})
}

export function useSyncTaxCorporationBillStatuses() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; limit?: number }) =>
			corporationTaxApi.syncCorporationBillStatuses(input.corporationId, input.limit),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(variables.corporationId),
			})
		},
	})
}

export function useTaxSummaryReport(filters?: TaxReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.summary(filters),
		queryFn: () => corporationTaxApi.getSummaryReport(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxMemberSummary(
	corporationId: string | undefined,
	filters?: {
		characterQuery?: string
		fromDate?: string
		toDate?: string
		topRefTypesLimit?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.memberSummary(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getMemberSummary(corporationId!, filters),
		staleTime: 1000 * 60 * 10,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxExports(filters?: {
	corporationId?: string
	format?: TaxExportFormat
	status?: TaxExportStatus
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.exports(filters),
		queryFn: () => corporationTaxApi.listExports(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useRequestTaxExport() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			corporationId?: string
			format: TaxExportFormat
			reportType: TaxExportReportType
			filters?: Record<string, unknown> | null
			sourceEsiVersion?: string | null
		}) => corporationTaxApi.requestExport(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'exports'] })
		},
	})
}

export function useTaxExportArtifact() {
	return useMutation({
		mutationFn: (exportId: string) => corporationTaxApi.getExportArtifact(exportId),
	})
}

export function useTaxExportSchedules(filters?: {
	corporationId?: string
	activeOnly?: boolean
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.exportSchedules(filters),
		queryFn: () => corporationTaxApi.listExportSchedules(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useCreateTaxExportSchedule() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			name: string
			corporationId?: string
			format: TaxExportFormat
			frequency: 'weekly' | 'monthly'
			reportType: TaxExportReportType
			filters?: Record<string, unknown> | null
			nextRunAt?: string
			isActive?: boolean
		}) => corporationTaxApi.createExportSchedule(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: [...corporationTaxKeys.all, 'export-schedules'],
			})
		},
	})
}
