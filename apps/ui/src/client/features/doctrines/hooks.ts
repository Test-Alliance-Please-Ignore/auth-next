/**
 * React Query Hooks for Doctrines Feature
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { doctrineKeys, doctrineCategoryKeys, fittingKeys, stagingSystemKeys } from './query-keys'

import type {
	AddFittingToDoctrineRequest,
	CreateDoctrineRequest,
	CreateFittingRequest,
	UpdateDoctrineRequest,
	UpdateDoctrineFittingRequest,
	UpdateFittingRequest,
	ListDoctrinesFilters,
	ListFittingsFilters,
} from './types'

// ============================================
// DOCTRINE QUERIES
// ============================================

/**
 * Fetch all doctrines with optional filters
 */
export function useDoctrines(filters?: ListDoctrinesFilters) {
	return useQuery({
		queryKey: doctrineKeys.list(filters),
		queryFn: () => api.getDoctrines(filters),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Fetch a single doctrine with its fittings
 */
export function useDoctrine(id: string | undefined) {
	return useQuery({
		queryKey: doctrineKeys.detail(id!),
		queryFn: () => api.getDoctrine(id!),
		enabled: !!id,
		staleTime: 1000 * 60, // 1 minute
	})
}

// ============================================
// DOCTRINE MUTATIONS
// ============================================

/**
 * Create a new doctrine
 */
export function useCreateDoctrine() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateDoctrineRequest) => api.createDoctrine(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
		},
	})
}

/**
 * Update an existing doctrine
 */
export function useUpdateDoctrine() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateDoctrineRequest }) =>
			api.updateDoctrine(id, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.id) })
		},
	})
}

/**
 * Delete a doctrine
 */
export function useDeleteDoctrine() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteDoctrine(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
		},
	})
}

/**
 * Add a fitting to a doctrine
 */
export function useAddFittingToDoctrine() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ doctrineId, ...data }: { doctrineId: string } & AddFittingToDoctrineRequest) =>
			api.addFittingToDoctrine(doctrineId, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.doctrineId) })
		},
	})
}

/**
 * Remove a fitting from a doctrine
 */
export function useRemoveFittingFromDoctrine() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ doctrineId, fittingId }: { doctrineId: string; fittingId: string }) =>
			api.removeFittingFromDoctrine(doctrineId, fittingId),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.doctrineId) })
		},
	})
}

/**
 * Update a fitting's category/sort within a doctrine
 */
export function useUpdateDoctrineFitting() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			doctrineId,
			fittingId,
			data,
		}: {
			doctrineId: string
			fittingId: string
			data: UpdateDoctrineFittingRequest
		}) => api.updateDoctrineFitting(doctrineId, fittingId, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.doctrineId) })
		},
	})
}

// ============================================
// FITTING QUERIES
// ============================================

/**
 * Fetch all fittings with optional filters
 */
export function useFittings(filters?: ListFittingsFilters) {
	return useQuery({
		queryKey: fittingKeys.list(filters),
		queryFn: () => api.getFittings(filters),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Fetch a single fitting with its items
 */
export function useFitting(id: string | undefined) {
	return useQuery({
		queryKey: fittingKeys.detail(id!),
		queryFn: () => api.getFitting(id!),
		enabled: !!id,
		staleTime: 1000 * 60, // 1 minute
	})
}

// ============================================
// FITTING MUTATIONS
// ============================================

/**
 * Create a new fitting
 */
export function useCreateFitting() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateFittingRequest) => api.createFitting(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: fittingKeys.all })
		},
	})
}

/**
 * Update an existing fitting
 */
export function useUpdateFitting() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateFittingRequest }) =>
			api.updateFitting(id, data),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: fittingKeys.all })
			queryClient.invalidateQueries({ queryKey: fittingKeys.detail(variables.id) })
			// Also invalidate doctrine queries so category changes reflect in doctrine detail
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
		},
	})
}

/**
 * Delete a fitting
 */
export function useDeleteFitting() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteFitting(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: fittingKeys.all })
		},
	})
}

// ============================================
// FITTING ADMIN QUERIES
// ============================================

/**
 * Fetch all fittings with their doctrine associations (admin only)
 */
export function useFittingsWithDoctrines() {
	return useQuery({
		queryKey: fittingKeys.withDoctrines(),
		queryFn: () => api.getFittingsWithDoctrines(),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Save a fitting to a character's in-game fitting list via ESI
 */
export function useSaveFittingIngame() {
	return useMutation({
		mutationFn: ({ fittingId, characterId }: { fittingId: string; characterId: string }) =>
			api.saveFittingIngame(fittingId, characterId),
	})
}

// ============================================
// CATEGORY QUERIES & MUTATIONS
// ============================================

export function useDoctrineCategories() {
	return useQuery({
		queryKey: doctrineCategoryKeys.all,
		queryFn: () => api.getDoctrineCategories(),
		staleTime: 1000 * 60 * 5,
	})
}

export function useCreateDoctrineCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: { name: string; sortOrder?: number }) => api.createDoctrineCategory(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: doctrineCategoryKeys.all })
		},
	})
}

export function useUpdateDoctrineCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: { name?: string; sortOrder?: number } }) =>
			api.updateDoctrineCategory(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: doctrineCategoryKeys.all })
		},
	})
}

export function useDeleteDoctrineCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteDoctrineCategory(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: doctrineCategoryKeys.all })
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
		},
	})
}

// ============================================
// STAGING SYSTEM QUERIES & MUTATIONS
// ============================================

export function useStagingSystems() {
	return useQuery({
		queryKey: stagingSystemKeys.all,
		queryFn: () => api.getStagingSystems(),
		staleTime: 1000 * 60 * 5,
	})
}

export function useCreateStagingSystem() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: { solarSystemId: string; solarSystemName: string; sortOrder?: number }) =>
			api.createStagingSystem(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: stagingSystemKeys.all })
		},
	})
}

export function useUpdateStagingSystem() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: { solarSystemId?: string; solarSystemName?: string; sortOrder?: number } }) =>
			api.updateStagingSystem(id, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: stagingSystemKeys.all })
		},
	})
}

export function useDeleteStagingSystem() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteStagingSystem(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: stagingSystemKeys.all })
			queryClient.invalidateQueries({ queryKey: doctrineKeys.all })
		},
	})
}

// ============================================
// DOCTRINE-STAGING MUTATIONS
// ============================================

export function useSetDoctrineStagingSystem() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ doctrineId, stagingSystemId, note }: { doctrineId: string; stagingSystemId: string; note: string }) =>
			api.setDoctrineStagingSystem(doctrineId, { stagingSystemId, note }),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.doctrineId) })
		},
	})
}

export function useRemoveDoctrineStagingSystem() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ doctrineId, stagingSystemId }: { doctrineId: string; stagingSystemId: string }) =>
			api.removeDoctrineStagingSystem(doctrineId, stagingSystemId),
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: doctrineKeys.detail(variables.doctrineId) })
		},
	})
}
