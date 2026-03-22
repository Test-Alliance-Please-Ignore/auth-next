import { useQuery } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

import type { TaxReportQueryOptions } from './types'

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
