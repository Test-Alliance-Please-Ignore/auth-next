import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { freightApi } from '@/lib/freight-api'

import type {
	CreateFreightRouteInput,
	FreightRoute,
	FreightRouteStatus,
	UpdateFreightRouteInput,
} from '@repo/freight'

// Query keys
export const freightRouteKeys = {
	all: ['freight-routes'] as const,
	lists: () => [...freightRouteKeys.all, 'list'] as const,
	list: (filters?: { status?: FreightRouteStatus }) => [...freightRouteKeys.lists(), filters] as const,
	details: () => [...freightRouteKeys.all, 'detail'] as const,
	detail: (id: string) => [...freightRouteKeys.details(), id] as const,
}

/**
 * Fetch freight routes with optional filters
 */
export function useFreightRoutes(filters?: { status?: FreightRouteStatus }) {
	return useQuery({
		queryKey: freightRouteKeys.list(filters),
		queryFn: () => freightApi.listRoutes(filters),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single freight route by ID
 */
export function useFreightRoute(id: string) {
	return useQuery({
		queryKey: freightRouteKeys.detail(id),
		queryFn: () => freightApi.getRoute(id),
		enabled: !!id,
	})
}

/**
 * Create a new freight route
 */
export function useCreateFreightRoute() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateFreightRouteInput) => freightApi.createRoute(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.lists() })
		},
	})
}

/**
 * Update an existing freight route
 */
export function useUpdateFreightRoute() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateFreightRouteInput }) =>
			freightApi.updateRoute(id, data),
		onSuccess: (updatedRoute) => {
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.detail(updatedRoute.id) })
		},
	})
}

/**
 * Activate a freight route
 */
export function useActivateFreightRoute() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => freightApi.activateRoute(id),
		onSuccess: (updatedRoute) => {
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.detail(updatedRoute.id) })
		},
	})
}

/**
 * Deactivate a freight route
 */
export function useDeactivateFreightRoute() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => freightApi.deactivateRoute(id),
		onSuccess: (updatedRoute) => {
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: freightRouteKeys.detail(updatedRoute.id) })
		},
	})
}
