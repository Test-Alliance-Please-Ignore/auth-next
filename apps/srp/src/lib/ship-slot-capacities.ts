export interface ShipSlotCapacities {
	high: number
	mid: number
	low: number
	rig: number
	sub: number
	implant: number
}

export const DEFAULT_NON_POD_SLOT_CAPACITIES: ShipSlotCapacities = {
	high: 0,
	mid: 0,
	low: 0,
	rig: 0,
	sub: 0,
	implant: 0,
}

export const DEFAULT_POD_SLOT_CAPACITIES: ShipSlotCapacities = {
	high: 0,
	mid: 0,
	low: 0,
	rig: 0,
	sub: 0,
	implant: 10,
}

function clampSlotCapacity(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(max, Math.trunc(value)))
}

/**
 * Build ship slot capacities from ESI dogma attributes for a ship type.
 *
 * Attribute IDs:
 * - 12: low slots
 * - 13: mid slots
 * - 14: high slots
 * - 1137: rig slots
 * - 1367: subsystem slots
 */
export function parseShipSlotCapacitiesFromDogmaAttributes(
	dogmaAttributes: Array<{ attribute_id?: number; value?: number }> | undefined
): ShipSlotCapacities {
	const attributes = new Map<number, number>()
	for (const attribute of dogmaAttributes ?? []) {
		const attributeId = attribute.attribute_id
		const value = attribute.value
		if (
			typeof attributeId !== 'number' ||
			typeof value !== 'number' ||
			!Number.isFinite(attributeId) ||
			!Number.isFinite(value)
		) {
			continue
		}
		attributes.set(attributeId, value)
	}

	return {
		high: clampSlotCapacity(attributes.get(14) ?? 0, 8),
		mid: clampSlotCapacity(attributes.get(13) ?? 0, 8),
		low: clampSlotCapacity(attributes.get(12) ?? 0, 8),
		rig: clampSlotCapacity(attributes.get(1137) ?? 0, 3),
		sub: clampSlotCapacity(attributes.get(1367) ?? 0, 4),
		implant: 0,
	}
}
