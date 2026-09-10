import { useEffect, useMemo, useState } from 'react'

import { DataTable } from '@/components/data-table'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

import type { ReactNode } from 'react'
import type {
	DataTableColumn,
	DataTablePagination,
	DataTableSortingState,
} from '@/components/data-table'
import type { SelectOption } from '@/components/ui/select'

export type FulcrumCellValue = string | number | Date | null | undefined

export type FulcrumFilterDefinition =
	| { kind: 'text'; label?: string }
	| { kind: 'select' | 'multi-select' | 'autocomplete'; label?: string; options?: SelectOption[] }
	| { kind: 'range'; label?: string }
	| { kind: 'date-range'; label?: string }

export interface FulcrumDataTableColumn<Row> extends DataTableColumn<Row> {
	getValue: (row: Row) => FulcrumCellValue
	globalFilter?: boolean
	filter?: FulcrumFilterDefinition
}

type RangeFilterValue = { min: string; max: string }
type DateRangeFilterValue = { from: string; to: string }
type FilterValue = string | string[] | RangeFilterValue | DateRangeFilterValue
type FilterState = Record<string, FilterValue>

interface FulcrumDataTableProps<Row> {
	columns: Array<FulcrumDataTableColumn<Row>>
	rows: Row[]
	emptyMessage: string
	searchPlaceholder: string
	pageSize: number
	pageSizeOptions?: number[]
	customActions?: ReactNode
	getRowClassName?: (row: Row) => string | undefined
	/** Must return a stable identity so expanded rows cannot move to another row after filtering. */
	getRowKey: (row: Row, index: number) => string
	renderExpandedRow?: (row: Row) => ReactNode
	compactRows?: boolean
}

function valueToText(value: FulcrumCellValue): string {
	if (value instanceof Date) return value.toISOString()
	return value == null ? '' : String(value)
}

function valueToDateKey(value: FulcrumCellValue): string {
	if (value instanceof Date) return value.toISOString().slice(0, 10)
	return valueToText(value).slice(0, 10)
}

function valueToNumber(value: FulcrumCellValue): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	const parsed = Number(valueToText(value).replace(/,/g, ''))
	return Number.isFinite(parsed) ? parsed : null
}

function getInitialFilterValue(filter: FulcrumFilterDefinition): FilterValue {
	switch (filter.kind) {
		case 'multi-select':
			return []
		case 'range':
			return { min: '', max: '' }
		case 'date-range':
			return { from: '', to: '' }
		default:
			return ''
	}
}

function filterHasValue(value: FilterValue): boolean {
	if (Array.isArray(value)) return value.length > 0
	if (typeof value === 'object') return Object.values(value).some(Boolean)
	return value.trim().length > 0
}

function compareValues(left: FulcrumCellValue, right: FulcrumCellValue): number {
	const leftNumber = valueToNumber(left)
	const rightNumber = valueToNumber(right)
	if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
	return valueToText(left).localeCompare(valueToText(right), undefined, {
		numeric: true,
		sensitivity: 'base',
	})
}

function matchesFilter<Row>(
	row: Row,
	column: FulcrumDataTableColumn<Row>,
	value: FilterValue
): boolean {
	if (!column.filter || !filterHasValue(value)) return true

	const rawValue = column.getValue(row)
	const textValue = valueToText(rawValue).toLowerCase()

	switch (column.filter.kind) {
		case 'multi-select':
		case 'select':
		case 'autocomplete': {
			const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
			return selected.some((option) => option.toLowerCase() === textValue)
		}
		case 'range': {
			const range = value as RangeFilterValue
			const numericValue = valueToNumber(rawValue)
			if (numericValue === null) return false
			return (
				(!range.min || numericValue >= Number(range.min)) &&
				(!range.max || numericValue <= Number(range.max))
			)
		}
		case 'date-range': {
			const range = value as DateRangeFilterValue
			const dateValue = valueToDateKey(rawValue)
			return (!range.from || dateValue >= range.from) && (!range.to || dateValue <= range.to)
		}
		case 'text':
			return textValue.includes(String(value).toLowerCase())
	}
}

function getFilterOptions<Row>(column: FulcrumDataTableColumn<Row>, rows: Row[]): SelectOption[] {
	if (column.filter && 'options' in column.filter && column.filter.options) {
		return column.filter.options
	}

	return Array.from(new Set(rows.map((row) => valueToText(column.getValue(row))).filter(Boolean)))
		.sort((left, right) =>
			left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
		)
		.map((value) => ({ value, label: value }))
}

export function FulcrumDataTable<Row>({
	columns,
	rows,
	emptyMessage,
	searchPlaceholder,
	pageSize: initialPageSize,
	pageSizeOptions = [25, 50, 100, 200, 500, 1000],
	customActions,
	getRowClassName,
	getRowKey,
	renderExpandedRow,
	compactRows = false,
}: FulcrumDataTableProps<Row>) {
	const [globalFilter, setGlobalFilter] = useState('')
	const [filterState, setFilterState] = useState<FilterState>(() =>
		Object.fromEntries(
			columns
				.filter((column) => column.filter)
				.map((column) => [column.id, getInitialFilterValue(column.filter!)])
		)
	)
	const [sorting, setSorting] = useState<DataTableSortingState>([])
	const [pagination, setPagination] = useState<DataTablePagination>({
		pageIndex: 0,
		pageSize: initialPageSize,
	})

	useEffect(() => {
		setPagination((current) => ({ ...current, pageIndex: 0 }))
	}, [globalFilter, filterState, sorting])

	const filteredRows = useMemo(() => {
		const normalizedSearch = globalFilter.trim().toLowerCase()
		return rows.filter((row) => {
			if (
				normalizedSearch &&
				!columns.some(
					(column) =>
						column.globalFilter !== false &&
						valueToText(column.getValue(row)).toLowerCase().includes(normalizedSearch)
				)
			) {
				return false
			}

			return columns.every((column) => {
				const filter = column.filter
				if (!filter) return true
				return matchesFilter(row, column, filterState[column.id] ?? getInitialFilterValue(filter))
			})
		})
	}, [columns, filterState, globalFilter, rows])

	const sortedRows = useMemo(() => {
		const activeSort = sorting[0]
		if (!activeSort) return filteredRows
		const column = columns.find((candidate) => candidate.id === activeSort.id)
		if (!column) return filteredRows

		return [...filteredRows].sort((left, right) => {
			const result = compareValues(column.getValue(left), column.getValue(right))
			return activeSort.desc ? -result : result
		})
	}, [columns, filteredRows, sorting])

	useEffect(() => {
		const maxPage = Math.max(0, Math.ceil(sortedRows.length / pagination.pageSize) - 1)
		setPagination((current) =>
			current.pageIndex > maxPage ? { ...current, pageIndex: maxPage } : current
		)
	}, [pagination.pageSize, pagination.pageIndex, sortedRows.length])

	const visibleRows = sortedRows.slice(
		pagination.pageIndex * pagination.pageSize,
		(pagination.pageIndex + 1) * pagination.pageSize
	)

	const tableColumns = useMemo(
		() =>
			columns.map(
				({ getValue: _getValue, globalFilter: _globalFilter, filter: _filter, ...column }) => ({
					...column,
					sortable: column.sortable ?? true,
				})
			),
		[columns]
	)

	const activeFilterCount = Object.values(filterState).filter(filterHasValue).length
	const setFilter = (id: string, value: FilterValue) => {
		setFilterState((current) => ({ ...current, [id]: value }))
	}
	const clearFilters = () => {
		setGlobalFilter('')
		setFilterState(
			Object.fromEntries(
				columns
					.filter((column) => column.filter)
					.map((column) => [column.id, getInitialFilterValue(column.filter!)])
			)
		)
	}

	const filterControls = columns.filter((column) => column.filter)
	const toolbar = (
		<div className="space-y-3">
			<div className="flex flex-wrap items-end gap-3">
				<FilterField label="Search" className="min-w-[min(100%,18rem)] flex-1">
					<Input
						value={globalFilter}
						onChange={(event) => setGlobalFilter(event.target.value)}
						placeholder={searchPlaceholder}
						className="h-9"
					/>
				</FilterField>
				{customActions}
			</div>
			{filterControls.length > 0 ? (
				<details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
					<summary className="cursor-pointer text-sm font-medium text-muted-foreground">
						Column filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
					</summary>
					<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{filterControls.map((column) => {
							const filter = column.filter!
							const label =
								filter.label ?? (typeof column.header === 'string' ? column.header : column.id)
							const value = filterState[column.id] ?? getInitialFilterValue(filter)

							if (filter.kind === 'range') {
								const range = value as RangeFilterValue
								return (
									<FilterField key={column.id} label={label}>
										<div className="flex gap-2">
											<Input
												type="number"
												value={range.min}
												placeholder="Min"
												className="h-9"
												onChange={(event) =>
													setFilter(column.id, { ...range, min: event.target.value })
												}
											/>
											<Input
												type="number"
												value={range.max}
												placeholder="Max"
												className="h-9"
												onChange={(event) =>
													setFilter(column.id, { ...range, max: event.target.value })
												}
											/>
										</div>
									</FilterField>
								)
							}

							if (filter.kind === 'date-range') {
								const range = value as DateRangeFilterValue
								return (
									<FilterField key={column.id} label={label}>
										<div className="flex gap-2">
											<Input
												type="date"
												value={range.from}
												aria-label={`${label} from`}
												className="h-9"
												onChange={(event) =>
													setFilter(column.id, { ...range, from: event.target.value })
												}
											/>
											<Input
												type="date"
												value={range.to}
												aria-label={`${label} to`}
												className="h-9"
												onChange={(event) =>
													setFilter(column.id, { ...range, to: event.target.value })
												}
											/>
										</div>
									</FilterField>
								)
							}

							if (filter.kind === 'multi-select') {
								return (
									<FilterField key={column.id} label={label}>
										<Select
											multiple
											values={Array.isArray(value) ? value : []}
											options={getFilterOptions(column, rows)}
											placeholder={`All ${label.toLowerCase()}`}
											onValuesChange={(next) => setFilter(column.id, next)}
											className="w-full"
										/>
									</FilterField>
								)
							}

							return (
								<FilterField key={column.id} label={label}>
									<Select
										value={typeof value === 'string' ? value : ''}
										options={getFilterOptions(column, rows)}
										placeholder={`All ${label.toLowerCase()}`}
										searchable={filter.kind === 'autocomplete'}
										onValueChange={(next) => setFilter(column.id, next)}
										className="w-full"
									/>
								</FilterField>
							)
						})}
					</div>
					{activeFilterCount > 0 ? (
						<button
							type="button"
							className="mt-3 text-xs text-primary hover:underline"
							onClick={clearFilters}
						>
							Clear filters
						</button>
					) : null}
				</details>
			) : null}
		</div>
	)

	return (
		<div className="space-y-3">
			<div className="rounded-lg border border-border/50 bg-card p-4">{toolbar}</div>
			<DataTable
				columns={tableColumns}
				rows={visibleRows}
				loading={false}
				emptyMessage={emptyMessage}
				sorting={sorting}
				onSortingChange={setSorting}
				pagination={pagination}
				onPaginationChange={setPagination}
				rowCount={sortedRows.length}
				itemLabel="entries"
				pageSizeOptions={pageSizeOptions}
				getRowKey={getRowKey}
				getRowClassName={getRowClassName}
				renderExpandedRow={renderExpandedRow}
				className={compactRows ? '[&_td]:py-1.5' : undefined}
			/>
		</div>
	)
}
