import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { mumbleKeys } from './query-keys'
import { apiClient } from '@/lib/api'

/** Current user's Mumble account status + connection info. */
export function useMumbleAccount() {
	return useQuery({
		queryKey: mumbleKeys.account(),
		queryFn: () => apiClient.getMumbleAccount(),
		staleTime: 1000 * 30,
	})
}

/** Provision a Mumble account. The response password is shown exactly once. */
export function useProvisionMumbleAccount() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => apiClient.createMumbleAccount(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: mumbleKeys.account() })
		},
	})
}

/** Rotate the Mumble password. The response password is shown exactly once. */
export function useResetMumblePassword() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => apiClient.resetMumblePassword(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: mumbleKeys.account() })
		},
	})
}
