import { useState } from 'react'

import {
	SortableTableHead,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useAppTranslation } from '@/i18n'
import { formatMonthYear } from '@/lib/date-utils'
import {
	formatTaxIskFull,
	formatTaxNumber,
	formatTaxRefTypeLabel,
	getTaxRefTypeColor,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { TaxMemberSummary } from '@repo/corporation-tax'

const UNATTRIBUTED_CHARACTER_ID = '__unattributed__'

type MemberSummarySortField =
	| 'characterId'
	| 'contributionIncome'
	| 'taxableContributionIncome'
	| 'assessmentCount'
	| 'lastAssessmentAt'

type MemberSummaryReportGridProps = {
	rows: TaxMemberSummary[]
	loading?: boolean
	error?: unknown
	entityNames: Record<string, string>
	sortBy: MemberSummarySortField
	sortDir: 'asc' | 'desc'
	onSortChange: (field: MemberSummarySortField) => void
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
	totalRows: number
}

function MemberSummaryPagination({
	totalRows,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
	loading,
}: Pick<
	MemberSummaryReportGridProps,
	'totalRows' | 'page' | 'pageSize' | 'onPageChange' | 'onPageSizeChange' | 'loading'
>) {
	const { t } = useAppTranslation()

	return (
		<UserSearchPaginationControls
			totalCount={totalRows}
			page={page + 1}
			pageSize={pageSize}
			onPageChange={(nextPage) => onPageChange(nextPage - 1)}
			onPageSizeChange={onPageSizeChange}
			pageSizeOptions={[25, 50, 100]}
			itemLabel={t('tax.members')}
			nextButtonLoading={loading}
		/>
	)
}

function parseIsk(value: string): number {
	const normalized = value.trim().replace(/,/g, '')
	const parsed = Number(normalized)
	return Number.isFinite(parsed) ? parsed : 0
}

function SortableHead({
	label,
	field,
	sortBy,
	sortDir,
	onSortChange,
}: {
	label: string
	field: MemberSummarySortField
	sortBy: MemberSummarySortField
	sortDir: 'asc' | 'desc'
	onSortChange: (field: MemberSummarySortField) => void
}) {
	const isActive = sortBy === field

	return (
		<SortableTableHead
			onSort={() => onSortChange(field)}
			direction={isActive ? sortDir : undefined}
		>
			{label}
		</SortableTableHead>
	)
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

function TopSourceBreakdown({ topRefTypes }: { topRefTypes: TaxMemberSummary['topRefTypes'] }) {
	if (topRefTypes.length === 0) {
		return <span>-</span>
	}

	const segmentWeights = topRefTypes.map((source) =>
		Math.max(1, parseIsk(source.contributionAmount))
	)
	const totalWeight = segmentWeights.reduce((sum, value) => sum + value, 0)

	return (
		<div className="min-w-[15rem] text-xs">
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
							amount={source.contributionAmount}
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
	const { t } = useAppTranslation()

	const errorMessage =
		props.error instanceof Error ? props.error.message : t('tax.unableToLoadMemberSummary')

	return (
		<div className="space-y-3">
			{props.error ? <div className="text-sm text-destructive">{errorMessage}</div> : null}
			<MemberSummaryPagination {...props} />
			<div className="relative overflow-hidden rounded-md border border-border">
				<Table className="min-w-[70rem]">
					<TableHeader>
						<TableRow>
							<SortableHead
								label={t('tax.character')}
								field="characterId"
								sortBy={props.sortBy}
								sortDir={props.sortDir}
								onSortChange={props.onSortChange}
							/>
							<SortableHead
								label={t('tax.contribution')}
								field="contributionIncome"
								sortBy={props.sortBy}
								sortDir={props.sortDir}
								onSortChange={props.onSortChange}
							/>
							<SortableHead
								label={t('tax.taxable')}
								field="taxableContributionIncome"
								sortBy={props.sortBy}
								sortDir={props.sortDir}
								onSortChange={props.onSortChange}
							/>
							<SortableHead
								label={t('tax.assessments2')}
								field="assessmentCount"
								sortBy={props.sortBy}
								sortDir={props.sortDir}
								onSortChange={props.onSortChange}
							/>
							<SortableHead
								label={t('tax.mostRecentAssessment')}
								field="lastAssessmentAt"
								sortBy={props.sortBy}
								sortDir={props.sortDir}
								onSortChange={props.onSortChange}
							/>
							<TableHead>{t('tax.sourceSplit')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{props.rows.length > 0 ? (
							props.rows.map((row) => (
								<TableRow key={row.characterId}>
									<TableCell>
										{row.characterId === UNATTRIBUTED_CHARACTER_ID ? (
											<div className="font-medium">{t('tax.unattributed')}</div>
										) : (
											<TaxEntityDisplay
												entityId={row.characterId}
												entityNames={props.entityNames}
											/>
										)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{formatTaxIskFull(row.contributionIncome)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{formatTaxIskFull(row.taxableContributionIncome)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{formatTaxNumber(row.assessmentCount)}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{row.lastAssessmentAt ? formatMonthYear(row.lastAssessmentAt) : '-'}
									</TableCell>
									<TableCell>
										<TopSourceBreakdown topRefTypes={row.topRefTypes} />
									</TableCell>
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
									{props.loading
										? t('tax.loadingMemberContributionRecords')
										: t('tax.noMemberContributionRecordsWereFoundForTheSelectedScope')}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
				{props.loading && props.rows.length > 0 ? (
					<div className="absolute inset-0 flex items-center justify-center bg-background/45 text-sm text-muted-foreground backdrop-blur-[1px]">
						{t('tax.loading')}
					</div>
				) : null}
			</div>
			<MemberSummaryPagination {...props} />
		</div>
	)
}
