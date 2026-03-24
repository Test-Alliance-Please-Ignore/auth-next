import { createMRTColumnHelper } from 'mantine-react-table'
import { useState } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxIskFull,
	formatTaxNumber,
	formatTaxRefTypeLabel,
	getTaxRefTypeColor,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxMemberSummary } from '@repo/corporation-tax'

const UNATTRIBUTED_CHARACTER_ID = '__unattributed__'

type MemberSummaryReportGridProps = {
	rows: TaxMemberSummary[]
	loading?: boolean
	error?: unknown
	entityNames: Record<string, string>
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount: number
	rowCount: number
}

function parseIsk(value: string): number {
	const normalized = value.trim().replace(/,/g, '')
	const parsed = Number(normalized)
	return Number.isFinite(parsed) ? parsed : 0
}

function SourceSplitSegment({
	color,
	label,
	amount,
	share,
	widthPercent,
}: {
	color: string
	label: string
	amount: string
	share: number
	widthPercent: number
}) {
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)

	return (
		<>
			<div
				style={{
					width: `${widthPercent}%`,
					minWidth: share > 0 && share < 2 ? '6px' : undefined,
					backgroundColor: color,
					filter: tooltipPosition ? 'brightness(1.12)' : undefined,
					boxShadow: tooltipPosition ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.24)' : undefined,
				}}
				onMouseEnter={(event) => setTooltipPosition({ x: event.clientX, y: event.clientY })}
				onMouseMove={(event) => setTooltipPosition({ x: event.clientX, y: event.clientY })}
				onMouseLeave={() => setTooltipPosition(null)}
				aria-label={`${label} ${share.toFixed(1)}%`}
				role="img"
			/>
			{tooltipPosition ? (
				<div
					className="pointer-events-none fixed z-50 min-w-[170px] rounded-md border border-border dropdown-surface px-3 py-2"
					style={{
						left: tooltipPosition.x,
						top: tooltipPosition.y - 12,
						transform: 'translate(-50%, -100%)',
					}}
				>
					<div className="flex items-center gap-2 text-xs font-medium">
						<span
							className="inline-block h-2 w-2 rounded-full"
							style={{ backgroundColor: color }}
						/>
						<span>{label}</span>
					</div>
					<div className="text-xs text-muted-foreground">
						{formatTaxIskFull(amount)} ({share.toFixed(1)}%)
					</div>
				</div>
			) : null}
		</>
	)
}

function TopSourceBreakdown({
	topRefTypes,
}: {
	topRefTypes: Array<{
		refType: string
		contributionAmount?: string
		taxableAmount: string
		lineCount?: number
	}>
}) {
	if (topRefTypes.length === 0) {
		return <span>-</span>
	}

	const segmentWeights = topRefTypes.map((source) => {
		const contributionValue = parseIsk(source.contributionAmount ?? source.taxableAmount)
		return Math.max(1, contributionValue)
	})
	const totalWeight = segmentWeights.reduce((sum, value) => sum + value, 0)

	return (
		<div>
			<div className="flex h-5 w-full overflow-hidden rounded bg-muted">
				{topRefTypes.map((source, index) => {
					const weight = segmentWeights[index] ?? 1
					const share = totalWeight > 0 ? (weight / totalWeight) * 100 : 100 / topRefTypes.length
					const label = formatTaxRefTypeLabel(source.refType)
					return (
						<SourceSplitSegment
							key={`${source.refType}:${index}:segment`}
							color={getTaxRefTypeColor(source.refType)}
							label={label}
							amount={source.taxableAmount}
							share={share}
							widthPercent={share}
						/>
					)
				})}
			</div>
		</div>
	)
}

export function MemberSummaryReportGrid(props: MemberSummaryReportGridProps) {
	const columnHelper = createMRTColumnHelper<TaxMemberSummary>()
	const columns: Array<MRT_ColumnDef<TaxMemberSummary>> = [
		columnHelper.accessor('characterId', {
			id: 'characterId',
			header: 'Character',
			enableSorting: true,
			Cell: ({ row }) =>
				row.original.characterId === UNATTRIBUTED_CHARACTER_ID ? (
					<div className="font-medium">Unattributed</div>
				) : (
					<TaxEntityDisplay entityId={row.original.characterId} entityNames={props.entityNames} />
				),
		}),
		columnHelper.accessor('contributionIncome', {
			id: 'contributionIncome',
			header: 'Contribution',
			enableSorting: true,
			Cell: ({ cell }) => formatTaxIskFull(cell.getValue()),
		}),
		columnHelper.accessor('taxableContributionIncome', {
			id: 'taxableContributionIncome',
			header: 'Taxable',
			enableSorting: true,
			Cell: ({ cell }) => formatTaxIskFull(cell.getValue()),
		}),
		columnHelper.accessor('assessmentCount', {
			id: 'assessmentCount',
			header: 'Assessments',
			enableSorting: true,
			Cell: ({ cell }) => formatTaxNumber(cell.getValue()),
		}),
		columnHelper.accessor('lastAssessmentAt', {
			id: 'lastAssessmentAt',
			header: 'Last Assessment',
			enableSorting: true,
			Cell: ({ cell }) => formatTaxDateTime(cell.getValue()),
		}),
		columnHelper.display({
			id: 'sourceSplit',
			header: 'Source Split',
			enableSorting: false,
			size: 300,
			Cell: ({ row }) => (
				<div className="min-w-[15rem] text-xs">
					<TopSourceBreakdown topRefTypes={row.original.topRefTypes} />
				</div>
			),
		}),
	]

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No member contribution records were found for the selected scope and period."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
