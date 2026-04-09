/**
 * Hook to create a MantineReactTable instance with the same dark-theme styling
 * as the tax report data grid, but for client-side fulcrum report sections.
 */

import { useMantineReactTable } from 'mantine-react-table'

import type { MRT_ColumnDef, MRT_RowData, MRT_TableOptions } from 'mantine-react-table'

interface UseFulcrumTableOptions<Row extends MRT_RowData> {
	columns: MRT_ColumnDef<Row>[]
	data: Row[]
	emptyMessage: string
	searchPlaceholder?: string
	pageSize?: number
	enableColumnFilters?: boolean
	renderDetailPanel?: MRT_TableOptions<Row>['renderDetailPanel']
}

export function useFulcrumTable<Row extends MRT_RowData>({
	columns,
	data,
	emptyMessage,
	searchPlaceholder = 'Search...',
	pageSize = 25,
	enableColumnFilters = true,
	renderDetailPanel,
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
		enableExpanding: Boolean(renderDetailPanel),
		renderDetailPanel,
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
			showRowsPerPage: true,
			rowsPerPageOptions: ['25', '50', '100', '200'],
		},
		mantinePaperProps: {
			shadow: 'none',
			radius: 'md',
			withBorder: true,
			className: 'tax-report-grid__paper',
			style: {
				background: 'hsl(var(--card))',
				borderColor: 'hsl(var(--border))',
				color: 'hsl(var(--foreground))',
				overflow: 'hidden',
			},
		},
		mantineTableContainerProps: {
			className: 'tax-report-grid__container',
		},
		mantineTableProps: {
			striped: false,
			highlightOnHover: false,
			withColumnBorders: false,
			withRowBorders: true,
			className: 'tax-report-grid__table',
			style: {
				background: 'transparent',
				color: 'hsl(var(--foreground))',
				tableLayout: 'auto',
			},
		},
		mantineTableHeadProps: {
			className: 'tax-report-grid__head',
			style: {
				background: 'hsl(var(--background-elevated))',
			},
		},
		mantineTableHeadCellProps: {
			className: 'tax-report-grid__head-cell',
			style: {
				background: 'hsl(var(--background-elevated))',
				borderBottom: '1px solid hsl(var(--border))',
				color: 'hsl(var(--muted-foreground))',
				fontSize: '0.75rem',
				fontWeight: 700,
				letterSpacing: '0.03em',
				textTransform: 'uppercase',
			},
		},
		mantineTableBodyCellProps: {
			className: 'tax-report-grid__body-cell',
			style: {
				borderBottom: '1px solid hsl(var(--border) / 0.7)',
				color: 'hsl(var(--foreground))',
			},
		},
		mantineTableBodyRowProps: {
			className: 'tax-report-grid__row',
		},
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		),
	})
}
