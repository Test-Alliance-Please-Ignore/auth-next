import type { StructureListQuery } from '@/lib/api'

export const structureKeys = {
	all: ['structures'] as const,
	list: (query: StructureListQuery) => [...structureKeys.all, 'list', query] as const,
	detail: (structureId: string) => [...structureKeys.all, 'detail', structureId] as const,
	config: () => [...structureKeys.all, 'config'] as const,
}
