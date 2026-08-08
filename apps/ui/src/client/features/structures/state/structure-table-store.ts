import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

import {
	STRUCTURE_COMMON_LIST_SORT_FIELDS,
	STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS,
	STRUCTURE_SKYHOOK_LIST_SORT_FIELDS,
	STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS,
} from '@repo/structures'

import type { StructureSkyhookListSortBy, StructureTab } from '@repo/structures'
import type { StructureListSortBy, StructureListSortDirection } from '@/lib/api'

export interface StructureTableFilters {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	vulnerabilityState?: 'vulnerable' | 'invulnerable' | 'reinforced'
	typeId?: string
	controllerAllianceId?: string
	planetId?: string
	isRaidable?: 'true' | 'false'
}

export interface StructureTableUiState {
	tab: StructureTab
	filters: StructureTableFilters
	page: number
	pageSize: number
	sortBy: StructureListSortBy
	sortDirection: StructureListSortDirection
	tabStateByTab: Partial<Record<StructureTab, StructureTableTabState>>
}

interface StructureTableTabState {
	filters: StructureTableFilters
	sortBy: StructureListSortBy
	sortDirection: StructureListSortDirection
}

const STORAGE_KEY = 'structures.table-state.v2'
const LEGACY_STORAGE_KEY = 'structures.table-state.v1'
const DEFAULT_SORT_BY: StructureListSortBy = 'fuel'
const DEFAULT_SORT_DIRECTION: StructureListSortDirection = 'asc'
const ALL_STRUCTURE_TABS: StructureTab[] = [
	'structures',
	'sovereignty',
	'skyhooks',
	'mining-citadels',
	'moon-drills',
]

function defaultState(): StructureTableUiState {
	const tabStateByTab: Partial<Record<StructureTab, StructureTableTabState>> = {}
	const currentTabState = defaultTabState('structures')
	return {
		tab: 'structures',
		filters: currentTabState.filters,
		page: 1,
		pageSize: 15,
		sortBy: currentTabState.sortBy,
		sortDirection: currentTabState.sortDirection,
		tabStateByTab,
	}
}

function defaultSortForTab(
	tab: StructureTab
): Pick<StructureTableTabState, 'sortBy' | 'sortDirection'> {
	if (tab === 'skyhooks') {
		return {
			sortBy: 'skyhookSurplusFullness' as StructureSkyhookListSortBy,
			sortDirection: 'desc',
		}
	}
	if (tab === 'moon-drills') {
		return {
			sortBy: 'moonMaterials',
			sortDirection: 'desc',
		}
	}

	return {
		sortBy: DEFAULT_SORT_BY,
		sortDirection: DEFAULT_SORT_DIRECTION,
	}
}

function defaultTabState(tab: StructureTab): StructureTableTabState {
	const defaultSort = defaultSortForTab(tab)
	return {
		filters: {},
		...defaultSort,
	}
}

function isValidSortByForTab(
	tab: StructureTab,
	sortBy: string | null | undefined
): sortBy is StructureListSortBy {
	const fields = (() => {
		switch (tab) {
			case 'skyhooks':
				return STRUCTURE_SKYHOOK_LIST_SORT_FIELDS
			case 'moon-drills':
				return STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS
			case 'sovereignty':
				return STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS
			default:
				return STRUCTURE_COMMON_LIST_SORT_FIELDS
		}
	})()

	return typeof sortBy === 'string' && fields.includes(sortBy as never)
}

function normalizeTabState(
	tab: StructureTab,
	tabState: Partial<StructureTableTabState> | null | undefined
): StructureTableTabState {
	const defaults = defaultTabState(tab)
	return {
		filters: pruneFiltersForTab(tab, normalizeFilters(tabState?.filters ?? {})),
		sortBy: isValidSortByForTab(tab, tabState?.sortBy) ? tabState.sortBy : defaults.sortBy,
		sortDirection:
			tabState?.sortDirection === 'asc' || tabState?.sortDirection === 'desc'
				? tabState.sortDirection
				: defaults.sortDirection,
	}
}

function normalizeTabStateByTab(
	tabStateByTab: Partial<Record<StructureTab, Partial<StructureTableTabState>>> | null | undefined
): Partial<Record<StructureTab, StructureTableTabState>> {
	const nextTabStateByTab: Partial<Record<StructureTab, StructureTableTabState>> = {}

	for (const tab of ALL_STRUCTURE_TABS) {
		if (!tabStateByTab?.[tab]) continue
		nextTabStateByTab[tab] = normalizeTabState(tab, tabStateByTab[tab])
	}

	return nextTabStateByTab
}

function getTabState(
	tab: StructureTab,
	tabStateByTab: Partial<Record<StructureTab, StructureTableTabState>>
): StructureTableTabState {
	return tabStateByTab[tab] ?? defaultTabState(tab)
}

function normalizeFilters(filters: StructureTableFilters): StructureTableFilters {
	return {
		corporationId: filters.corporationId,
		assignedGroupId: filters.assignedGroupId,
		lowPower: filters.lowPower,
		lowPowerAllowed: filters.lowPowerAllowed,
		regionId: filters.regionId,
		systemId: filters.systemId,
		state: filters.state,
		vulnerabilityState: filters.vulnerabilityState,
		typeId: filters.typeId,
		controllerAllianceId: filters.controllerAllianceId,
		planetId: filters.planetId,
		isRaidable: filters.isRaidable,
	}
}

function pruneFiltersForTab(
	tab: StructureTab,
	filters: StructureTableFilters
): StructureTableFilters {
	const nextFilters: StructureTableFilters = {}

	for (const field of TAB_FILTER_FIELDS[tab]) {
		const value = filters[field]
		if (value === undefined) continue

		switch (field) {
			case 'corporationId':
				nextFilters.corporationId = value
				break
			case 'assignedGroupId':
				nextFilters.assignedGroupId = value
				break
			case 'lowPower':
				if (value === 'true' || value === 'false') {
					nextFilters.lowPower = value
				}
				break
			case 'lowPowerAllowed':
				if (value === 'true' || value === 'false') {
					nextFilters.lowPowerAllowed = value
				}
				break
			case 'regionId':
				nextFilters.regionId = value
				break
			case 'systemId':
				nextFilters.systemId = value
				break
			case 'state':
				nextFilters.state = value
				break
			case 'vulnerabilityState':
				if (value === 'vulnerable' || value === 'invulnerable' || value === 'reinforced') {
					nextFilters.vulnerabilityState = value
				}
				break
			case 'typeId':
				nextFilters.typeId = value
				break
			case 'controllerAllianceId':
				nextFilters.controllerAllianceId = value
				break
			case 'planetId':
				nextFilters.planetId = value
				break
			case 'isRaidable':
				if (value === 'true' || value === 'false') {
					nextFilters.isRaidable = value
				}
				break
		}
	}

	return normalizeFilters(nextFilters)
}

const COMMON_TAB_FILTER_FIELDS = [
	'corporationId',
	'assignedGroupId',
	'lowPower',
	'lowPowerAllowed',
	'regionId',
	'systemId',
	'state',
	'typeId',
] as const satisfies Array<keyof StructureTableFilters>

const SKYHOOK_TAB_FILTER_FIELDS = [
	'corporationId',
	'assignedGroupId',
	'regionId',
	'systemId',
	'state',
] as const satisfies Array<keyof StructureTableFilters>

const MOON_DRILL_TAB_FILTER_FIELDS = [
	'corporationId',
	'assignedGroupId',
	'lowPower',
	'lowPowerAllowed',
	'regionId',
	'systemId',
	'state',
] as const satisfies Array<keyof StructureTableFilters>

const TAB_FILTER_FIELDS: Record<StructureTab, Array<keyof StructureTableFilters>> = {
	structures: [...COMMON_TAB_FILTER_FIELDS],
	sovereignty: [
		'corporationId',
		'assignedGroupId',
		'regionId',
		'systemId',
		'vulnerabilityState',
		'controllerAllianceId',
	],
	skyhooks: [...SKYHOOK_TAB_FILTER_FIELDS, 'isRaidable'],
	'mining-citadels': [...COMMON_TAB_FILTER_FIELDS],
	'moon-drills': [...MOON_DRILL_TAB_FILTER_FIELDS],
}

function normalizeTab(tab: unknown): StructureTab {
	return tab === 'sovereignty' ||
		tab === 'skyhooks' ||
		tab === 'mining-citadels' ||
		tab === 'moon-drills'
		? tab
		: tab === 'mining'
			? 'moon-drills'
			: 'structures'
}

function readStateFromStorage(): StructureTableUiState {
	if (typeof window === 'undefined') return defaultState()
	try {
		const raw =
			window.localStorage.getItem(STORAGE_KEY) ?? window.sessionStorage.getItem(LEGACY_STORAGE_KEY)
		if (!raw) return defaultState()
		const parsed = JSON.parse(raw) as Partial<StructureTableUiState> & {
			tabStateByTab?: Partial<Record<StructureTab, Partial<StructureTableTabState>>>
		}
		if (!parsed || typeof parsed !== 'object') return defaultState()
		const tab = normalizeTab(parsed.tab)
		const tabStateByTab = normalizeTabStateByTab(parsed.tabStateByTab)
		if (parsed.tabStateByTab === undefined && parsed.filters && parsed.sortBy) {
			tabStateByTab[tab] = normalizeTabState(tab, {
				filters: parsed.filters,
				sortBy: parsed.sortBy,
				sortDirection: parsed.sortDirection,
			})
		}
		const currentTabState = getTabState(tab, tabStateByTab)
		return {
			...defaultState(),
			...parsed,
			tab,
			filters: currentTabState.filters,
			sortBy: currentTabState.sortBy,
			sortDirection: currentTabState.sortDirection,
			tabStateByTab,
		}
	} catch {
		return defaultState()
	}
}

const structureTableStore = createStore<StructureTableUiState>(readStateFromStorage())

function persistState(): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				tab: structureTableStore.state.tab,
				tabStateByTab: structureTableStore.state.tabStateByTab,
			})
		)
	} catch {
		// Ignore storage failures; the in-memory store still works for the session.
	}
}

structureTableStore.subscribe(() => {
	persistState()
})

function updateState(updater: (previous: StructureTableUiState) => StructureTableUiState): void {
	structureTableStore.setState((previous) => {
		const next = updater(previous)
		return next === previous ? previous : next
	})
}

export function getStructureTableUiState(): StructureTableUiState {
	return structureTableStore.state
}

export function useStructureTableUiState<TSelected>(
	selector: (state: StructureTableUiState) => TSelected
): TSelected {
	return useSyncExternalStore(
		(listener) => structureTableStore.subscribe(listener).unsubscribe,
		() => selector(structureTableStore.state),
		() => selector(structureTableStore.state)
	)
}

export function setStructureTableFilters(
	patch:
		| Partial<StructureTableFilters>
		| ((previous: StructureTableFilters) => StructureTableFilters)
): void {
	updateState((previous) => {
		const nextFilters =
			typeof patch === 'function' ? patch(previous.filters) : { ...previous.filters, ...patch }
		const currentTabState = normalizeTabState(previous.tab, {
			filters: previous.filters,
			sortBy: previous.sortBy,
			sortDirection: previous.sortDirection,
		})
		const nextTabState = normalizeTabState(previous.tab, {
			...currentTabState,
			filters: nextFilters,
		})
		return {
			...previous,
			filters: nextTabState.filters,
			sortBy: nextTabState.sortBy,
			sortDirection: nextTabState.sortDirection,
			tabStateByTab: {
				...previous.tabStateByTab,
				[previous.tab]: nextTabState,
			},
			page: 1,
		}
	})
}

export function setStructureTableTab(tab: StructureTab): void {
	updateState((previous) => ({
		...previous,
		tab,
		...(() => {
			const nextTabStateByTab = {
				...previous.tabStateByTab,
				[previous.tab]: normalizeTabState(previous.tab, {
					filters: previous.filters,
					sortBy: previous.sortBy,
					sortDirection: previous.sortDirection,
				}),
			}
			const nextTabState = getTabState(tab, nextTabStateByTab)
			return {
				filters: nextTabState.filters,
				sortBy: nextTabState.sortBy,
				sortDirection: nextTabState.sortDirection,
				tabStateByTab: {
					...nextTabStateByTab,
					[tab]: nextTabState,
				},
			}
		})(),
		page: 1,
	}))
}

export function clearStructureTableFilters(): void {
	updateState((previous) => ({
		...previous,
		...(() => {
			const nextTabState = normalizeTabState(previous.tab, {
				filters: {},
				sortBy: previous.sortBy,
				sortDirection: previous.sortDirection,
			})
			return {
				filters: nextTabState.filters,
				sortBy: nextTabState.sortBy,
				sortDirection: nextTabState.sortDirection,
				tabStateByTab: {
					...previous.tabStateByTab,
					[previous.tab]: nextTabState,
				},
			}
		})(),
		page: 1,
	}))
}

export function setStructureTablePage(page: number): void {
	updateState((previous) => ({
		...previous,
		page: Math.max(1, page),
	}))
}

export function setStructureTablePageSize(pageSize: number): void {
	updateState((previous) => ({
		...previous,
		pageSize: Math.max(1, pageSize),
		page: 1,
	}))
}

export function setStructureTableSort(sortBy: StructureListSortBy): void {
	updateState((previous) => ({
		...previous,
		...(() => {
			const nextSortDirection =
				previous.sortBy === sortBy && previous.sortDirection === 'asc' ? 'desc' : 'asc'
			const nextTabState = normalizeTabState(previous.tab, {
				filters: previous.filters,
				sortBy,
				sortDirection: nextSortDirection,
			})
			return {
				filters: nextTabState.filters,
				sortBy: nextTabState.sortBy,
				sortDirection: nextTabState.sortDirection,
				tabStateByTab: {
					...previous.tabStateByTab,
					[previous.tab]: nextTabState,
				},
			}
		})(),
		page: 1,
	}))
}

export function resetStructureTableState(): void {
	structureTableStore.setState(() => defaultState())
}
