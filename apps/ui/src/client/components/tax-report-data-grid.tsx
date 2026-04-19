import { MantineReactTable, useMantineReactTable } from 'mantine-react-table'

import {
	mrtPaperProps,
	mrtPaginationProps,
	mrtRowStyle,
	mrtTableBodyCellProps,
	mrtTableContainerProps,
	mrtTableHeadCellProps,
	mrtTableHeadProps,
	mrtTableProps,
} from '@/lib/mrt-theme'

import type {
	MRT_ColumnDef,
	MRT_Row,
	MRT_SortingState,
	MRT_TableInstance,
	MRT_TableOptions,
} from 'mantine-react-table'
import type { ReactNode } from 'react'

interface TaxReportDataGridProps<Row extends object> {
	columns: MRT_ColumnDef<Row>[]
	rows: Row[]
	loading?: boolean
	error?: unknown
	emptyMessage: string
	sorting?: MRT_SortingState
	onSortingChange?: (sorting: MRT_SortingState) => void
	pagination?: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount?: number
	rowCount?: number
	pinnedRightColumnIds?: string[]
	pinnedLeftColumnIds?: string[]
	renderDetailPanel?: (props: { row: MRT_Row<Row>; table: MRT_TableInstance<Row> }) => ReactNode
	mantineExpandButtonProps?: MRT_TableOptions<Row>['mantineExpandButtonProps']
	onRowClick?: (row: MRT_Row<Row>) => void
}

export function TaxReportDataGrid<Row extends object>({
	columns,
	rows,
	loading = false,
	error,
	emptyMessage,
	sorting = [],
	onSortingChange,
	pagination,
	onPaginationChange,
	pageCount,
	rowCount,
	pinnedRightColumnIds,
	pinnedLeftColumnIds,
	renderDetailPanel,
	mantineExpandButtonProps,
	onRowClick,
}: TaxReportDataGridProps<Row>) {
	const isServerSorted = Boolean(onSortingChange)
	const isServerPaginated = Boolean(onPaginationChange && pagination)
	const hasDetailPanel = Boolean(renderDetailPanel)
	const table = useMantineReactTable({
		columns,
		data: rows,
		enableExpanding: hasDetailPanel,
		enableColumnActions: false,
		enableColumnFilters: false,
		enableDensityToggle: false,
		enableFullScreenToggle: false,
		enableGlobalFilter: false,
		enableHiding: false,
		enableColumnPinning: true,
		enablePagination: true,
		enableStickyHeader: true,
		enableTopToolbar: false,
		manualSorting: isServerSorted,
		manualPagination: isServerPaginated,
		pageCount: isServerPaginated ? pageCount : undefined,
		rowCount: isServerPaginated ? rowCount : undefined,
		paginationDisplayMode: 'pages',
		mantinePaginationProps: mrtPaginationProps,
		mantinePaperProps: mrtPaperProps,
		mantineTableContainerProps: {
			...mrtTableContainerProps,
			style: { maxHeight: 'calc(100vh - 16rem)' },
		},
		mantineTableProps: mrtTableProps,
		mantineTableHeadProps: mrtTableHeadProps,
		mantineTableHeadCellProps: mrtTableHeadCellProps,
		mantineTableBodyCellProps: mrtTableBodyCellProps,
		mantineTableBodyRowProps: ({ row }) => ({
			className: onRowClick ? 'mrt-grid__row cursor-pointer' : 'mrt-grid__row',
			style: mrtRowStyle(row.index),
			onClick: (event) => {
				if (!onRowClick) return
				const target = event.target as HTMLElement | null
				if (
					target?.closest(
						'button, a, input, textarea, select, [role="button"], [data-no-row-click]'
					)
				) {
					return
				}
				onRowClick(row)
			},
		}),
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		),
		state: {
			isLoading: loading,
			showAlertBanner: Boolean(error),
			showProgressBars: loading,
			...(isServerSorted ? { sorting } : {}),
			...(isServerPaginated ? { pagination } : {}),
			...(pinnedLeftColumnIds || pinnedRightColumnIds
				? {
						columnPinning: {
							left: pinnedLeftColumnIds ?? [],
							right: pinnedRightColumnIds ?? [],
						},
					}
				: {}),
		},
		...(isServerSorted
			? {
					onSortingChange: (
						updater: MRT_SortingState | ((old: MRT_SortingState) => MRT_SortingState)
					) => {
						const nextSorting = typeof updater === 'function' ? updater(sorting) : updater
						onSortingChange!(nextSorting)
					},
				}
			: {}),
		...(isServerPaginated
			? {
					onPaginationChange: (
						updater:
							| { pageIndex: number; pageSize: number }
							| ((old: { pageIndex: number; pageSize: number }) => {
									pageIndex: number
									pageSize: number
							  })
					) => {
						const current = pagination!
						const next = typeof updater === 'function' ? updater(current) : updater
						onPaginationChange!({
							pageIndex: Math.max(0, next.pageIndex),
							pageSize: next.pageSize,
						})
					},
				}
			: {}),
		...(renderDetailPanel ? { renderDetailPanel } : {}),
		...(mantineExpandButtonProps ? { mantineExpandButtonProps } : {}),
	})

	return (
		<div className="space-y-3">
			{error ? (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error instanceof Error ? error.message : 'Failed to load report'}
				</div>
			) : null}

			<MantineReactTable table={table} />
		</div>
	)
}
