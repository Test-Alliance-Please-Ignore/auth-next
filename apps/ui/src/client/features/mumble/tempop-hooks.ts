import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { mumbleKeys } from './query-keys'
import { apiClient } from '@/lib/api'

import type { TempopListFilters } from '@/lib/api'

/** List temp-ops with the given filters. */
export function useTempops(filters: TempopListFilters, enabled = true) {
	return useQuery({
		queryKey: mumbleKeys.tempopList(filters),
		queryFn: () => apiClient.listTempops(filters),
		staleTime: 1000 * 15,
		enabled,
	})
}

/** Create a temp-op. The response token is shown exactly once. */
export function useCreateTempop() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { ttlPreset?: '1h' | '4h' | '6h'; customHours?: number }) =>
			apiClient.createTempop(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: mumbleKeys.tempops() })
		},
	})
}

/** Delete a temp-op, disconnecting all of its guests. */
export function useDeleteTempop() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: string) => apiClient.deleteTempop(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: mumbleKeys.tempops() })
		},
	})
}
