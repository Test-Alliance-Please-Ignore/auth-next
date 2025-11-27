import { useQuery } from '@tanstack/react-query'

import { api, NotFoundError } from '@/lib/api'

import type { LegacyCharacter } from './useAuth'

// Query keys
export const legacyCharacterKeys = {
	all: ['legacy', 'characters'] as const,
	list: () => [...legacyCharacterKeys.all, 'list'] as const,
}

/**
 * Fetch legacy characters that haven't been migrated yet
 * Only fetches when the user has linked their legacy auth account
 */
export function useLegacyCharacters(isLegacyAuthLinked: boolean) {
	return useQuery({
		queryKey: legacyCharacterKeys.list(),
		queryFn: async () => {
			try {
				return await api.get<LegacyCharacter[]>('/auth/legacy-auth/characters')
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
