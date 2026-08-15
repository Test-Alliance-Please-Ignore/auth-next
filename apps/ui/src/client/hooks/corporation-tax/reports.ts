import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

import type { TaxRollupReportQueryOptions } from './types'

const TAX_REPORT_LIVE_STALE_TIME = 1000 * 60 * 5
const TAX_REPORT_HISTORICAL_STALE_TIME = 1000 * 60 * 15

function getTaxReportStaleTime(filters?: TaxRollupReportQueryOptions): number {
	if (!filters?.toDate) {
		return TAX_REPORT_LIVE_STALE_TIME
	}

	const toDate = Date.parse(filters.toDate)
	if (!Number.isFinite(toDate)) {
		return TAX_REPORT_LIVE_STALE_TIME
	}

	const now = new Date()
	const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
	return toDate < currentMonthStart ? TAX_REPORT_HISTORICAL_STALE_TIME : TAX_REPORT_LIVE_STALE_TIME
}

export function useTaxBillStatusReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.billStatusReport(filters),
		queryFn: () => corporationTaxApi.getBillStatusReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTotalTaxesReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.totalTaxesReport(filters),
		queryFn: () => corporationTaxApi.getTotalTaxesReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTopIncomeSourcesReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.topIncomeReport(filters),
		queryFn: () => corporationTaxApi.getTopIncomeSourcesReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxTopIncomeSourcesMonthlyReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.topIncomeMonthlyReport(filters),
		queryFn: () => corporationTaxApi.getTopIncomeSourcesMonthlyReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxEssPayoutReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.essPayoutReport(filters),
		queryFn: () => corporationTaxApi.getEssPayoutReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxComplianceReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.complianceReport(filters),
		queryFn: () => corporationTaxApi.getComplianceReport(filters),
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
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
		placeholderData: keepPreviousData,
		staleTime: getTaxReportStaleTime(filters),
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
		placeholderData: keepPreviousData,
		staleTime: 1000 * 60 * 5,
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxSummaryReport(filters?: TaxRollupReportQueryOptions) {
	return useQuery({
		queryKey: corporationTaxKeys.summary(filters),
		queryFn: () => corporationTaxApi.getSummaryReport(filters),
		staleTime: getTaxReportStaleTime(filters),
		enabled: filters?.enabled ?? true,
	})
}

export function useTaxMemberSummary(
	corporationId: string | undefined,
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
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.memberSummary(corporationId ?? 'none', filters),
		queryFn: () => {
			if (!corporationId) {
				throw new Error('Corporation id is required for member summary')
			}
			return corporationTaxApi.getMemberSummary(corporationId, filters)
		},
		placeholderData: keepPreviousData,
		staleTime: 1000 * 60 * 10,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxableIncomeRefTypes(corporationId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.memberSummaryTaxableRefTypes(corporationId ?? 'none'),
		queryFn: () => {
			return corporationTaxApi.getTaxableIncomeRefTypes(corporationId)
		},
		staleTime: 1000 * 60 * 10,
		enabled,
	})
}
