import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import type { UserPermission } from '@/lib/api'

export interface User {
	id: string
	mainCharacterId: string
	characters: Array<{
		characterId: string
		characterName: string
		hasValidToken: boolean
	}>
	is_admin: boolean
	roles?: string[]
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

interface PermissionsResponse {
	permissions: UserPermission[]
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
	const permissionsQuery = useQuery<PermissionsResponse>({
		queryKey: ['auth', 'permissions', data?.user?.id],
		queryFn: () => apiClient.get<PermissionsResponse>('/auth/permissions'),
		enabled: data?.authenticated === true,
		retry: 2,
		staleTime: 1000 * 60 * 5,
	})
	const permissions = permissionsQuery.data?.permissions ?? []

	const user =
		data?.user == null
			? null
			: {
					...data.user,
					roles: data.user.roles ?? [],
					permissions,
				}

	return {
		user,
		permissions,
		isAuthenticated: data?.authenticated ?? false,
		isLoading,
		isPermissionsLoading: data?.authenticated === true && permissionsQuery.isLoading,
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
			queryClient.removeQueries({ queryKey: ['auth'] })
			// Redirect to landing page
			window.location.href = '/'
		},
	})
}
