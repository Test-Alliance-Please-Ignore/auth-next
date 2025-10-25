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

	// If we have a session token in localStorage but the query is still loading or failed,
	// assume we're still authenticated (network issue, not auth issue).
	// Only mark as not authenticated if the query succeeded and returned authenticated: false
	const hasSessionToken = typeof window !== 'undefined' && !!localStorage.getItem('sessionToken')
	const querySucceeded = !isLoading && !error
	const isAuthenticated = querySucceeded ? (data?.authenticated ?? false) : hasSessionToken

	return {
		user: data?.user ?? null,
		isAuthenticated,
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
			// Clear session token from localStorage
			if (typeof window !== 'undefined') {
				localStorage.removeItem('sessionToken')
			}
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
		void queryClient.invalidateQueries({ queryKey: ['auth', 'session'] })
	}
}
