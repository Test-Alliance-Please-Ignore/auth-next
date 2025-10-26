import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

export interface User {
	id: string
	mainCharacterId: string
	characters: Array<{
		characterId: string
		characterName: string
		hasValidToken: boolean
	}>
	is_admin: boolean
	discord?: {
		userId: string
		username: string
		discriminator: string
		authRevoked: boolean
		authRevokedAt: string | null
		lastSuccessfulAuth: string | null
	}
}

interface SessionResponse {
	authenticated: boolean
	user: User | null
}

/**
 * Hook to check authentication status and get current user
 */
export function useAuth() {
	const { data, isLoading, error, refetch } = useQuery<SessionResponse>({
		queryKey: ['auth', 'session'],
		queryFn: () => apiClient.get<SessionResponse>('/auth/session'),
		retry: false,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})

	return {
		user: data?.user ?? null,
		isAuthenticated: data?.authenticated ?? false,
		isLoading,
		error,
		refetch,
	}
}

/**
 * Hook to handle logout
 */
export function useLogout() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: () => apiClient.post('/auth/logout'),
		onSuccess: () => {
			// Clear auth cache
			queryClient.setQueryData(['auth', 'session'], {
				authenticated: false,
				user: null,
			})
			// Redirect to landing page
			window.location.href = '/'
		},
	})
}
