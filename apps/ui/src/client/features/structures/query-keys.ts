import type {
	StructureListQuery,
	StructureMiningCitadelListQuery,
	StructureMoonDrillListQuery,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
} from '@/lib/api'

type StructureTabQuery =
	| StructureListQuery
	| StructureSovereigntyListQuery
	| StructureSkyhookListQuery
	| StructureMiningCitadelListQuery
	| StructureMoonDrillListQuery

export const structureKeys = {
	all: ['structures'] as const,
	structures: (query: StructureTabQuery) => [...structureKeys.all, 'structures', query] as const,
	sovereignty: (query: StructureTabQuery) => [...structureKeys.all, 'sovereignty', query] as const,
	skyhooks: (query: StructureTabQuery) => [...structureKeys.all, 'skyhooks', query] as const,
	miningCitadels: (query: StructureTabQuery) =>
		[...structureKeys.all, 'mining-citadels', query] as const,
	moonDrills: (query: StructureTabQuery) => [...structureKeys.all, 'moon-drills', query] as const,
	detail: (structureId: string) => [...structureKeys.all, 'detail', structureId] as const,
	config: () => [...structureKeys.all, 'config'] as const,
}
