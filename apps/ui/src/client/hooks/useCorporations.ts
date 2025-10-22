import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
	CreateCorporationRequest,
	UpdateCorporationRequest,
	FetchCorporationDataRequest,
} from '@/lib/api'

// Query keys
export const corporationKeys = {
	all: ['admin', 'corporations'] as const,
	lists: () => [...corporationKeys.all, 'list'] as const,
	list: () => [...corporationKeys.lists()] as const,
	details: () => [...corporationKeys.all, 'detail'] as const,
	detail: (corporationId: number) => [...corporationKeys.details(), corporationId] as const,
	dataSummary: (corporationId: number) => [...corporationKeys.detail(corporationId), 'data'] as const,
	search: (query: string) => [...corporationKeys.all, 'search', query] as const,
}

// Queries

/**
 * Fetch all managed corporations (admin only)
 */
export function useCorporations() {
	return useQuery({
		queryKey: corporationKeys.list(),
		queryFn: () => api.getCorporations(),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single corporation by ID with full details
 */
export function useCorporation(corporationId: number) {
	return useQuery({
		queryKey: corporationKeys.detail(corporationId),
		queryFn: () => api.getCorporation(corporationId),
		enabled: !!corporationId,
	})
}

/**
 * Search corporations by name or ticker
 */
export function useSearchCorporations(query: string, enabled = true) {
	return useQuery({
		queryKey: corporationKeys.search(query),
		queryFn: () => api.searchCorporations(query),
		enabled: enabled && query.length >= 2,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Get corporation data summary
 */
export function useCorporationDataSummary(corporationId: number) {
	return useQuery({
		queryKey: corporationKeys.dataSummary(corporationId),
		queryFn: () => api.getCorporationDataSummary(corporationId),
		enabled: !!corporationId,
		staleTime: 1000 * 60, // 1 minute
	})
}

// Mutations

/**
 * Create a new managed corporation
 */
export function useCreateCorporation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateCorporationRequest) => api.createCorporation(data),
		onSuccess: (newCorporation) => {
			// Invalidate corporation list
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })

			// Add to cache optimistically
			queryClient.setQueryData(corporationKeys.detail(newCorporation.corporationId), newCorporation)
		},
	})
}

/**
 * Update an existing corporation
 */
export function useUpdateCorporation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, data }: { corporationId: number; data: UpdateCorporationRequest }) =>
			api.updateCorporation(corporationId, data),
		onSuccess: (updatedCorporation) => {
			// Invalidate corporation list
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })

			// Update detail cache
			queryClient.setQueryData(
				corporationKeys.detail(updatedCorporation.corporationId),
				updatedCorporation
			)
		},
	})
}

/**
 * Delete a corporation
 */
export function useDeleteCorporation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: number) => api.deleteCorporation(corporationId),
		onSuccess: (_, deletedId) => {
			// Invalidate corporation list
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })

			// Remove from detail cache
			queryClient.removeQueries({ queryKey: corporationKeys.detail(deletedId) })

			// Remove data summary
			queryClient.removeQueries({ queryKey: corporationKeys.dataSummary(deletedId) })
		},
	})
}

/**
 * Verify corporation access (check director roles)
 */
export function useVerifyCorporationAccess() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: number) => api.verifyCorporationAccess(corporationId),
		onSuccess: (_, corporationId) => {
			// Invalidate corporation detail to refresh verification status
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate list to show updated status
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
		},
	})
}

/**
 * Fetch corporation data from ESI
 */
export function useFetchCorporationData() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			data,
		}: {
			corporationId: number
			data?: FetchCorporationDataRequest
		}) => api.fetchCorporationData(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			// Invalidate corporation detail to refresh last sync time
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate data summary to show new data
			queryClient.invalidateQueries({ queryKey: corporationKeys.dataSummary(corporationId) })

			// Invalidate list to show updated sync time
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
		},
	})
}
