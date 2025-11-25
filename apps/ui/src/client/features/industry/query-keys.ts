/**
 * Query Key Factory for Industry Feature
 *
 * Centralized query key management for React Query
 */

import type { IndustryProviderFilters } from './types'

export const industryProviderKeys = {
	all: ['admin', 'industry-providers'] as const,
	lists: () => [...industryProviderKeys.all, 'list'] as const,
	list: (filters?: IndustryProviderFilters) => [...industryProviderKeys.lists(), filters] as const,
	details: () => [...industryProviderKeys.all, 'detail'] as const,
	detail: (id: string) => [...industryProviderKeys.details(), id] as const,
	services: (providerId: string) => [...industryProviderKeys.detail(providerId), 'services'] as const,
}

export const industryStatsKeys = {
	all: ['admin', 'industry-stats'] as const,
}
