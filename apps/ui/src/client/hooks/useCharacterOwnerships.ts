import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

export type CharacterOwnershipMap = Record<string, { userId: string }>

export const characterOwnershipKeys = {
	all: ['character-ownership'] as const,
	byId: (id: string) => [...characterOwnershipKeys.all, 'id', id] as const,
	byIds: (ids: string[]) => [...characterOwnershipKeys.all, 'ids', ids] as const,
}

const CHARACTER_OWNERSHIP_BATCH_SIZE = 200

function chunkIds(ids: string[], size: number): string[][] {
	const chunks: string[][] = []
	for (let index = 0; index < ids.length; index += size) {
		chunks.push(ids.slice(index, index + size))
	}
	return chunks
}

export function useCharacterOwnerships(
	ids: string[],
	options?: {
		enabled?: boolean
	},
) {
	const normalizedIds = [...new Set(ids.filter(Boolean))].sort()
	return useQuery<CharacterOwnershipMap>({
		queryKey: characterOwnershipKeys.byIds(normalizedIds),
		queryFn: async () => {
			const batches = chunkIds(normalizedIds, CHARACTER_OWNERSHIP_BATCH_SIZE)
			const results = await Promise.all(
				batches.map((batch) => apiClient.getCharacterOwnerships(batch)),
			)
			return Object.assign({}, ...results)
		},
		staleTime: 1000 * 60 * 15,
		enabled: (options?.enabled ?? true) && normalizedIds.length > 0,
	})
}

export function useCharacterOwnership(characterId: string, options?: { enabled?: boolean }) {
	return useQuery<{ userId: string } | null>({
		queryKey: characterOwnershipKeys.byId(characterId),
		queryFn: async () => {
			const result = await apiClient.getCharacterOwnerships([characterId])
			return result[characterId] ?? null
		},
		staleTime: 1000 * 60 * 15,
		enabled: (options?.enabled ?? true) && Boolean(characterId),
	})
}
