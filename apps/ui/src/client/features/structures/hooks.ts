import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { structureKeys } from './query-keys'

import type { UseQueryOptions } from '@tanstack/react-query'
import type {
	StructureListQuery,
	StructureListResponse,
	StructureModuleConfig,
	UpdateStructureModuleConfigRequest,
} from '@/lib/api'

export function useStructures(
	query: StructureListQuery,
	options: Pick<UseQueryOptions<StructureListResponse>, 'enabled'> = {}
) {
	return useQuery<StructureListResponse>({
		queryKey: structureKeys.list(query),
		queryFn: () => api.getStructures(query),
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
	}
}

export function useStructureModuleConfig() {
	return useQuery<StructureModuleConfig>({
		queryKey: structureKeys.config(),
		queryFn: () => api.getStructureModuleConfig(),
		staleTime: 1000 * 30,
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
