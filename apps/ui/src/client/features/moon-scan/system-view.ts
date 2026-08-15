export function filterValidOreTypeIds(
	selectedOreTypeIds: string[],
	availableOreTypeIds: Set<string>
) {
	return selectedOreTypeIds.filter((oreTypeId) => availableOreTypeIds.has(oreTypeId))
}

export function getValidCompositionSortOreTypeId(
	compositionSortOreTypeId: string,
	availableOreTypeIds: Set<string>
) {
	return availableOreTypeIds.has(compositionSortOreTypeId) ? compositionSortOreTypeId : ''
}
