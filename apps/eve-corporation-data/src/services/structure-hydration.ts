export type StructureHydrationExistingFields = {
	name: string | null
	typeName: string | null
	systemName: string | null
	regionId?: string | null
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

/**
 * Type, system, and region metadata is immutable for the lifetime of a
 * structure ID. Re-run these lookups only for new or previously incomplete
 * structure rows.
 */
export function hasCompleteStructureStaticHydration(
	existing: Pick<
		StructureHydrationExistingFields,
		'typeName' | 'systemName' | 'regionId' | 'regionName'
	> | null
): boolean {
	return (
		existing !== null &&
		Boolean(existing.typeName) &&
		Boolean(existing.systemName) &&
		Boolean(existing.regionId) &&
		Boolean(existing.regionName)
	)
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
