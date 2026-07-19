import type { RecentLossesResponse } from '../types'
import { createPaginatedSnapshotStore } from './paginated-snapshot-store'

const recentLossesStore = createPaginatedSnapshotStore<RecentLossesResponse>({
	defaultPageSize: 10,
	maxPageSize: 50,
})

export const setRecentLossesPage = recentLossesStore.setPage
export const setRecentLossesPageSize = recentLossesStore.setPageSize
export const setRecentLossesSnapshot = recentLossesStore.setSnapshot
export const useRecentLossesUiState = recentLossesStore.useUiState

export function __resetRecentLossesStoreForTests(): void {
	recentLossesStore.reset()
}
