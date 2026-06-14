import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

import type { StructureTab } from '@repo/structures'
import type { StructureListSortBy, StructureListSortDirection } from '@/lib/api'

export interface StructureTableFilters {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
	allianceId?: string
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
}

const STORAGE_KEY = 'structures.table-state.v1'

function defaultState(): StructureTableUiState {
	return {
		tab: 'citadels',
		filters: {},
		page: 1,
		pageSize: 25,
		sortBy: 'updatedAt',
		sortDirection: 'desc',
	}
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
		typeId: filters.typeId,
		allianceId: filters.allianceId,
		planetId: filters.planetId,
		isRaidable: filters.isRaidable,
	}
}

const TAB_FILTER_FIELDS: Record<StructureTab, Array<keyof StructureTableFilters>> = {
	citadels: [
		'corporationId',
		'assignedGroupId',
		'lowPower',
		'lowPowerAllowed',
		'regionId',
		'systemId',
		'state',
		'typeId',
	],
	navigation: ['corporationId', 'systemId', 'state', 'typeId'],
	sovereignty: ['corporationId', 'systemId', 'allianceId'],
	skyhooks: ['corporationId', 'systemId', 'planetId', 'state', 'isRaidable'],
	mining: ['corporationId', 'systemId', 'planetId', 'typeId'],
}

function normalizeTab(tab: unknown): StructureTab {
	return tab === 'sovereignty' ||
		tab === 'skyhooks' ||
		tab === 'navigation' ||
		tab === 'mining'
		? tab
		: 'citadels'
}

function readStateFromStorage(): StructureTableUiState {
	if (typeof window === 'undefined') return defaultState()
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY)
		if (!raw) return defaultState()
		const parsed = JSON.parse(raw) as StructureTableUiState
		if (!parsed || typeof parsed !== 'object') return defaultState()
		return {
			...defaultState(),
			...parsed,
			tab: normalizeTab(parsed.tab),
			filters: normalizeFilters(parsed.filters ?? {}),
		}
	} catch {
		return defaultState()
	}
}

const structureTableStore = createStore<StructureTableUiState>(readStateFromStorage())

function persistState(): void {
	if (typeof window === 'undefined') return
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(structureTableStore.state))
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
	patch: Partial<StructureTableFilters> | ((previous: StructureTableFilters) => StructureTableFilters)
): void {
	updateState((previous) => {
		const nextFilters = typeof patch === 'function' ? patch(previous.filters) : { ...previous.filters, ...patch }
		return {
			...previous,
			filters: normalizeFilters(nextFilters),
			page: 1,
		}
	})
}

export function setStructureTableTab(tab: StructureTab): void {
	updateState((previous) => ({
		...previous,
		tab,
		filters: normalizeFilters(
			Object.fromEntries(
				TAB_FILTER_FIELDS[tab]
					.filter((field) => previous.filters[field] !== undefined)
					.map((field) => [field, previous.filters[field]])
			) as StructureTableFilters
		),
		page: 1,
	}))
}

export function clearStructureTableFilters(): void {
	updateState((previous) => ({
		...previous,
		filters: {},
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
		sortBy,
		sortDirection: previous.sortBy === sortBy && previous.sortDirection === 'asc' ? 'desc' : 'asc',
		page: 1,
	}))
}

export function resetStructureTableState(): void {
	structureTableStore.setState(() => defaultState())
}
