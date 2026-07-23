import type {
	StructureCitadelListQuery,
	StructureMiningCitadelListQuery,
	StructureMoonDrillListQuery,
	StructureNavigationListQuery,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
} from '@/lib/api'

type StructureTabQuery =
	| StructureCitadelListQuery
	| StructureNavigationListQuery
	| StructureSovereigntyListQuery
	| StructureSkyhookListQuery
	| StructureMiningCitadelListQuery
	| StructureMoonDrillListQuery

export const structureKeys = {
	all: ['structures'] as const,
	citadels: (query: StructureTabQuery) => [...structureKeys.all, 'citadels', query] as const,
	navigation: (query: StructureTabQuery) => [...structureKeys.all, 'navigation', query] as const,
	sovereignty: (query: StructureTabQuery) => [...structureKeys.all, 'sovereignty', query] as const,
	skyhooks: (query: StructureTabQuery) => [...structureKeys.all, 'skyhooks', query] as const,
	miningCitadels: (query: StructureTabQuery) => [...structureKeys.all, 'mining-citadels', query] as const,
	moonDrills: (query: StructureTabQuery) => [...structureKeys.all, 'moon-drills', query] as const,
	detail: (structureId: string) => [...structureKeys.all, 'detail', structureId] as const,
	config: () => [...structureKeys.all, 'config'] as const,
}
