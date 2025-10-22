import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
	AddDirectorRequest,
	CreateCorporationRequest,
	FetchCorporationDataRequest,
	UpdateCorporationRequest,
	UpdateDirectorPriorityRequest,
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
	directors: (corporationId: number) => [...corporationKeys.detail(corporationId), 'directors'] as const,
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

// ===== Directors Hooks =====

/**
 * Fetch all directors for a corporation
 */
export function useDirectors(corporationId: number) {
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
		mutationFn: ({ corporationId, data }: { corporationId: number; data: AddDirectorRequest }) =>
			api.addDirector(corporationId, data),
		onSuccess: (_, { corporationId }) => {
			// Invalidate directors list
			queryClient.invalidateQueries({ queryKey: corporationKeys.directors(corporationId) })

			// Invalidate corporation detail to update healthy director count
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate lists to show updated director count
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
		},
	})
}

/**
 * Remove a director from a corporation
 */
export function useRemoveDirector() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, characterId }: { corporationId: number; characterId: number }) =>
			api.removeDirector(corporationId, characterId),
		onSuccess: (_, { corporationId }) => {
			// Invalidate directors list
			queryClient.invalidateQueries({ queryKey: corporationKeys.directors(corporationId) })

			// Invalidate corporation detail to update healthy director count
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate lists to show updated director count
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
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
			corporationId: number
			characterId: number
			data: UpdateDirectorPriorityRequest
		}) => api.updateDirectorPriority(corporationId, characterId, data),
		onSuccess: (_, { corporationId }) => {
			// Invalidate directors list to show updated priority
			queryClient.invalidateQueries({ queryKey: corporationKeys.directors(corporationId) })
		},
	})
}

/**
 * Verify a single director's health
 */
export function useVerifyDirector() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ corporationId, directorId }: { corporationId: number; directorId: string }) =>
			api.verifyDirector(corporationId, directorId),
		onSuccess: (_, { corporationId }) => {
			// Invalidate directors list to show updated health status
			queryClient.invalidateQueries({ queryKey: corporationKeys.directors(corporationId) })

			// Invalidate corporation detail to update healthy director count
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate lists to show updated health status
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
		},
	})
}

/**
 * Verify all directors' health
 */
export function useVerifyAllDirectors() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (corporationId: number) => api.verifyAllDirectors(corporationId),
		onSuccess: (_, corporationId) => {
			// Invalidate directors list to show updated health statuses
			queryClient.invalidateQueries({ queryKey: corporationKeys.directors(corporationId) })

			// Invalidate corporation detail to update verification status and healthy count
			queryClient.invalidateQueries({ queryKey: corporationKeys.detail(corporationId) })

			// Invalidate lists to show updated verification status
			queryClient.invalidateQueries({ queryKey: corporationKeys.lists() })
		},
	})
}
