/**
 * React Query Hooks for Doctrines Feature
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { doctrineKeys, fittingKeys } from './query-keys'

import type {
	CreateDoctrineRequest,
	CreateFittingRequest,
	Doctrine,
	DoctrineWithFittings,
	Fitting,
	FittingWithItems,
	ListDoctrinesFilters,
	ListFittingsFilters,
	UpdateDoctrineRequest,
	UpdateFittingRequest,
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
		mutationFn: ({ doctrineId, fittingId }: { doctrineId: string; fittingId: string }) =>
			api.addFittingToDoctrine(doctrineId, fittingId),
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
