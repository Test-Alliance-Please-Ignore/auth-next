import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { structureKeys } from './query-keys'

import type { UseQueryOptions } from '@tanstack/react-query'
import type { StructureTab } from '@repo/structures'
import type {
	StructureListQuery,
	StructureMainListResponse,
	StructureMiningCitadelListQuery,
	StructureMiningCitadelListResponse,
	StructureModuleConfig,
	StructureMoonDrillListQuery,
	StructureMoonDrillListResponse,
	StructureSkyhookListQuery,
	StructureSkyhookListResponse,
	StructureSovereigntyListQuery,
	StructureSovereigntyListResponse,
	StructureTabListResponse,
	UpdateStructureModuleConfigRequest,
} from '@/lib/api'

type StructureTabQuery =
	| StructureListQuery
	| StructureSovereigntyListQuery
	| StructureSkyhookListQuery
	| StructureMiningCitadelListQuery
	| StructureMoonDrillListQuery

const STRUCTURE_LIST_STALE_TIME = 1000 * 60 * 15
const STRUCTURE_LIST_GC_TIME = 1000 * 60 * 60
const STRUCTURE_CONFIG_STALE_TIME = 1000 * 60 * 30

function createStructureListQueryOptions<TResponse>(
	queryKey: readonly unknown[],
	queryFn: () => Promise<TResponse>,
	options: Pick<UseQueryOptions<TResponse>, 'enabled'> = {}
) {
	return {
		queryKey,
		queryFn,
		placeholderData: keepPreviousData,
		staleTime: STRUCTURE_LIST_STALE_TIME,
		gcTime: STRUCTURE_LIST_GC_TIME,
		enabled: options.enabled ?? true,
	} satisfies UseQueryOptions<TResponse>
}

export function useStructures(
	query: StructureListQuery,
	options: Pick<UseQueryOptions<StructureMainListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureMainListResponse>(
		createStructureListQueryOptions(
			structureKeys.structures(query),
			() => api.getStructures(query),
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
		createStructureListQueryOptions(
			structureKeys.skyhooks(query),
			() => api.getSkyhookStructures(query),
			options
		)
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
		createStructureListQueryOptions(
			structureKeys.moonDrills(query),
			() => api.getMoonDrillStructures(query),
			options
		)
	)
}

export function useStructuresForTab(
	tab: StructureTab,
	query: StructureTabQuery,
	options: Pick<UseQueryOptions<StructureTabListResponse>, 'enabled'> = {}
) {
	const queryKey = (() => {
		switch (tab) {
			case 'structures':
				return structureKeys.structures(query)
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
				case 'structures':
					return api.getStructures(query as StructureListQuery)
				case 'sovereignty':
					return api.getSovereigntyStructures(query as StructureSovereigntyListQuery)
				case 'skyhooks':
					return api.getSkyhookStructures(query as StructureSkyhookListQuery)
				case 'mining-citadels':
					return api.getMiningCitadelStructures(query as StructureMiningCitadelListQuery)
				case 'moon-drills':
					return api.getMoonDrillStructures(query as StructureMoonDrillListQuery)
			}
			throw new Error(`Unknown structures tab: ${tab}`)
		},
		placeholderData: keepPreviousData,
		staleTime: STRUCTURE_LIST_STALE_TIME,
		gcTime: STRUCTURE_LIST_GC_TIME,
		enabled: options.enabled ?? true,
	})
}

export function useStructureQueryManager() {
	const queryClient = useQueryClient()

	return {
		invalidateStructures: () => queryClient.invalidateQueries({ queryKey: structureKeys.all }),
		refetchStructures: () => queryClient.refetchQueries({ queryKey: structureKeys.all }),
	}
}

export function useStructureModuleConfig(
	options: Pick<UseQueryOptions<StructureModuleConfig>, 'enabled'> = {}
) {
	return useQuery<StructureModuleConfig>({
		queryKey: structureKeys.config(),
		queryFn: () => api.getStructureModuleConfig(),
		staleTime: STRUCTURE_CONFIG_STALE_TIME,
		gcTime: STRUCTURE_LIST_GC_TIME,
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
