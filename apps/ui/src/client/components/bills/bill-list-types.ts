import type { BillListSortDirection, BillListSortField, BillStatus, EntityType } from '@repo/bills'

export interface BillListFiltersState {
	status?: BillStatus
	payerType?: EntityType
	payeeType?: EntityType
	payerId?: string
	payeeId?: string
	dueAfter?: string
	dueBefore?: string
}

export interface BillListPaginationState {
	pageIndex: number
	pageSize: number
}

export interface BillListSortingState {
	sortBy: BillListSortField
	sortDir: BillListSortDirection
}
