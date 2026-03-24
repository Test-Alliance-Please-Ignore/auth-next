import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

import type { TaxAlertSeverity, TaxAlertStatus } from '@repo/corporation-tax'

export function useTaxNotificationDestinations(filters?: {
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
		mutationFn: (input: { name: string; guildId: string; channelId: string }) =>
			corporationTaxApi.upsertNotificationDestination(input),
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

export function useTaxAuditActors(filters?: {
	corporationId?: string
	q?: string
	ids?: string[]
	limit?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.auditActorSearch(filters),
		queryFn: () => corporationTaxApi.searchAuditActors(filters),
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
