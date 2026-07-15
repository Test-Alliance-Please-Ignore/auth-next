import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StructureTab } from '@repo/structures'

import { api } from '@/lib/api'

import { structureKeys } from './query-keys'

import type { UseQueryOptions } from '@tanstack/react-query'
import type {
	StructureCitadelListQuery,
	StructureCitadelListResponse,
	StructureMiningCitadelListQuery,
	StructureMiningCitadelListResponse,
	StructureMoonDrillListQuery,
	StructureMoonDrillListResponse,
	StructureNavigationListQuery,
	StructureNavigationListResponse,
	StructureOverviewMetrics,
	StructureSkyhookListQuery,
	StructureSkyhookListResponse,
	StructureSovereigntyListQuery,
	StructureSovereigntyListResponse,
	StructureModuleConfig,
	UpdateStructureModuleConfigRequest,
	StructureTabListResponse,
} from '@/lib/api'

type StructureTabQuery =
	| StructureCitadelListQuery
	| StructureNavigationListQuery
	| StructureSovereigntyListQuery
	| StructureSkyhookListQuery
	| StructureMiningCitadelListQuery
	| StructureMoonDrillListQuery

function createStructureListQueryOptions<TResponse>(
	queryKey: readonly unknown[],
	queryFn: () => Promise<TResponse>,
	options: Pick<UseQueryOptions<TResponse>, 'enabled'> = {}
) {
	return {
		queryKey,
		queryFn,
		placeholderData: keepPreviousData,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
		enabled: options.enabled ?? true,
	} satisfies UseQueryOptions<TResponse>
}

export function useCitadelStructures(
	query: StructureCitadelListQuery,
	options: Pick<UseQueryOptions<StructureCitadelListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureCitadelListResponse>(
		createStructureListQueryOptions(structureKeys.citadels(query), () => api.getCitadelStructures(query), options)
	)
}

export function useNavigationStructures(
	query: StructureNavigationListQuery,
	options: Pick<UseQueryOptions<StructureNavigationListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureNavigationListResponse>(
		createStructureListQueryOptions(
			structureKeys.navigation(query),
			() => api.getNavigationStructures(query),
			options
		)
	)
}

export function useSovereigntyStructures(
	query: StructureSovereigntyListQuery,
	options: Pick<UseQueryOptions<StructureSovereigntyListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureSovereigntyListResponse>(
		createStructureListQueryOptions(
			structureKeys.sovereignty(query),
			() => api.getSovereigntyStructures(query),
			options
		)
	)
}

export function useSkyhookStructures(
	query: StructureSkyhookListQuery,
	options: Pick<UseQueryOptions<StructureSkyhookListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureSkyhookListResponse>(
		createStructureListQueryOptions(structureKeys.skyhooks(query), () => api.getSkyhookStructures(query), options)
	)
}

export function useMiningCitadelStructures(
	query: StructureMiningCitadelListQuery,
	options: Pick<UseQueryOptions<StructureMiningCitadelListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureMiningCitadelListResponse>(
		createStructureListQueryOptions(
			structureKeys.miningCitadels(query),
			() => api.getMiningCitadelStructures(query),
			options
		)
	)
}

export function useMoonDrillStructures(
	query: StructureMoonDrillListQuery,
	options: Pick<UseQueryOptions<StructureMoonDrillListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureMoonDrillListResponse>(
		createStructureListQueryOptions(structureKeys.moonDrills(query), () => api.getMoonDrillStructures(query), options)
	)
}

export function useStructureOverviewMetrics(
	options: Pick<UseQueryOptions<StructureOverviewMetrics>, 'enabled'> = {}
) {
	return useQuery<StructureOverviewMetrics>({
		queryKey: structureKeys.overview(),
		queryFn: () => api.getStructureOverviewMetrics(),
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
		enabled: options.enabled ?? true,
	})
}

export function useStructures(
	query: StructureCitadelListQuery,
	options: Pick<UseQueryOptions<StructureCitadelListResponse>, 'enabled'> = {}
) {
	return useCitadelStructures(query, options)
}

export function useStructuresForTab(
	tab: StructureTab,
	query: StructureTabQuery,
	options: Pick<UseQueryOptions<
		StructureTabListResponse
	>, 'enabled'> = {}
) {
	const queryKey = (() => {
		switch (tab) {
			case 'citadels':
				return structureKeys.citadels(query)
			case 'navigation':
				return structureKeys.navigation(query)
			case 'sovereignty':
				return structureKeys.sovereignty(query)
			case 'skyhooks':
				return structureKeys.skyhooks(query)
			case 'mining-citadels':
				return structureKeys.miningCitadels(query)
			case 'moon-drills':
				return structureKeys.moonDrills(query)
		}
		throw new Error(`Unknown structures tab: ${tab}`)
	})()

	return useQuery<StructureTabListResponse>({
		queryKey,
		queryFn: () => {
			switch (tab) {
				case 'citadels':
					return api.getCitadelStructures(query)
				case 'navigation':
					return api.getNavigationStructures(query)
				case 'sovereignty':
					return api.getSovereigntyStructures(query)
				case 'skyhooks':
					return api.getSkyhookStructures(query)
				case 'mining-citadels':
					return api.getMiningCitadelStructures(query)
				case 'moon-drills':
					return api.getMoonDrillStructures(query)
			}
			throw new Error(`Unknown structures tab: ${tab}`)
		},
		placeholderData: keepPreviousData,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 5,
		enabled: options.enabled ?? true,
	})
}

export function useStructureQueryManager() {
	const queryClient = useQueryClient()

	return {
		invalidateStructures: () => queryClient.invalidateQueries({ queryKey: structureKeys.all }),
		refetchStructures: () => queryClient.refetchQueries({ queryKey: structureKeys.all }),
		invalidateStructureOverview: () => queryClient.invalidateQueries({ queryKey: structureKeys.overview() }),
		refetchStructureOverview: () => queryClient.refetchQueries({ queryKey: structureKeys.overview() }),
	}
}

export function useStructureModuleConfig(
	options: Pick<UseQueryOptions<StructureModuleConfig>, 'enabled'> = {}
) {
	return useQuery<StructureModuleConfig>({
		queryKey: structureKeys.config(),
		queryFn: () => api.getStructureModuleConfig(),
		staleTime: 1000 * 30,
		enabled: options.enabled ?? true,
	})
}

export function useUpdateStructureModuleConfig() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: UpdateStructureModuleConfigRequest) => api.updateStructureModuleConfig(data),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: structureKeys.config() })
			await queryClient.invalidateQueries({ queryKey: structureKeys.all })
		},
	})
}
