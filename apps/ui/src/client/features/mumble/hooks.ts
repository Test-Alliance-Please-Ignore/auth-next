import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import { mumbleKeys } from './query-keys'

/** Current user's Mumble account status + connection info. */
export function useMumbleAccount(enabled = true) {
	return useQuery({
		queryKey: mumbleKeys.account(),
		queryFn: () => apiClient.getMumbleAccount(),
		// The API performs a best-effort on-demand sync with its own durable
		// cooldown. Do not turn tab focus into a recurring sync trigger.
		staleTime: 1000 * 60 * 5,
		refetchOnWindowFocus: false,
		enabled,
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
