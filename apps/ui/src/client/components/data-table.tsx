import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/card'
import {
	SortableTableHead,
	stickyTableActionCellClassName,
	stickyTableActionHeaderClassName,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'

export type DataTableSortingState = Array<{ id: string; desc: boolean }>

export type DataTableColumn<Row> = {
	id: string
	header: ReactNode
	sortable?: boolean
	cell?: (row: Row) => ReactNode
	link?: (row: Row) => string
	className?: string
	headerClassName?: string
	sticky?: 'right'
}

export type DataTablePagination = {
	pageIndex: number
	pageSize: number
}

/** Select either native link navigation or callback row handling, never both. */
export type DataTableRowInteraction<Row> =
	| { type: 'link'; getHref: (row: Row) => string }
	| { type: 'click'; onClick: (row: Row) => void }

export function getNextDataTableSorting(
	sorting: DataTableSortingState,
	columnId: string
): DataTableSortingState {
	const current = sorting[0]
	if (!current || current.id !== columnId) return [{ id: columnId, desc: false }]
	return [{ id: columnId, desc: !current.desc }]
}

export type DataTableProps<Row> = {
	columns: Array<DataTableColumn<Row>>
	rows: Row[]
	loading?: boolean
	error?: unknown
	errorMessage?: string
	emptyMessage: string
	sorting?: DataTableSortingState
	onSortingChange?: (sorting: DataTableSortingState) => void
	pagination?: DataTablePagination
	onPaginationChange?: (pagination: DataTablePagination) => void
	rowCount?: number
	itemLabel?: string
	pageSizeOptions?: number[]
	/** Return a stable identity for the row across sorting, filtering, and pagination changes. */
	getRowKey: (row: Row, index: number) => string
	rowInteraction?: DataTableRowInteraction<Row>
	renderExpandedRow?: (row: Row) => ReactNode
	getRowCanExpand?: (row: Row) => boolean
	paginationLeadingAction?: ReactNode
	paginationPosition?: 'top' | 'bottom' | 'both'
	getRowClassName?: (row: Row, index: number) => string | undefined
	clamped?: boolean
	variant?: 'card' | 'plain'
	className?: string
}

function isInteractiveTarget(target: HTMLElement | null): boolean {
	return Boolean(
		target?.closest('button, a, input, textarea, select, [role="button"], [data-no-row-click]')
	)
}

export function DataTable<Row>({
	columns,
	rows,
	loading = false,
	error,
	errorMessage = 'Failed to load data',
	emptyMessage,
	sorting = [],
	onSortingChange,
	pagination,
	onPaginationChange,
	rowCount = rows.length,
	itemLabel = 'rows',
	pageSizeOptions,
	getRowKey,
	rowInteraction,
	renderExpandedRow,
	getRowCanExpand,
	paginationLeadingAction,
	paginationPosition = 'both',
	getRowClassName,
	clamped = false,
	variant = 'card',
	className,
}: DataTableProps<Row>) {
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
	const isPaginated = Boolean(pagination && onPaginationChange)
	const page = pagination?.pageIndex ?? 0
	const pageSize = pagination?.pageSize ?? (rows.length || 1)
	const hasExpansion = Boolean(renderExpandedRow)

	const toggleSort = (column: DataTableColumn<Row>) => {
		if (!column.sortable || !onSortingChange) return
		onSortingChange(getNextDataTableSorting(sorting, column.id))
	}

	const toggleExpanded = (key: string) => {
		setExpandedRows((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	const paginationControls = isPaginated ? (
		<div className={cn('shrink-0', variant === 'card' && 'border-b p-4')}>
			<UserSearchPaginationControls
				totalCount={rowCount}
				page={page + 1}
				pageSize={pageSize}
				onPageChange={(nextPage) => onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })}
				onPageSizeChange={(nextPageSize) =>
					onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
				}
				itemLabel={itemLabel}
				pageSizeOptions={pageSizeOptions}
				nextButtonLoading={loading}
				controlsLeadingAction={paginationLeadingAction}
			/>
		</div>
	) : null

	const bottomPaginationControls = isPaginated ? (
		<div className={cn('shrink-0', variant === 'card' && 'border-t p-4')}>
			<UserSearchPaginationControls
				totalCount={rowCount}
				page={page + 1}
				pageSize={pageSize}
				onPageChange={(nextPage) => onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })}
				onPageSizeChange={(nextPageSize) =>
					onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
				}
				itemLabel={itemLabel}
				pageSizeOptions={pageSizeOptions}
				nextButtonLoading={loading}
			/>
		</div>
	) : null

	const tableContent = (
		<div
			className={cn(
				'relative min-h-0 overflow-x-auto',
				variant === 'plain' && 'rounded-md border border-border',
				clamped && 'lg:flex-1 lg:overflow-hidden'
			)}
		>
			<Table
				className="min-w-max"
				containerClassName={cn('w-full', clamped && 'lg:h-full lg:min-h-0 lg:overflow-auto')}
			>
				<TableHeader>
					<TableRow>
						{hasExpansion ? <TableHead className="w-10" aria-label="Expand" /> : null}
						{columns.map((column) => {
							const activeSort = sorting[0]?.id === column.id ? sorting[0] : undefined
							const headerClassName = cn(
								column.headerClassName,
								column.sticky === 'right' && stickyTableActionHeaderClassName
							)

							return column.sortable && onSortingChange ? (
								<SortableTableHead
									key={column.id}
									className={headerClassName}
									onSort={() => toggleSort(column)}
									direction={activeSort ? (activeSort.desc ? 'desc' : 'asc') : undefined}
								>
									{column.header}
								</SortableTableHead>
							) : (
								<TableHead key={column.id} className={headerClassName}>
									{column.header}
								</TableHead>
							)
						})}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length > 0 ? (
						rows.map((row, index) => {
							const key = getRowKey(row, index)
							const canExpand = hasExpansion && (getRowCanExpand?.(row) ?? true)
							const isExpanded = expandedRows.has(key)

							return (
								<Fragment key={key}>
									<TableRow
										className={cn(
											rowInteraction && 'cursor-pointer',
											getRowClassName?.(row, index)
										)}
										onClick={(event) => {
											if (isInteractiveTarget(event.target as HTMLElement | null)) return
											if (rowInteraction?.type !== 'click') return
											rowInteraction.onClick(row)
										}}
										onAuxClick={(event) => {
											if (event.button !== 1 || rowInteraction?.type !== 'link') return
											if (isInteractiveTarget(event.target as HTMLElement | null)) return
											const href = rowInteraction.getHref(row)
											event.preventDefault()
											window.open(href, '_blank', 'noopener,noreferrer')
										}}
									>
										{hasExpansion ? (
											<TableCell
												className="w-10"
												onClick={(event) => {
													if (!canExpand || (event.target as HTMLElement).closest('button')) return
													event.stopPropagation()
													toggleExpanded(key)
												}}
											>
												{canExpand ? (
													<button
														type="button"
														className="relative z-10 -m-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded p-2 transition-colors hover:bg-primary/15 hover:text-primary"
														aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
														aria-expanded={isExpanded}
														onClick={() => toggleExpanded(key)}
													>
														{isExpanded ? (
															<ChevronDown aria-hidden className="h-4 w-4" />
														) : (
															<ChevronRight aria-hidden className="h-4 w-4" />
														)}
													</button>
												) : null}
											</TableCell>
										) : null}
										{columns.map((column) => {
											const content = column.cell ? column.cell(row) : null
											const href =
												column.link?.(row) ??
												(rowInteraction?.type === 'link' && column.sticky !== 'right'
													? rowInteraction.getHref(row)
													: undefined)

											return (
												<TableCell
													key={column.id}
													className={cn(
														column.className,
														column.sticky === 'right' && stickyTableActionCellClassName
													)}
												>
													{href ? (
														<Link to={href} className="block no-underline hover:no-underline">
															{content}
														</Link>
													) : (
														content
													)}
												</TableCell>
											)
										})}
									</TableRow>
									{isExpanded && canExpand ? (
										<TableRow key={`${key}-expanded`}>
											<TableCell colSpan={columns.length + 1} className="bg-muted/20 p-0">
												{renderExpandedRow?.(row)}
											</TableCell>
										</TableRow>
									) : null}
								</Fragment>
							)
						})
					) : (
						<TableRow>
							<TableCell
								colSpan={columns.length + (hasExpansion ? 1 : 0)}
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
	)

	return (
		<div
			className={cn('space-y-3', clamped && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col', className)}
		>
			{error ? (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error instanceof Error ? error.message : errorMessage}
				</div>
			) : null}
			{variant === 'card' ? (
				<Card className={cn('flex flex-col overflow-hidden', clamped && 'lg:min-h-0 lg:flex-1')}>
					{paginationPosition !== 'bottom' ? paginationControls : null}
					{tableContent}
					{paginationPosition !== 'top' ? bottomPaginationControls : null}
				</Card>
			) : (
				<>
					{paginationPosition !== 'bottom' ? paginationControls : null}
					{tableContent}
					{paginationPosition !== 'top' ? bottomPaginationControls : null}
				</>
			)}
		</div>
	)
}
