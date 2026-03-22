import { useQuery } from '@tanstack/react-query'

import { entityApi } from '@/lib/entity-api'

export const entityKeys = {
	all: ['entities'] as const,
	names: (ids: string[]) => [...entityKeys.all, 'names', ids] as const,
}

const ENTITY_NAME_BATCH_SIZE = 200

function chunkIds(ids: string[], size: number): string[][] {
	const chunks: string[][] = []
	for (let index = 0; index < ids.length; index += size) {
		chunks.push(ids.slice(index, index + size))
	}
	return chunks
}

export function useEntityNames(
	ids: string[],
	options?: {
		enabled?: boolean
	}
) {
	const normalizedIds = [...new Set(ids.filter(Boolean))].sort()
	return useQuery({
		queryKey: entityKeys.names(normalizedIds),
		queryFn: async () => {
			const batches = chunkIds(normalizedIds, ENTITY_NAME_BATCH_SIZE)
			const results = await Promise.all(
				batches.map((batch) =>
					entityApi.resolveEntityNames({
						ids: batch,
					})
				)
			)
			const merged: Record<string, string> = {}
			for (const result of results) {
				Object.assign(merged, result)
			}
			return merged
		},
		staleTime: 1000 * 60 * 15,
		enabled: (options?.enabled ?? true) && normalizedIds.length > 0,
	})
}
