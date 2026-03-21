import { useEffect, useMemo, useState } from 'react'

import { TaxComplianceReportSection } from '@/components/tax-reports/report-display'
import {
	BillStatusReportGrid,
	DiscrepancyGrid,
	EssPayoutGrid,
	MissingEsiKeysGrid,
	TotalTaxesReportGrid,
} from '@/components/tax-reports/report-view-grids'
import {
	useTaxBillStatusReport,
	useTaxComplianceReport,
	useTaxDiscrepancyReport,
	useTaxEssPayoutReport,
	useTaxMissingEsiKeysReport,
	useTaxTopIncomeSourcesMonthlyReport,
	useTaxTotalTaxesReport,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { formatTaxIskCompact, formatTaxRefTypeLabel } from '@/lib/tax-display'
import { applySorting, parseTaxAmount, toSorting } from '@/lib/tax-report-utils'

import type { SortDirection } from '@/lib/tax-report-utils'

interface TaxReportFilters {
	corporationId?: string
	fromDate?: string
	toDate?: string
	division?: number
	refType?: string
	firstPartyId?: string
	secondPartyId?: string
	minAmount?: string
}

const REPORT_PAGE_SIZE_DEFAULT = 25
const MONTHLY_INCOME_CHART_HEIGHT = 260
const MONTHLY_BAR_WIDTH = 48
const MONTHLY_BAR_GAP = 18
const MONTHLY_INCOME_COLORS = [
	'#38bdf8',
	'#22d3ee',
	'#34d399',
	'#f59e0b',
	'#f97316',
	'#ef4444',
	'#a78bfa',
	'#f472b6',
	'#84cc16',
	'#06b6d4',
]

function useResetPageOnFilterChange(
	setPage: (value: number) => void,
	filters: TaxReportFilters
): void {
	const filterKey = JSON.stringify(filters)
	useEffect(() => {
		setPage(0)
	}, [filterKey, setPage])
}

export function TotalTaxesReportSection(props: {
	filters: TaxReportFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(REPORT_PAGE_SIZE_DEFAULT)
	const [sortBy, setSortBy] = useState('taxDue')
	const [sortDir, setSortDir] = useState<SortDirection>('desc')
	useResetPageOnFilterChange(setPage, props.filters)

	useEffect(() => {
		props.onSortChange?.(sortBy, sortDir)
	}, [sortBy, sortDir])

	const { data, isLoading, error } = useTaxTotalTaxesReport({
		...props.filters,
		limit: pageSize,
		offset: page * pageSize,
		sortBy,
		sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<TotalTaxesReportGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={toSorting(sortBy, sortDir)}
			onSortingChange={(sorting) =>
				applySorting(sorting, 'taxDue', 'desc', setSortBy, setSortDir, () => setPage(0))
			}
			pagination={{ pageIndex: page, pageSize }}
			onPaginationChange={(next) => {
				setPageSize(next.pageSize)
				setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
			}}
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}

export function TopIncomeSourcesReportSection(props: {
	filters: TaxReportFilters
	enabled: boolean
}) {
	const {
		data = [],
		isLoading,
		error,
	} = useTaxTopIncomeSourcesMonthlyReport({
		...props.filters,
		enabled: props.enabled,
	})

	const chartData = useMemo(() => {
		const refTypeTotals = new Map<string, number>()
		const monthMap = new Map<string, { monthStart: Date; values: Map<string, number> }>()
		for (const row of data) {
			const value = parseTaxAmount(row.totalIncome)
			if (value <= 0) continue
			refTypeTotals.set(row.refType, (refTypeTotals.get(row.refType) ?? 0) + value)
			const monthKey = new Date(row.monthStart).toISOString().slice(0, 10)
			const monthEntry = monthMap.get(monthKey) ?? {
				monthStart: new Date(row.monthStart),
				values: new Map<string, number>(),
			}
			monthEntry.values.set(row.refType, (monthEntry.values.get(row.refType) ?? 0) + value)
			monthMap.set(monthKey, monthEntry)
		}

		const refTypes = Array.from(refTypeTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([refType]) => refType)
		const months = Array.from(monthMap.values()).sort(
			(a, b) => a.monthStart.getTime() - b.monthStart.getTime()
		)
		const maxMonthTotal = months.reduce((max, month) => {
			const total = Array.from(month.values.values()).reduce((sum, value) => sum + value, 0)
			return Math.max(max, total)
		}, 0)
		return { refTypes, months, maxMonthTotal }
	}, [data])

	if (isLoading) {
		return <div className="py-8 text-sm text-muted-foreground">Loading income sources...</div>
	}

	if (error) {
		return (
			<div className="py-8 text-sm text-destructive">
				{error instanceof Error ? error.message : 'Failed to load income sources report'}
			</div>
		)
	}

	if (chartData.months.length === 0 || chartData.refTypes.length === 0) {
		return <div className="py-8 text-sm text-muted-foreground">No income sources found.</div>
	}

	const chartWidth =
		Math.max(
			chartData.months.length * (MONTHLY_BAR_WIDTH + MONTHLY_BAR_GAP) + MONTHLY_BAR_GAP * 2,
			560
		) + 140
	const baselineY = MONTHLY_INCOME_CHART_HEIGHT - 28
	const drawableHeight = MONTHLY_INCOME_CHART_HEIGHT - 56
	const maxTotal = Math.max(chartData.maxMonthTotal, 1)
	const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
	const colorMap = new Map<string, string>(
		chartData.refTypes.map((refType, index) => [
			refType,
			MONTHLY_INCOME_COLORS[index % MONTHLY_INCOME_COLORS.length]!,
		])
	)

	return (
		<div className="space-y-4">
			<div className="rounded border bg-muted/20 p-3">
				<div className="overflow-x-auto">
					<svg
						viewBox={`0 0 ${chartWidth} ${MONTHLY_INCOME_CHART_HEIGHT}`}
						className="h-72 min-w-[680px] w-full"
						role="img"
						aria-label="Monthly taxable inflow stacked by income type"
					>
						<line
							x1={36}
							y1={baselineY}
							x2={chartWidth - 16}
							y2={baselineY}
							stroke="hsl(var(--border))"
							strokeWidth="1"
						/>
						{chartData.months.map((month, monthIndex) => {
							const x = 52 + monthIndex * (MONTHLY_BAR_WIDTH + MONTHLY_BAR_GAP)
							const monthTotal = chartData.refTypes.reduce(
								(sum, refType) => sum + (month.values.get(refType) ?? 0),
								0
							)
							const segments = chartData.refTypes
								.map((refType) => ({ refType, value: month.values.get(refType) ?? 0 }))
								.filter((segment) => segment.value > 0)
							let currentY = baselineY
							return (
								<g key={month.monthStart.toISOString()}>
									{segments.map((segment) => {
										const height = (segment.value / maxTotal) * drawableHeight
										currentY -= height
										const color = colorMap.get(segment.refType) ?? '#38bdf8'
										return (
											<rect
												key={`${month.monthStart.toISOString()}-${segment.refType}`}
												x={x}
												y={currentY}
												width={MONTHLY_BAR_WIDTH}
												height={Math.max(1, height)}
												fill={color}
												rx={2}
											>
												<title>{`${formatTaxRefTypeLabel(
													segment.refType
												)}: ${formatTaxIskCompact(segment.value)} (${(
													(segment.value / monthTotal) *
													100
												).toFixed(1)}%)`}</title>
											</rect>
										)
									})}
									<text
										x={x + MONTHLY_BAR_WIDTH / 2}
										y={baselineY + 14}
										fill="hsl(var(--muted-foreground))"
										fontSize="10"
										textAnchor="middle"
									>
										{formatter.format(month.monthStart)}
									</text>
									<text
										x={x + MONTHLY_BAR_WIDTH / 2}
										y={Math.max(14, baselineY - (monthTotal / maxTotal) * drawableHeight - 6)}
										fill="hsl(var(--muted-foreground))"
										fontSize="10"
										textAnchor="middle"
									>
										{formatTaxIskCompact(monthTotal)}
									</text>
								</g>
							)
						})}
					</svg>
				</div>
				<div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
					{chartData.refTypes.map((refType) => (
						<div key={refType} className="flex items-center gap-2">
							<span
								className="h-2.5 w-2.5 rounded-full"
								style={{ backgroundColor: colorMap.get(refType) ?? '#38bdf8' }}
							/>
							<span>{formatTaxRefTypeLabel(refType)}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}

export function EssPayoutReportSection(props: {
	filters: TaxReportFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(REPORT_PAGE_SIZE_DEFAULT)
	const [sortBy, setSortBy] = useState('entryDate')
	const [sortDir, setSortDir] = useState<SortDirection>('desc')
	useResetPageOnFilterChange(setPage, props.filters)

	useEffect(() => {
		props.onSortChange?.(sortBy, sortDir)
	}, [sortBy, sortDir])

	const { data, isLoading, error } = useTaxEssPayoutReport({
		...props.filters,
		limit: pageSize,
		offset: page * pageSize,
		sortBy,
		sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of rows) {
			ids.add(row.corporationId)
			if (row.firstPartyId) ids.add(row.firstPartyId)
			if (row.secondPartyId) ids.add(row.secondPartyId)
		}
		return [...ids]
	}, [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<EssPayoutGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={toSorting(sortBy, sortDir)}
			onSortingChange={(sorting) =>
				applySorting(sorting, 'entryDate', 'desc', setSortBy, setSortDir, () => setPage(0))
			}
			pagination={{ pageIndex: page, pageSize }}
			onPaginationChange={(next) => {
				setPageSize(next.pageSize)
				setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
			}}
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}

export function DiscrepancyReportSection(props: {
	filters: Pick<TaxReportFilters, 'corporationId' | 'fromDate' | 'toDate'>
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(REPORT_PAGE_SIZE_DEFAULT)
	const [sortBy, setSortBy] = useState('createdAt')
	const [sortDir, setSortDir] = useState<SortDirection>('desc')
	useResetPageOnFilterChange(setPage, props.filters)

	useEffect(() => {
		props.onSortChange?.(sortBy, sortDir)
	}, [sortBy, sortDir])

	const { data, isLoading, error } = useTaxDiscrepancyReport({
		corporationId: props.filters.corporationId,
		fromDate: props.filters.fromDate,
		toDate: props.filters.toDate,
		onlyOpen: true,
		limit: pageSize,
		offset: page * pageSize,
		sortBy,
		sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<DiscrepancyGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={toSorting(sortBy, sortDir)}
			onSortingChange={(sorting) =>
				applySorting(sorting, 'createdAt', 'desc', setSortBy, setSortDir, () => setPage(0))
			}
			pagination={{ pageIndex: page, pageSize }}
			onPaginationChange={(next) => {
				setPageSize(next.pageSize)
				setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
			}}
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}

export function BillStatusReportSection(props: {
	filters: TaxReportFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const [sortBy, setSortBy] = useState('taxDue')
	const [sortDir, setSortDir] = useState<SortDirection>('desc')

	useEffect(() => {
		props.onSortChange?.(sortBy, sortDir)
	}, [sortBy, sortDir])

	const {
		data: rows = [],
		isLoading,
		error,
	} = useTaxBillStatusReport({
		...props.filters,
		limit: 100,
		sortBy,
		sortDir,
		enabled: props.enabled,
	})
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<BillStatusReportGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={toSorting(sortBy, sortDir)}
			onSortingChange={(sorting) => applySorting(sorting, 'taxDue', 'desc', setSortBy, setSortDir)}
		/>
	)
}

export function ComplianceOverTimeReportSection(props: {
	filters: TaxReportFilters
	enabled: boolean
}) {
	const {
		data: rows = [],
		isLoading,
		error,
	} = useTaxComplianceReport({
		...props.filters,
		enabled: props.enabled,
	})

	const chartRows = useMemo(() => rows, [rows])

	return (
		<TaxComplianceReportSection
			loading={isLoading}
			error={error}
			rows={rows}
			chartRows={chartRows}
		/>
	)
}

export function MissingEsiKeysReportSection(props: { enabled: boolean }) {
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(REPORT_PAGE_SIZE_DEFAULT)
	const [sortBy, setSortBy] = useState('lastVerified')
	const [sortDir, setSortDir] = useState<SortDirection>('desc')

	const { data, isLoading, error } = useTaxMissingEsiKeysReport({
		limit: pageSize,
		offset: page * pageSize,
		sortBy,
		sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<MissingEsiKeysGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={toSorting(sortBy, sortDir)}
			onSortingChange={(sorting) =>
				applySorting(sorting, 'lastVerified', 'desc', setSortBy, setSortDir, () => setPage(0))
			}
			pagination={{ pageIndex: page, pageSize }}
			onPaginationChange={(next) => {
				setPageSize(next.pageSize)
				setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
			}}
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}
