import type {
	StructureCitadelListQuery,
	StructureMiningListQuery,
	StructureNavigationListQuery,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
} from '@/lib/api'

type StructureTabQuery =
	| StructureCitadelListQuery
	| StructureNavigationListQuery
	| StructureSovereigntyListQuery
	| StructureSkyhookListQuery
	| StructureMiningListQuery

export const structureKeys = {
	all: ['structures'] as const,
	overview: () => [...structureKeys.all, 'overview'] as const,
	citadels: (query: StructureTabQuery) => [...structureKeys.all, 'citadels', query] as const,
	navigation: (query: StructureTabQuery) => [...structureKeys.all, 'navigation', query] as const,
	sovereignty: (query: StructureTabQuery) => [...structureKeys.all, 'sovereignty', query] as const,
	skyhooks: (query: StructureTabQuery) => [...structureKeys.all, 'skyhooks', query] as const,
	mining: (query: StructureTabQuery) => [...structureKeys.all, 'mining', query] as const,
	detail: (structureId: string) => [...structureKeys.all, 'detail', structureId] as const,
	config: () => [...structureKeys.all, 'config'] as const,
}
