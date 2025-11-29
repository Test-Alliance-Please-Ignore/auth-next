import { useQuery } from '@tanstack/react-query'

import { api, NotFoundError } from '@/lib/api'

import type { UserService } from '@/lib/api'

// Query keys
export const serviceKeys = {
	all: ['services'] as const,
	user: () => [...serviceKeys.all, 'user'] as const,
}

/**
 * Fetch user's enabled services
 * Only fetches when the user has linked their legacy auth account
 */
export function useUserServices(isLegacyAuthLinked: boolean) {
	return useQuery({
		queryKey: serviceKeys.user(),
		queryFn: async () => {
			try {
				return await api.get<UserService[]>('/users/me/services')
			} catch (error) {
				// If endpoint doesn't exist yet (404), return empty array
				if (error instanceof NotFoundError) {
					return []
				}
				throw error
			}
		},
		enabled: isLegacyAuthLinked,
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
	})
}
