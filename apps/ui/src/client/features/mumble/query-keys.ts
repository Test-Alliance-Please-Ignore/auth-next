import type { TempopListFilters } from '@/lib/api'

export const mumbleKeys = {
	all: ['mumble'] as const,
	account: () => [...mumbleKeys.all, 'account'] as const,
	tempops: () => [...mumbleKeys.all, 'tempops'] as const,
	tempopList: (filters: TempopListFilters) => [...mumbleKeys.tempops(), filters] as const,
}
