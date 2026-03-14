import { MantineReactTable, useMantineReactTable } from 'mantine-react-table'

import { Button } from '@/components/ui/button'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'

interface TaxReportDataGridProps<Row extends object> {
	columns: MRT_ColumnDef<Row>[]
	rows: Row[]
	loading?: boolean
	error?: unknown
	emptyMessage: string
	sorting?: MRT_SortingState
	onSortingChange?: (sorting: MRT_SortingState) => void
	page?: number
	onPreviousPage?: () => void
	onNextPage?: () => void
	hasNextPage?: boolean
}

export function TaxReportDataGrid<Row extends object>({
	columns,
	rows,
	loading = false,
	error,
	emptyMessage,
	sorting = [],
	onSortingChange,
	page,
	onPreviousPage,
	onNextPage,
	hasNextPage,
}: TaxReportDataGridProps<Row>) {
	const table = useMantineReactTable({
		columns,
		data: rows,
		enableColumnActions: false,
		enableColumnFilters: false,
		enableDensityToggle: false,
		enableFullScreenToggle: false,
		enableGlobalFilter: false,
		enableHiding: false,
		enablePagination: false,
		enableStickyHeader: true,
		enableTopToolbar: false,
		manualSorting: Boolean(onSortingChange),
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
			style: {
				maxHeight: 'calc(100vh - 16rem)',
			},
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
		state: {
			isLoading: loading,
			showAlertBanner: Boolean(error),
			showProgressBars: loading,
			sorting,
		},
		onSortingChange: (updater) => {
			if (!onSortingChange) {
				return
			}

			const nextSorting = typeof updater === 'function' ? updater(sorting) : updater
			onSortingChange(nextSorting)
		},
	})

	return (
		<div className="tax-report-grid space-y-3">
			{error ? (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error instanceof Error ? error.message : 'Failed to load report'}
				</div>
			) : null}

			<MantineReactTable table={table} />

			{page !== undefined && onPreviousPage && onNextPage ? (
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" variant="outline" disabled={page === 0} onClick={onPreviousPage}>
						Previous
					</Button>
					<div className="text-xs text-muted-foreground">Page {page + 1}</div>
					<Button size="sm" variant="outline" disabled={!hasNextPage} onClick={onNextPage}>
						Next
					</Button>
				</div>
			) : null}
		</div>
	)
}
