/**
 * Hook to create a MantineReactTable instance with the same dark-theme styling
 * as the tax report data grid, but for client-side fulcrum report sections.
 */

import { useMantineReactTable } from 'mantine-react-table'

import {
	mrtPaginationProps,
	mrtPaperProps,
	mrtRowStyle,
	mrtTableBodyCellProps,
	mrtTableContainerProps,
	mrtTableHeadCellProps,
	mrtTableHeadProps,
	mrtTableProps,
} from '@/lib/mrt-theme'
import { cn } from '@/lib/utils'

import type {
	MRT_ColumnDef,
	MRT_PaginationState,
	MRT_RowData,
	MRT_TableOptions,
} from 'mantine-react-table'

interface UseFulcrumTableOptions<Row extends MRT_RowData> {
	columns: Array<MRT_ColumnDef<Row>>
	data: Row[]
	emptyMessage: string
	searchPlaceholder?: string
	pageSize?: number
	enableColumnFilters?: boolean
	renderDetailPanel?: MRT_TableOptions<Row>['renderDetailPanel']
	renderTopToolbarCustomActions?: MRT_TableOptions<Row>['renderTopToolbarCustomActions']
	getRowClassName?: (row: Row) => string | undefined
	pagination?: MRT_PaginationState
	onPaginationChange?: MRT_TableOptions<Row>['onPaginationChange']
	rowCount?: number
	rowsPerPageOptions?: string[]
	compactRows?: boolean
}

export function useFulcrumTable<Row extends MRT_RowData>({
	columns,
	data,
	emptyMessage,
	searchPlaceholder = 'Search...',
	pageSize = 25,
	enableColumnFilters = true,
	renderDetailPanel,
	renderTopToolbarCustomActions,
	getRowClassName,
	pagination,
	onPaginationChange,
	rowCount,
	rowsPerPageOptions,
	compactRows = false,
}: UseFulcrumTableOptions<Row>) {
	return useMantineReactTable({
		columns,
		data,
		defaultColumn: {
			minSize: 0,
			size: 0,
		},
		enableColumnActions: false,
		enableColumnFilters,
		enableDensityToggle: false,
		enableFullScreenToggle: false,
		enableGlobalFilter: true,
		enableHiding: false,
		enablePagination: true,
		enableStickyHeader: false,
		enableTopToolbar: true,
		manualPagination: Boolean(pagination && onPaginationChange),
		positionPagination: 'both',
		...(pagination ? { state: { pagination } } : {}),
		...(onPaginationChange ? { onPaginationChange } : {}),
		...(rowCount !== undefined ? { rowCount } : {}),
		enableExpanding: Boolean(renderDetailPanel),
		renderDetailPanel,
		renderTopToolbarCustomActions,
		columnFilterDisplayMode: 'popover',
		initialState: {
			pagination: { pageIndex: 0, pageSize },
			showGlobalFilter: true,
		},
		globalFilterFn: 'contains',
		positionGlobalFilter: 'left',
		mantineSearchTextInputProps: {
			placeholder: searchPlaceholder,
			style: { minWidth: '280px' },
		},
		paginationDisplayMode: 'pages',
		mantinePaginationProps: {
			...mrtPaginationProps,
			rowsPerPageOptions: rowsPerPageOptions ?? ['25', '50', '100', '200', '500', '1000'],
		},
		mantinePaperProps: mrtPaperProps,
		mantineTableContainerProps: mrtTableContainerProps,
		mantineTableProps: { ...mrtTableProps, style: { ...mrtTableProps.style, tableLayout: 'auto' } },
		mantineTableHeadProps: mrtTableHeadProps,
		mantineTableHeadCellProps: mrtTableHeadCellProps,
		mantineTableBodyCellProps: mrtTableBodyCellProps,
		mantineTableBodyRowProps: ({ row }) => ({
			className: cn(
				'mrt-grid__row',
				compactRows && 'mrt-grid__compact-row',
				getRowClassName?.(row.original as Row)
			),
			style: mrtRowStyle(row.index),
		}),
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		),
	})
}
