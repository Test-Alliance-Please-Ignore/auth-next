import { resolveUniverseFuelModuleRule } from '@repo/universe'

import type { UniverseFuelModuleRule, UniverseStructureFuelModifier } from '@repo/universe'

export interface StructureFuelService {
	name: string
	state: string
}

export interface StructureFuelBurnRateResult {
	fuelBurnRate: number | null
	unresolvedServiceNames: string[]
	unresolvedModuleTypeIds: string[]
}

export function calculateStructureFuelBurnRateDetails(
	services: readonly StructureFuelService[] | null,
	modulesByServiceName: ReadonlyMap<string, UniverseFuelModuleRule>,
	modifiers: readonly UniverseStructureFuelModifier[],
	builtInModule: UniverseFuelModuleRule | null = null,
	installedModuleTypeIds: readonly string[] = [],
	modulesByTypeId: ReadonlyMap<string, UniverseFuelModuleRule> = new Map()
): StructureFuelBurnRateResult {
	let totalFuelUnitsPerHour = 0
	let onlineServiceCount = 0
	let resolvedServiceCount = 0
	const countedModuleTypeIds = new Set<string>()
	const unresolvedServiceNames = new Set<string>()
	const unresolvedModuleTypeIds = new Set<string>()
	const hasInstalledModuleSnapshot = installedModuleTypeIds.length > 0
	const addModule = (module: UniverseFuelModuleRule): void => {
		if (countedModuleTypeIds.has(module.typeId)) {
			return
		}
		countedModuleTypeIds.add(module.typeId)
		resolvedServiceCount += 1

		const modifier = modifiers.find(
			(candidate) => candidate.serviceGroupId === module.serviceGroupId
		)
		const multiplier = 1 + (modifier?.modifierPercent ?? 0) / 100
		totalFuelUnitsPerHour += module.fuelUnitsPerHour * multiplier
	}

	if (hasInstalledModuleSnapshot) {
		for (const typeId of installedModuleTypeIds) {
			const module = modulesByTypeId.get(typeId)
			if (module) {
				addModule(module)
			} else {
				unresolvedModuleTypeIds.add(typeId)
			}
		}
		if (builtInModule) {
			addModule(builtInModule)
		}

		return {
			fuelBurnRate: resolvedServiceCount > 0 ? totalFuelUnitsPerHour : null,
			unresolvedServiceNames: [],
			unresolvedModuleTypeIds: [...unresolvedModuleTypeIds],
		}
	}

	if (services === null) {
		return { fuelBurnRate: null, unresolvedServiceNames: [], unresolvedModuleTypeIds: [] }
	}

	if (services.length === 0) {
		return { fuelBurnRate: 0, unresolvedServiceNames: [], unresolvedModuleTypeIds: [] }
	}

	for (const service of services) {
		if (service.state.trim().toLowerCase() !== 'online') {
			continue
		}
		onlineServiceCount += 1

		const resolvedModule = resolveUniverseFuelModuleRule(service.name, modulesByServiceName)
		const fallbackModule = resolvedModule ?? builtInModule
		const module = fallbackModule
		if (!module) {
			unresolvedServiceNames.add(service.name)
			continue
		}
		addModule(module)
	}

	return {
		fuelBurnRate:
			onlineServiceCount === 0 ? 0 : resolvedServiceCount > 0 ? totalFuelUnitsPerHour : null,
		unresolvedServiceNames: [...unresolvedServiceNames],
		unresolvedModuleTypeIds: [],
	}
}

export function calculateStructureFuelBurnRate(
	services: readonly StructureFuelService[] | null,
	modulesByServiceName: ReadonlyMap<string, UniverseFuelModuleRule>,
	modifiers: readonly UniverseStructureFuelModifier[],
	builtInModule: UniverseFuelModuleRule | null = null,
	installedModuleTypeIds: readonly string[] = [],
	modulesByTypeId: ReadonlyMap<string, UniverseFuelModuleRule> = new Map()
): number | null {
	return calculateStructureFuelBurnRateDetails(
		services,
		modulesByServiceName,
		modifiers,
		builtInModule,
		installedModuleTypeIds,
		modulesByTypeId
	).fuelBurnRate
}
