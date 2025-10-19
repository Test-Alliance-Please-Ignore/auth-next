import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'

interface User {
	id: string
	mainCharacterOwnerHash: string
	characters: Array<{
		characterOwnerHash: string
		characterId: number
		characterName: string
	}>
	is_admin: boolean
}

interface SessionResponse {
	authenticated: boolean
	user: User | null
}

/**
 * Hook to check authentication status and get current user
 */
export function useAuth() {
	const { data, isLoading, error } = useQuery<SessionResponse>({
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

/**
 * Store session token and refresh auth state
 */
export function useStoreSession() {
	const queryClient = useQueryClient()

	return (sessionToken: string) => {
		// Store in localStorage (or cookie if needed)
		localStorage.setItem('sessionToken', sessionToken)

		// Invalidate session query to refetch
		queryClient.invalidateQueries({ queryKey: ['auth', 'session'] })
	}
}
