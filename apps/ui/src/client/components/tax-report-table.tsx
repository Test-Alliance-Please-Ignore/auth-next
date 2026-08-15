import { ArrowDown, ArrowUp, ArrowUpDown, Loader2 } from 'lucide-react'

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'

import type { ReactNode } from 'react'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export type { TaxReportSortingState }

export type TaxReportColumn<Row> = {
	id: string
	header: ReactNode
	sortable?: boolean
	cell?: (row: Row) => ReactNode
	className?: string
	headerClassName?: string
}

type TaxReportTableProps<Row> = {
	columns: Array<TaxReportColumn<Row>>
	rows: Row[]
	loading?: boolean
	error?: unknown
	emptyMessage: string
	sorting?: TaxReportSortingState
	onSortingChange?: (sorting: TaxReportSortingState) => void
	pagination?: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount?: number
	itemLabel?: string
	getRowKey: (row: Row, index: number) => string
}

function getSortIcon(columnId: string, sorting: TaxReportSortingState) {
	const active = sorting[0]?.id === columnId ? sorting[0] : undefined
	if (!active) return ArrowUpDown
	return active.desc ? ArrowDown : ArrowUp
}

export function TaxReportTable<Row>({
	columns,
	rows,
	loading = false,
	error,
	emptyMessage,
	sorting = [],
	onSortingChange,
	pagination,
	onPaginationChange,
	rowCount = rows.length,
	itemLabel = 'rows',
	getRowKey,
}: TaxReportTableProps<Row>) {
	const isPaginated = Boolean(pagination && onPaginationChange)
	const page = pagination?.pageIndex ?? 0
	const pageSize = pagination?.pageSize ?? (rows.length || 1)

	const toggleSort = (column: TaxReportColumn<Row>) => {
		if (!column.sortable || !onSortingChange) return
		const current = sorting[0]
		if (!current || current.id !== column.id) {
			onSortingChange([{ id: column.id, desc: false }])
			return
		}
		onSortingChange([{ id: column.id, desc: !current.desc }])
	}

	return (
		<div className="space-y-3">
			{error ? (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error instanceof Error ? error.message : 'Failed to load report'}
				</div>
			) : null}
			{isPaginated ? (
				<UserSearchPaginationControls
					totalCount={rowCount}
					page={page + 1}
					pageSize={pageSize}
					onPageChange={(nextPage) => onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })}
					onPageSizeChange={(nextPageSize) =>
						onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
					}
					itemLabel={itemLabel}
					nextButtonLoading={loading}
				/>
			) : null}
			<div className="relative overflow-x-auto rounded-md border border-border">
				<Table className="min-w-max">
					<TableHeader>
						<TableRow>
							{columns.map((column) => {
								const SortIcon = getSortIcon(column.id, sorting)
								return (
									<TableHead key={column.id} className={column.headerClassName}>
										{column.sortable && onSortingChange ? (
											<button
												type="button"
												className="inline-flex items-center gap-1.5 text-left hover:text-foreground"
												onClick={() => toggleSort(column)}
											>
												{column.header}
												<SortIcon aria-hidden className="h-3.5 w-3.5" />
											</button>
										) : (
											column.header
										)}
									</TableHead>
								)
							})}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length > 0 ? (
							rows.map((row, index) => (
								<TableRow key={getRowKey(row, index)}>
									{columns.map((column) => (
										<TableCell key={column.id} className={column.className}>
											{column.cell ? column.cell(row) : null}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-40 text-center text-muted-foreground"
								>
									{emptyMessage}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				{loading ? (
					<div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
						<Loader2 aria-label="Loading" className="h-6 w-6 animate-spin text-primary" />
					</div>
				) : null}
			</div>
			{isPaginated ? (
				<UserSearchPaginationControls
					totalCount={rowCount}
					page={page + 1}
					pageSize={pageSize}
					onPageChange={(nextPage) => onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })}
					onPageSizeChange={(nextPageSize) =>
						onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
					}
					itemLabel={itemLabel}
					nextButtonLoading={loading}
				/>
			) : null}
		</div>
	)
}
