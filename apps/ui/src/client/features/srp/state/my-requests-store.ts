import type { RequestListResponse } from '../types'
import { createPaginatedSnapshotStore } from './paginated-snapshot-store'

const myRequestsStore = createPaginatedSnapshotStore<RequestListResponse>({
	defaultPageSize: 10,
	maxPageSize: 50,
})

export const setMyRequestsPage = myRequestsStore.setPage
export const setMyRequestsPageSize = myRequestsStore.setPageSize
export const setMyRequestsSnapshot = myRequestsStore.setSnapshot
export const useMyRequestsUiState = myRequestsStore.useUiState

export function getMyRequestsSnapshot(pageSize: number, offset: number): RequestListResponse | undefined {
	return myRequestsStore.getSnapshot(pageSize, offset)
}

export function __resetMyRequestsStoreForTests(): void {
	myRequestsStore.reset()
}
