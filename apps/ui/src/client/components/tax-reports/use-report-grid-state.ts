import { useEffect, useMemo, useRef, useState } from 'react'

import { applySorting, toSorting } from '@/lib/tax-report-utils'

import type { SortDirection, TaxReportSortingState } from '@/lib/tax-report-utils'

interface UseReportGridStateOptions {
	defaultSortBy: string
	defaultSortDir: SortDirection
	defaultPageSize?: number
	resetOn?: unknown
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}

interface UseReportGridStateResult {
	page: number
	pageSize: number
	sortBy: string
	sortDir: SortDirection
	limit: number
	offset: number
	sorting: TaxReportSortingState
	pagination: { pageIndex: number; pageSize: number }
	onSortingChange: (next: TaxReportSortingState) => void
	onPaginationChange: (next: { pageIndex: number; pageSize: number }) => void
}

export function useReportGridState(options: UseReportGridStateOptions): UseReportGridStateResult {
	const defaultSortBy = options.defaultSortBy
	const defaultSortDir = options.defaultSortDir
	const onSortChangeRef = useRef(options.onSortChange)
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(options.defaultPageSize ?? 25)
	const [sortBy, setSortBy] = useState(defaultSortBy)
	const [sortDir, setSortDir] = useState<SortDirection>(defaultSortDir)

	const resetKey = useMemo(() => JSON.stringify(options.resetOn ?? null), [options.resetOn])

	useEffect(() => {
		setPage(0)
	}, [resetKey])

	useEffect(() => {
		onSortChangeRef.current = options.onSortChange
	}, [options.onSortChange])

	useEffect(() => {
		onSortChangeRef.current?.(sortBy, sortDir)
	}, [sortBy, sortDir])

	const sorting = useMemo(() => toSorting(sortBy, sortDir), [sortBy, sortDir])

	const onSortingChange = (next: TaxReportSortingState) => {
		applySorting(next, defaultSortBy, defaultSortDir, setSortBy, setSortDir, () => setPage(0))
	}

	const pagination = { pageIndex: page, pageSize }

	const onPaginationChange = (next: { pageIndex: number; pageSize: number }) => {
		setPageSize(next.pageSize)
		setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
	}

	return {
		page,
		pageSize,
		sortBy,
		sortDir,
		limit: pageSize,
		offset: page * pageSize,
		sorting,
		pagination,
		onSortingChange,
		onPaginationChange,
	}
}
