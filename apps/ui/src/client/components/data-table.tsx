import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/card'
import {
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

export type DataTableProps<Row> = {
	columns: Array<DataTableColumn<Row>>
	rows: Row[]
	loading?: boolean
	error?: unknown
	emptyMessage: string
	sorting?: DataTableSortingState
	onSortingChange?: (sorting: DataTableSortingState) => void
	pagination?: DataTablePagination
	onPaginationChange?: (pagination: DataTablePagination) => void
	rowCount?: number
	itemLabel?: string
	getRowKey: (row: Row, index: number) => string
	rowLink?: (row: Row) => string
	onRowClick?: (row: Row) => void
	renderExpandedRow?: (row: Row) => ReactNode
	getRowCanExpand?: (row: Row) => boolean
	paginationLeadingAction?: ReactNode
	clamped?: boolean
	className?: string
}

function getSortIcon(columnId: string, sorting: DataTableSortingState) {
	const active = sorting[0]?.id === columnId ? sorting[0] : undefined
	if (!active) return ArrowUpDown
	return active.desc ? ArrowDown : ArrowUp
}

export function DataTable<Row>({
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
	rowLink,
	onRowClick,
	renderExpandedRow,
	getRowCanExpand,
	paginationLeadingAction,
	clamped = false,
	className,
}: DataTableProps<Row>) {
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
	const isPaginated = Boolean(pagination && onPaginationChange)
	const page = pagination?.pageIndex ?? 0
	const pageSize = pagination?.pageSize ?? (rows.length || 1)
	const hasExpansion = Boolean(renderExpandedRow)

	const toggleSort = (column: DataTableColumn<Row>) => {
		if (!column.sortable || !onSortingChange) return
		const current = sorting[0]
		if (!current || current.id !== column.id) {
			onSortingChange([{ id: column.id, desc: false }])
			return
		}
		onSortingChange([{ id: column.id, desc: !current.desc }])
	}

	const toggleExpanded = (key: string) => {
		setExpandedRows((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	return (
		<div
			className={cn('space-y-3', clamped && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col', className)}
		>
			{error ? (
				<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{error instanceof Error ? error.message : 'Failed to load data'}
				</div>
			) : null}
			<Card className={cn('flex flex-col overflow-hidden', clamped && 'lg:min-h-0 lg:flex-1')}>
				{isPaginated ? (
					<div className="shrink-0 border-b p-4">
						<UserSearchPaginationControls
							totalCount={rowCount}
							page={page + 1}
							pageSize={pageSize}
							onPageChange={(nextPage) =>
								onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })
							}
							onPageSizeChange={(nextPageSize) =>
								onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
							}
							itemLabel={itemLabel}
							nextButtonLoading={loading}
							controlsLeadingAction={paginationLeadingAction}
						/>
					</div>
				) : null}
				<div
					className={cn(
						'relative min-h-0 overflow-x-auto',
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
									const SortIcon = getSortIcon(column.id, sorting)
									return (
										<TableHead
											key={column.id}
											className={cn(
												column.headerClassName,
												column.sticky === 'right' && stickyTableActionHeaderClassName
											)}
										>
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
								rows.map((row, index) => {
									const key = getRowKey(row, index)
									const canExpand = hasExpansion && (getRowCanExpand?.(row) ?? true)
									const isExpanded = expandedRows.has(key)
									return (
										<Fragment key={key}>
											<TableRow
												className={onRowClick || rowLink ? 'cursor-pointer' : undefined}
												onClick={(event) => {
													const target = event.target as HTMLElement | null
													if (
														target?.closest(
															'button, a, input, textarea, select, [role="button"], [data-no-row-click]'
														)
													) {
														return
													}
													const href = rowLink?.(row)
													if (
														href &&
														(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
													) {
														event.preventDefault()
														window.open(href, '_blank', 'noopener,noreferrer')
														return
													}
													if (!onRowClick) return
													onRowClick(row)
												}}
												onAuxClick={(event) => {
													if (event.button !== 1 || !rowLink) return
													const target = event.target as HTMLElement | null
													if (
														target?.closest(
															'button, a, input, textarea, select, [role="button"], [data-no-row-click]'
														)
													) {
														return
													}
													event.preventDefault()
													window.open(rowLink(row), '_blank', 'noopener,noreferrer')
												}}
											>
												{hasExpansion ? (
													<TableCell
														className="w-10"
														onClick={(event) => {
															if (!canExpand) return
															const target = event.target as HTMLElement | null
															if (target?.closest('button')) return
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
														(rowLink && column.sticky !== 'right' ? rowLink(row) : undefined)

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
				{isPaginated ? (
					<div className="shrink-0 border-t p-4">
						<UserSearchPaginationControls
							totalCount={rowCount}
							page={page + 1}
							pageSize={pageSize}
							onPageChange={(nextPage) =>
								onPaginationChange?.({ pageIndex: nextPage - 1, pageSize })
							}
							onPageSizeChange={(nextPageSize) =>
								onPaginationChange?.({ pageIndex: 0, pageSize: nextPageSize })
							}
							itemLabel={itemLabel}
							nextButtonLoading={loading}
						/>
					</div>
				) : null}
			</Card>
		</div>
	)
}
