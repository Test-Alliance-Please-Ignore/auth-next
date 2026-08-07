import {
	STRUCTURE_COMMON_LIST_SORT_FIELDS,
	STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS,
	STRUCTURE_SKYHOOK_LIST_SORT_FIELDS,
	STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS,
} from '@repo/structures'

import type {
	StructureCommonListSortBy,
	StructureListSortBy,
	StructureListSortDirection,
	StructureMoonStructureListSortBy,
	StructureSkyhookListSortBy,
	StructureSovereigntyListSortBy,
	StructureTab,
} from '@repo/structures'

export interface StructureListContentKeyFilters {
	corporationId?: string
	assignedGroupId?: string
	regionId?: string
	systemId?: string
	state?: string
	lowPower?: string
	lowPowerAllowed?: string
	typeId?: string
	controllerAllianceId?: string
	vulnerabilityState?: string
	planetId?: string
	isRaidable?: string
}

function isIncluded(value: string, allowed: readonly string[]): boolean {
	return allowed.includes(value)
}

function getCommonSortBy(sortBy: string | null | undefined): StructureCommonListSortBy {
	return isIncluded(sortBy ?? '', STRUCTURE_COMMON_LIST_SORT_FIELDS)
		? (sortBy as StructureCommonListSortBy)
		: 'fuel'
}

function getMoonSortBy(sortBy: string | null | undefined): StructureMoonStructureListSortBy {
	return isIncluded(sortBy ?? '', STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS)
		? (sortBy as StructureMoonStructureListSortBy)
		: 'moonMaterials'
}

function getSkyhookSortBy(sortBy: string | null | undefined): StructureSkyhookListSortBy {
	return isIncluded(sortBy ?? '', STRUCTURE_SKYHOOK_LIST_SORT_FIELDS)
		? (sortBy as StructureSkyhookListSortBy)
		: 'skyhookSurplusFullness'
}

function getSovereigntySortBy(sortBy: string | null | undefined): StructureSovereigntyListSortBy {
	return isIncluded(sortBy ?? '', STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS)
		? (sortBy as StructureSovereigntyListSortBy)
		: 'fuel'
}

export function getEffectiveStructureSortByForTab(
	tab: StructureTab,
	sortBy: string | null | undefined
): StructureListSortBy {
	switch (tab) {
		case 'structures':
		case 'mining-citadels':
			return getCommonSortBy(sortBy)
		case 'moon-drills':
			return getMoonSortBy(sortBy)
		case 'skyhooks':
			return getSkyhookSortBy(sortBy)
		case 'sovereignty':
			return getSovereigntySortBy(sortBy)
		default:
			throw new Error(`Unknown structures tab: ${tab}`)
	}
}

function pushDefined(values: string[], value: string | null | undefined): void {
	values.push(value ?? '')
}

export function buildStructureListContentKey({
	tab,
	page,
	pageSize,
	sortBy,
	sortDirection,
	filters,
}: {
	tab: StructureTab
	page: number
	pageSize: number
	sortBy: string | null | undefined
	sortDirection: StructureListSortDirection
	filters: StructureListContentKeyFilters
}): string {
	const effectiveSortBy = getEffectiveStructureSortByForTab(tab, sortBy)
	const parts = [tab, String(page), String(pageSize), effectiveSortBy, sortDirection]

	switch (tab) {
		case 'sovereignty':
			pushDefined(parts, filters.corporationId)
			pushDefined(parts, filters.assignedGroupId)
			pushDefined(parts, filters.regionId)
			pushDefined(parts, filters.systemId)
			pushDefined(parts, filters.controllerAllianceId)
			pushDefined(parts, filters.vulnerabilityState)
			break
		case 'skyhooks':
			pushDefined(parts, filters.corporationId)
			pushDefined(parts, filters.assignedGroupId)
			pushDefined(parts, filters.regionId)
			pushDefined(parts, filters.systemId)
			pushDefined(parts, filters.state)
			pushDefined(parts, filters.typeId)
			pushDefined(parts, filters.planetId)
			pushDefined(parts, filters.isRaidable)
			break
		case 'moon-drills':
			pushDefined(parts, filters.corporationId)
			pushDefined(parts, filters.assignedGroupId)
			pushDefined(parts, filters.regionId)
			pushDefined(parts, filters.systemId)
			pushDefined(parts, filters.state)
			pushDefined(parts, filters.typeId)
			pushDefined(parts, filters.planetId)
			break
		case 'structures':
		case 'mining-citadels':
			pushDefined(parts, filters.corporationId)
			pushDefined(parts, filters.assignedGroupId)
			pushDefined(parts, filters.regionId)
			pushDefined(parts, filters.systemId)
			pushDefined(parts, filters.state)
			pushDefined(parts, filters.lowPower)
			pushDefined(parts, filters.lowPowerAllowed)
			pushDefined(parts, filters.typeId)
			break
	}

	return parts.join(':')
}
