import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { freightKeys } from './query-keys'

/**
 * Fetch active freight routes (user-facing)
 */
export function useActiveFreightRoutes() {
	return useQuery({
		queryKey: freightKeys.routes(),
		queryFn: () => api.getActiveFreightRoutes(),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
