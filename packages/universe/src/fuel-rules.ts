/**
 * Static-data-derived fuel rules used by structure synchronization.
 */
export interface UniverseFuelModuleRule {
	typeId: string
	typeName: string
	serviceGroupId: string
	fuelUnitsPerHour: number
}

export interface UniverseStructureFuelModifier {
	serviceGroupId: string
	modifierPercent: number
}

export interface UniverseFuelRuleResolution {
	sdeVersion: string | null
	modulesByServiceName: Record<string, UniverseFuelModuleRule | null>
	structureModifiersByTypeId: Record<string, UniverseStructureFuelModifier[]>
	unresolvedServiceNames: string[]
	missingStructureTypeIds: string[]
}

export function normalizeUniverseServiceName(name: string): string {
	return name.normalize('NFKC').trim().toLowerCase()
}
