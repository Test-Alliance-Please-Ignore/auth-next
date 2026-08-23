import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

const flagsQueryKey = ['feature-flags'] as const

export function useFeatureFlags() {
	return useQuery({
		queryKey: flagsQueryKey,
		queryFn: () => api.getFeatureFlags(),
		staleTime: 1000 * 60 * 5, // 5 minutes
		// Keep the response shape stable while loading. Consumers that gate routes
		// must also honor isPlaceholderData before treating a flag as resolved.
		placeholderData: {} as Record<string, boolean>,
	})
}

export function useFeatureFlag(key: string, defaultValue = true): boolean {
	const { data } = useFeatureFlags()
	if (!data || !(key in data)) return defaultValue
	return data[key]
}
