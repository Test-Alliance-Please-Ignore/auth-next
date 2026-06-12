import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

import type { StructureListQuery, StructureListSortBy, StructureListSortDirection } from '@/lib/api'

export type StructureTableFilters = Pick<
	StructureListQuery,
	'corporationId' | 'assignedGroupId' | 'lowPower' | 'lowPowerAllowed' | 'regionId' | 'systemId' | 'state' | 'typeId'
>

export interface StructureTableUiState {
	filters: StructureTableFilters
	page: number
	pageSize: number
	sortBy: StructureListSortBy
	sortDirection: StructureListSortDirection
}

const STORAGE_KEY = 'structures.table-state.v1'

function defaultState(): StructureTableUiState {
	return {
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
	}
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
