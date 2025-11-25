/**
 * React Query Hooks for Industry Providers Feature
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { industryProviderKeys, industryStatsKeys } from '../query-keys'

import type {
	CreateIndustryProviderRequest,
	IndustryProviderFilters,
	ServiceStatus,
	ServiceType,
	UpdateIndustryProviderRequest,
} from '../types'

// ============================================
// PROVIDER QUERIES
// ============================================

/**
 * Fetch all providers with optional filters
 */
export function useIndustryProviders(filters?: IndustryProviderFilters) {
	return useQuery({
		queryKey: industryProviderKeys.list(filters),
		queryFn: () => api.getIndustryProviders(filters),
		staleTime: 1000 * 60, // 1 minute
	})
}

/**
 * Fetch a single provider by ID
 */
export function useIndustryProvider(id: string | undefined) {
	return useQuery({
		queryKey: industryProviderKeys.detail(id!),
		queryFn: () => api.getIndustryProvider(id!),
		enabled: !!id,
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Fetch services for a provider
 */
export function useProviderServices(providerId: string | undefined) {
	return useQuery({
		queryKey: industryProviderKeys.services(providerId!),
		queryFn: () => api.getProviderServices(providerId!),
		enabled: !!providerId,
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Fetch industry statistics
 */
export function useIndustryStats() {
	return useQuery({
		queryKey: industryStatsKeys.all,
		queryFn: () => api.getIndustryStats(),
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

// ============================================
// PROVIDER MUTATIONS
// ============================================

/**
 * Create a new provider
 */
export function useCreateIndustryProvider() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateIndustryProviderRequest) => api.createIndustryProvider(data),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.all })
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}

/**
 * Update an existing provider
 */
export function useUpdateIndustryProvider() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateIndustryProviderRequest }) =>
			api.updateIndustryProvider(id, data),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.all })
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.detail(variables.id) })
		},
	})
}

/**
 * Delete a provider
 */
export function useDeleteIndustryProvider() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteIndustryProvider(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.all })
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}

/**
 * Toggle provider accepting orders status
 */
export function useSetProviderAcceptingOrders() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, acceptingOrders }: { id: string; acceptingOrders: boolean }) =>
			api.setProviderAcceptingOrders(id, acceptingOrders),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.all })
			void queryClient.invalidateQueries({ queryKey: industryProviderKeys.detail(variables.id) })
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}

// ============================================
// SERVICE MUTATIONS
// ============================================

/**
 * Add a service to a provider
 */
export function useAddProviderService() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ providerId, serviceType }: { providerId: string; serviceType: ServiceType }) =>
			api.addProviderService(providerId, serviceType),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({
				queryKey: industryProviderKeys.services(variables.providerId),
			})
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}

/**
 * Remove a service from a provider
 */
export function useRemoveProviderService() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ providerId, serviceType }: { providerId: string; serviceType: ServiceType }) =>
			api.removeProviderService(providerId, serviceType),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({
				queryKey: industryProviderKeys.services(variables.providerId),
			})
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}

/**
 * Update a service's status
 */
export function useUpdateProviderServiceStatus() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			providerId,
			serviceType,
			status,
		}: {
			providerId: string
			serviceType: ServiceType
			status: ServiceStatus
		}) => api.updateProviderServiceStatus(providerId, serviceType, status),
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({
				queryKey: industryProviderKeys.services(variables.providerId),
			})
			void queryClient.invalidateQueries({ queryKey: industryStatsKeys.all })
		},
	})
}
