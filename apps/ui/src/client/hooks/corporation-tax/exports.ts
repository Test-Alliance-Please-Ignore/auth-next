import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

import type { TaxExportFormat, TaxExportReportType, TaxExportStatus } from '@repo/corporation-tax'

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
