/**
 * Query key factory for user-facing Bills feature
 * Provides consistent, type-safe query keys for React Query
 */
export const userBillsKeys = {
	all: ['user-bills'] as const,

	// List bills
	list: (params?: Record<string, unknown>) => [...userBillsKeys.all, 'list', params] as const,
	partySearch: (params: Record<string, unknown>) =>
		[...userBillsKeys.all, 'party-search', params] as const,

	// Single bill detail
	detail: (billId: string) => [...userBillsKeys.all, 'detail', billId] as const,
}
