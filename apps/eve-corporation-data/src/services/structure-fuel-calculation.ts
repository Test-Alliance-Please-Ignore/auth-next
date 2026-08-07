import { normalizeUniverseServiceName } from '@repo/universe'

import type { UniverseFuelModuleRule, UniverseStructureFuelModifier } from '@repo/universe'

export interface StructureFuelService {
	name: string
	state: string
}

export function calculateStructureFuelBurnRate(
	services: readonly StructureFuelService[] | null,
	modulesByServiceName: ReadonlyMap<string, UniverseFuelModuleRule>,
	modifiers: readonly UniverseStructureFuelModifier[]
): number | null {
	if (services === null) {
		return null
	}

	if (services.length === 0) {
		return 0
	}

	let totalFuelUnitsPerHour = 0
	for (const service of services) {
		if (service.state.trim().toLowerCase() !== 'online') {
			continue
		}

		const module = modulesByServiceName.get(normalizeUniverseServiceName(service.name))
		if (!module) {
			return null
		}

		const modifier = modifiers.find(
			(candidate) => candidate.serviceGroupId === module.serviceGroupId
		)
		const multiplier = 1 + (modifier?.modifierPercent ?? 0) / 100
		totalFuelUnitsPerHour += module.fuelUnitsPerHour * multiplier
	}

	return totalFuelUnitsPerHour
}
