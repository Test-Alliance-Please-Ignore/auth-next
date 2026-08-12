export const STRUCTURE_CATEGORY_ID = 65
export const STRUCTURE_MODULE_CATEGORY_ID = 66
export const STRUCTURE_SERVICE_MODULE_ATTRIBUTE_ID = '2792'
export const FUEL_DOGMA_ATTRIBUTE_IDS: readonly string[] = [
	'2108',
	'2109',
	'2110',
	'2339',
	STRUCTURE_SERVICE_MODULE_ATTRIBUTE_ID,
]
export const STRUCTURE_SLOT_DOGMA_ATTRIBUTE_IDS: readonly string[] = ['12', '13', '14', '1137']
export const STRUCTURE_DOGMA_ATTRIBUTE_IDS: readonly string[] = [
	...FUEL_DOGMA_ATTRIBUTE_IDS,
	...STRUCTURE_SLOT_DOGMA_ATTRIBUTE_IDS,
]

export type SdeFuelType = {
	typeId: string
	groupId: string
}

export type SdeFuelModifier = {
	modifiedAttributeID?: number | null
	modifyingAttributeID?: number | null
	operation?: number | null
	func?: string
	domain?: string
}

export type StructureDogmaTypeIds = {
	structureTypeIds: Set<string>
	dogmaTypeIds: Set<string>
}

export function selectStructureDogmaTypeIds(
	groupCategories: ReadonlyMap<string, number>,
	types: readonly SdeFuelType[]
): StructureDogmaTypeIds {
	const structureTypeIds = new Set<string>()
	const dogmaTypeIds = new Set<string>()

	for (const type of types) {
		const categoryId = groupCategories.get(type.groupId)
		if (categoryId === STRUCTURE_CATEGORY_ID) {
			structureTypeIds.add(type.typeId)
		}
		if (categoryId === STRUCTURE_CATEGORY_ID || categoryId === STRUCTURE_MODULE_CATEGORY_ID) {
			dogmaTypeIds.add(type.typeId)
		}
	}

	return { structureTypeIds, dogmaTypeIds }
}

export function isFuelDogmaAttribute(attributeId: string, allDogma: boolean): boolean {
	return allDogma || STRUCTURE_DOGMA_ATTRIBUTE_IDS.includes(attributeId)
}

export function isFuelModifier(modifier: SdeFuelModifier): boolean {
	return (
		(modifier.modifiedAttributeID === 2109 || modifier.modifiedAttributeID === 2110) &&
		modifier.modifyingAttributeID === 2339 &&
		modifier.operation === 6 &&
		modifier.func === 'LocationGroupModifier' &&
		modifier.domain === 'structureID'
	)
}
