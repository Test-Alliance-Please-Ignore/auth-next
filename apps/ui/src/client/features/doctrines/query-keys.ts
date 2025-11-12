/**
 * Query Key Factory for Doctrines Feature
 *
 * Centralized query key management for React Query
 */

import type { ListDoctrinesFilters, ListFittingsFilters } from './types'

export const doctrineKeys = {
	all: ['doctrines'] as const,
	lists: () => [...doctrineKeys.all, 'list'] as const,
	list: (filters?: ListDoctrinesFilters) => [...doctrineKeys.lists(), filters] as const,
	details: () => [...doctrineKeys.all, 'detail'] as const,
	detail: (id: string) => [...doctrineKeys.details(), id] as const,
}

export const fittingKeys = {
	all: ['fittings'] as const,
	lists: () => [...fittingKeys.all, 'list'] as const,
	list: (filters?: ListFittingsFilters) => [...fittingKeys.lists(), filters] as const,
	details: () => [...fittingKeys.all, 'detail'] as const,
	detail: (id: string) => [...fittingKeys.details(), id] as const,
}
