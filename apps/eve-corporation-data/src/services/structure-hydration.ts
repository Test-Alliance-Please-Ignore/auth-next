export type StructureHydrationExistingFields = {
	name: string | null
	typeName: string | null
	systemName: string | null
	regionName: string | null
}

export type StructureHydrationResolvedFields = {
	name: string | null
	typeName: string | null
	systemName: string | null
	regionName: string | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
}

export function preserveStructureHydrationFields(
	existing: StructureHydrationExistingFields | null,
	resolved: StructureHydrationResolvedFields
): StructureHydrationResolvedFields {
	return {
		...resolved,
		name: resolved.name ?? existing?.name ?? null,
		typeName: resolved.typeName ?? existing?.typeName ?? null,
		systemName: resolved.systemName ?? existing?.systemName ?? null,
		regionName: resolved.regionName ?? existing?.regionName ?? null,
	}
}
