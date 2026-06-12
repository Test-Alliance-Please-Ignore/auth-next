import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { corporationKeys } from './useCorporations'

import type {
	CreateCorporationAlertDestinationRequest,
	UpdateCorporationAlertDestinationRequest,
} from '@/lib/api'

export function useCorporationAlertTypes() {
	return useQuery({
		queryKey: corporationKeys.alertTypes(),
		queryFn: () => api.getCorporationAlertTypes(),
		staleTime: 1000 * 60 * 10,
	})
}

export function useCorporationAlertDestinations(corporationId: string) {
	return useQuery({
		queryKey: corporationKeys.alerts(corporationId),
		queryFn: () => api.getCorporationAlertDestinations(corporationId),
		enabled: !!corporationId,
		staleTime: 1000 * 30,
	})
}

export function useCreateCorporationAlertDestination() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			data,
		}: {
			corporationId: string
			data: CreateCorporationAlertDestinationRequest
		}) => api.createCorporationAlertDestination(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.alerts(corporationId),
				refetchType: 'active',
			})
		},
	})
}

export function useUpdateCorporationAlertDestination() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			destinationId,
			data,
		}: {
			corporationId: string
			destinationId: string
			data: UpdateCorporationAlertDestinationRequest
		}) => api.updateCorporationAlertDestination(corporationId, destinationId, data),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.alerts(corporationId),
				refetchType: 'active',
			})
		},
	})
}

export function useDeleteCorporationAlertDestination() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, destinationId }: { corporationId: string; destinationId: string }) =>
			api.deleteCorporationAlertDestination(corporationId, destinationId),
		onSuccess: (_, { corporationId }) => {
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.alerts(corporationId),
				refetchType: 'active',
			})
		},
	})
}

