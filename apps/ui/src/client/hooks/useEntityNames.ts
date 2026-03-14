import { useQuery } from '@tanstack/react-query'

import { entityApi } from '@/lib/entity-api'

export const entityKeys = {
	all: ['entities'] as const,
	names: (ids: string[]) => [...entityKeys.all, 'names', ids] as const,
}

export function useEntityNames(
	ids: string[],
	options?: {
		enabled?: boolean
	}
) {
	const normalizedIds = [...new Set(ids.filter(Boolean))].sort()
	return useQuery({
		queryKey: entityKeys.names(normalizedIds),
		queryFn: () =>
			entityApi.resolveEntityNames({
				ids: normalizedIds,
			}),
		staleTime: 1000 * 60 * 15,
		enabled: (options?.enabled ?? true) && normalizedIds.length > 0,
	})
}
