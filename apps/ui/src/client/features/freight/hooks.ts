import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { freightRouteKeys } from '@/hooks/useFreightRoutes'

/**
 * Fetch active freight routes (user-facing)
 */
export function useActiveFreightRoutes() {
	return useQuery({
		queryKey: freightRouteKeys.list({ status: 'active' }),
		queryFn: () => api.getActiveFreightRoutes(),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}
