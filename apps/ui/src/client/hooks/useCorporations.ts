import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	AddDirectorRequest,
	CorporationsFilters,
	CreateCorporationRequest,
	FetchCorporationDataRequest,
	UpdateCorporationRequest,
	UpdateDirectorPriorityRequest,
} from '@/lib/api'

// Query keys
export const corporationKeys = {
	all: ['admin', 'corporations'] as const,
	lists: () => [...corporationKeys.all, 'list'] as const,
	list: (filters?: CorporationsFilters) => [...corporationKeys.lists(), filters] as const,
	details: () => [...corporationKeys.all, 'detail'] as const,
	detail: (corporationId: string) => [...corporationKeys.details(), corporationId] as const,
	dataSummary: (corporationId: string) =>
		[...corporationKeys.detail(corporationId), 'data'] as const,
	search: (query: string) => [...corporationKeys.all, 'search', query] as const,
	directors: (corporationId: string) =>
		[...corporationKeys.detail(corporationId), 'directors'] as const,
}

// Queries

/**
 * Fetch all managed corporations (admin only)
 */
export function useCorporations(filters?: CorporationsFilters) {
	return useQuery({
		queryKey: corporationKeys.list(filters),
		queryFn: () => api.getCorporations(filters),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single corporation by ID with full details
 */
export function useCorporation(corporationId: string) {
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
export function useCorporationDataSummary(corporationId: string) {
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
			// Batch invalidations using a single call with broader pattern
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.all,
				refetchType: 'active', // Only refetch active queries
			})

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
		mutationFn: ({
			corporationId,
			data,
		}: {
			corporationId: string
			data: UpdateCorporationRequest
		}) => api.updateCorporation(corporationId, data),
		onSuccess: (updatedCorporation) => {
			// Update detail cache first (immediate update)
			queryClient.setQueryData(
				corporationKeys.detail(updatedCorporation.corporationId),
				updatedCorporation
			)

			// Then invalidate list to show updated data
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.lists(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Delete a corporation
 */
export function useDeleteCorporation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: string) => api.deleteCorporation(corporationId),
		onSuccess: (_, deletedId) => {
			// Remove related cache entries first (immediate cleanup)
			queryClient.removeQueries({ queryKey: corporationKeys.detail(deletedId) })
			queryClient.removeQueries({ queryKey: corporationKeys.dataSummary(deletedId) })
			queryClient.removeQueries({ queryKey: corporationKeys.directors(deletedId) })

			// Then invalidate list to remove from UI
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.lists(),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Verify corporation access (check director roles)
 */
export function useVerifyCorporationAccess() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: string) => api.verifyCorporationAccess(corporationId),
		onSuccess: (_, corporationId) => {
			// Batch invalidations for this specific corporation
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.detail(corporationId),
				refetchType: 'active',
			})

			// Also invalidate list, but less aggressively
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.lists(),
				refetchType: 'active',
			})
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
			corporationId: string
			data?: FetchCorporationDataRequest
		}) => api.fetchCorporationData(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			// Use Promise.all to batch invalidations for better performance
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: corporationKeys.detail(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.dataSummary(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.lists(),
					refetchType: 'active',
				}),
			])
		},
	})
}

// ===== Directors Hooks =====

/**
 * Fetch all directors for a corporation
 */
export function useDirectors(corporationId: string) {
	return useQuery({
		queryKey: corporationKeys.directors(corporationId),
		queryFn: () => api.getDirectors(corporationId),
		enabled: !!corporationId,
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Add a new director to a corporation
 */
export function useAddDirector() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, data }: { corporationId: string; data: AddDirectorRequest }) =>
			api.addDirector(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			// Batch invalidations for director-related data
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: corporationKeys.directors(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.detail(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.lists(),
					refetchType: 'active',
				}),
			])
		},
	})
}

/**
 * Remove a director from a corporation
 */
export function useRemoveDirector() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, characterId }: { corporationId: string; characterId: string }) =>
			api.removeDirector(corporationId, characterId),
		onSuccess: (_, { corporationId }) => {
			// Batch invalidations for director-related data
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: corporationKeys.directors(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.detail(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.lists(),
					refetchType: 'active',
				}),
			])
		},
	})
}

/**
 * Update a director's priority
 */
export function useUpdateDirectorPriority() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			corporationId,
			characterId,
			data,
		}: {
			corporationId: string
			characterId: string
			data: UpdateDirectorPriorityRequest
		}) => api.updateDirectorPriority(corporationId, characterId, data),
		onSuccess: (_, { corporationId }) => {
			// Only invalidate directors list since priority doesn't affect other data
			void queryClient.invalidateQueries({
				queryKey: corporationKeys.directors(corporationId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Verify a single director's health
 */
export function useVerifyDirector() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, directorId }: { corporationId: string; directorId: string }) =>
			api.verifyDirector(corporationId, directorId),
		onSuccess: (_, { corporationId }) => {
			// Batch invalidations for verification-related data
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: corporationKeys.directors(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.detail(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.lists(),
					refetchType: 'active',
				}),
			])
		},
	})
}

/**
 * Verify all directors' health
 */
export function useVerifyAllDirectors() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: string) => api.verifyAllDirectors(corporationId),
		onSuccess: (_, corporationId) => {
			// Batch invalidations for all verification-related data
			void Promise.all([
				queryClient.invalidateQueries({
					queryKey: corporationKeys.directors(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.detail(corporationId),
					refetchType: 'active',
				}),
				queryClient.invalidateQueries({
					queryKey: corporationKeys.lists(),
					refetchType: 'active',
				}),
			])
		},
	})
}
