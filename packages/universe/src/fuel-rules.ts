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
	modulesByTypeId: Record<string, UniverseFuelModuleRule | null>
	builtInModulesByStructureTypeId: Record<string, UniverseFuelModuleRule | null>
	structureModifiersByTypeId: Record<string, UniverseStructureFuelModifier[]>
	unresolvedServiceNames: string[]
	missingStructureTypeIds: string[]
}

export function normalizeUniverseServiceName(name: string): string {
	return name.normalize('NFKC').trim().toLowerCase()
}

/**
 * ESI exposes human-readable service labels rather than the SDE service-module
 * type names. The labels have no stable SDE relationship. These fallbacks are
 * therefore only used for fitted services; built-in services are resolved from
 * the structure's SDE dogma data instead.
 */
export const UNIVERSE_ESI_SERVICE_MODULE_ALIASES: Readonly<Record<string, string>> = {
	'automatic moon drilling': 'standup metenox moon drill',
	'biochemical reactions': 'standup biochemical reactor i',
	'blueprint copying': 'standup research lab i',
	'clone bay': 'standup cloning center i',
	'composite reactions': 'standup composite reactor i',
	'conduit generation': 'standup conduit generator i',
	'cynosural field generation': 'standup cynosural field generator i',
	'cynosural system jammer': 'standup cynosural system jammer i',
	'hybrid reactions': 'standup hybrid reactor i',
	invention: 'standup invention lab i',
	'jump access': 'standup conduit generator i',
	'manufacturing (capitals)': 'standup capital shipyard i',
	'manufacturing (standard)': 'standup manufacturing plant i',
	market: 'standup market hub i',
	'moon drilling': 'standup moon drill i',
	'material efficiency research': 'standup research lab i',
	reprocessing: 'standup reprocessing facility i',
	'time efficiency research': 'standup research lab i',
}

export function resolveUniverseFuelModuleRule(
	serviceName: string,
	modulesByServiceName: ReadonlyMap<string, UniverseFuelModuleRule>
): UniverseFuelModuleRule | null {
	const normalizedServiceName = normalizeUniverseServiceName(serviceName)
	const moduleName = UNIVERSE_ESI_SERVICE_MODULE_ALIASES[normalizedServiceName]
	const lookupNames = moduleName ? [normalizedServiceName, moduleName] : [normalizedServiceName]

	for (const lookupName of lookupNames) {
		const module = modulesByServiceName.get(lookupName)
		if (module) {
			return module
		}
	}

	return null
}
