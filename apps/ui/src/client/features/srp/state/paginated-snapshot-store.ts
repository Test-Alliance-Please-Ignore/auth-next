import { createStore } from '@tanstack/store'
import { useSyncExternalStore } from 'react'

export interface PaginatedSnapshotStoreState<TSnapshot> {
	page: number
	pageSize: number
	pages: Record<string, TSnapshot>
}

interface CreatePaginatedSnapshotStoreOptions {
	defaultPageSize?: number
	maxPageSize?: number
}

export function createPaginatedSnapshotStore<TSnapshot>(
	options: CreatePaginatedSnapshotStoreOptions = {}
) {
	const defaultPageSize = options.defaultPageSize ?? 10
	const maxPageSize = options.maxPageSize ?? 50
	const store = createStore<PaginatedSnapshotStoreState<TSnapshot>>({
		page: 1,
		pageSize: defaultPageSize,
		pages: {},
	})

	function getPageKey(pageSize: number, offset: number): string {
		return `${pageSize}:${offset}`
	}

	function setPage(page: number): void {
		store.setState((state) => ({
			...state,
			page: Math.max(1, page),
		}))
	}

	function setPageSize(pageSize: number): void {
		store.setState((state) => ({
			...state,
			pageSize: Math.min(maxPageSize, Math.max(1, pageSize)),
			page: 1,
		}))
	}

	function setSnapshot(pageSize: number, offset: number, data: TSnapshot): void {
		const key = getPageKey(pageSize, offset)
		store.setState((state) => {
			if (state.pages[key] === data) return state
			return {
				...state,
				pages: {
					...state.pages,
					[key]: data,
				},
			}
		})
	}

	function getSnapshot(pageSize: number, offset: number): TSnapshot | undefined {
		return store.state.pages[getPageKey(pageSize, offset)]
	}

	function useUiState<TSelected>(
		selector: (state: PaginatedSnapshotStoreState<TSnapshot>) => TSelected
	): TSelected {
		return useSyncExternalStore(
			(listener) => store.subscribe(listener).unsubscribe,
			() => selector(store.state),
			() => selector(store.state)
		)
	}

	function reset(): void {
		store.setState(() => ({
			page: 1,
			pageSize: defaultPageSize,
			pages: {},
		}))
	}

	return {
		getPageKey,
		getSnapshot,
		reset,
		setPage,
		setPageSize,
		setSnapshot,
		useUiState,
	}
}
