import { useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useCorporationAccess } from '@/features/my-corporations'
import {
	useTaxCapabilities,
	useTaxCorporations,
	useTaxMemberSummary,
	useTaxSummaryReport,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import {
	formatTaxIskCompact,
	formatTaxIskFull,
	formatTaxNumber,
	formatTaxRefTypeLabel,
	TaxEntityDisplay,
} from '@/lib/tax-display'

function parseIsk(value: string): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
const UNATTRIBUTED_CHARACTER_ID = '__unattributed__'
const TOP_SOURCE_COLORS = [
	{ bgClass: 'bg-sky-500', hoverBgColor: '#38bdf8' },
	{ bgClass: 'bg-emerald-500', hoverBgColor: '#34d399' },
	{ bgClass: 'bg-amber-500', hoverBgColor: '#fbbf24' },
	{ bgClass: 'bg-fuchsia-500', hoverBgColor: '#e879f9' },
	{ bgClass: 'bg-rose-500', hoverBgColor: '#fb7185' },
] as const

function SourceSplitSegment({
	colorClass,
	hoverBgColor,
	label,
	amount,
	share,
	widthPercent,
}: {
	colorClass: string
	hoverBgColor: string
	label: string
	amount: string
	share: number
	widthPercent: number
}) {
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)

	return (
		<>
			<div
				className={colorClass}
				style={{
					width: `${widthPercent}%`,
					minWidth: share > 0 && share < 2 ? '6px' : undefined,
					backgroundColor: tooltipPosition ? hoverBgColor : undefined,
					boxShadow: tooltipPosition ? 'inset 0 0 0 2px rgba(255, 255, 255, 0.28)' : undefined,
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
						<span className={`inline-block h-2 w-2 rounded-full ${colorClass}`} />
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
	topRefTypes: Array<{ refType: string; taxableAmount: string }>
}) {
	if (topRefTypes.length === 0) {
		return <span>-</span>
	}

	const totalTaxableAmount = topRefTypes.reduce(
		(sum, source) => sum + parseIsk(source.taxableAmount),
		0
	)
	if (totalTaxableAmount <= 0) {
		return (
			<div className="space-y-1">
				{topRefTypes.map((source, index) => (
					<div
						key={`${source.refType}:${index}`}
						className="flex items-center gap-1 text-[11px] text-muted-foreground"
					>
						<span
							className={`inline-block h-2 w-2 rounded-sm ${TOP_SOURCE_COLORS[index % TOP_SOURCE_COLORS.length].bgClass}`}
						/>
						<span>{formatTaxRefTypeLabel(source.refType)}</span>
					</div>
				))}
			</div>
		)
	}

	return (
		<div>
			<div className="flex h-5 w-full overflow-hidden rounded bg-muted">
				{topRefTypes.map((source, index) => {
					const amount = parseIsk(source.taxableAmount)
					const share = (amount / totalTaxableAmount) * 100
					const label = formatTaxRefTypeLabel(source.refType)
					return (
						<SourceSplitSegment
							key={`${source.refType}:${index}:segment`}
							colorClass={TOP_SOURCE_COLORS[index % TOP_SOURCE_COLORS.length].bgClass}
							hoverBgColor={TOP_SOURCE_COLORS[index % TOP_SOURCE_COLORS.length].hoverBgColor}
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

export default function TaxMemberSummaryPage() {
	usePageTitle('Tax Member Summary')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canReadWithUrn = globalCapabilities?.global.canRead ?? false
	const { data: corporationAccess } = useCorporationAccess()

	const { data: corporationSettings = [] } = useTaxCorporations({
		limit: 200,
		enabled: canReadWithUrn,
	})
	const unresolvedCorporationIds = useMemo(() => {
		const accessIdSet = new Set(
			(corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)
		)
		return corporationSettings
			.map((setting) => setting.corporationId)
			.filter((corporationId) => !accessIdSet.has(corporationId))
	}, [corporationAccess?.corporations, corporationSettings])
	const { data: resolvedCorporationNames = {} } = useEntityNames(unresolvedCorporationIds, {
		enabled: unresolvedCorporationIds.length > 0,
	})

	const corporationOptions = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) {
			map.set(corp.corporationId, corp.name)
		}
		for (const setting of corporationSettings) {
			if (!map.has(setting.corporationId)) {
				map.set(
					setting.corporationId,
					resolvedCorporationNames[setting.corporationId] ?? setting.corporationId
				)
			}
		}
		return Array.from(map.entries()).map(([corporationId, name]) => ({ corporationId, name }))
	}, [corporationAccess?.corporations, corporationSettings, resolvedCorporationNames])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)
	const [characterQuery, setCharacterQuery] = useState('')
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)

	const effectiveCorporationId = useMemo(() => {
		if (selectedCorporationId) {
			return selectedCorporationId
		}
		if (corporationOptions.length > 0) {
			return corporationOptions[0]?.corporationId
		}
		return undefined
	}, [selectedCorporationId, corporationOptions])

	const { data: scopedCapabilities } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canSearchCharacter =
		canReadWithUrn ||
		(scopedCapabilities?.scoped.canRead ?? false) ||
		(corporationAccess?.hasAccess ?? false)

	const fromDateIso = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).toISOString() : undefined
	const toDateIso = toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : undefined

	const {
		data: summaries = [],
		isLoading,
		isFetching,
		refetch: refetchMemberSummary,
		error,
	} = useTaxMemberSummary(effectiveCorporationId, {
		characterQuery: canSearchCharacter ? characterQuery.trim() || undefined : undefined,
		fromDate: fromDateIso,
		toDate: toDateIso,
		enabled: !!effectiveCorporationId,
	})

	const {
		data: summaryReport,
		isFetching: isSummaryReportFetching,
		refetch: refetchSummaryReport,
	} = useTaxSummaryReport({
		corporationId: effectiveCorporationId,
		fromDate: fromDateIso,
		toDate: toDateIso,
		enabled: Boolean(effectiveCorporationId),
	})

	const isRefreshing = isFetching || isSummaryReportFetching

	const totals = summaries.reduce(
		(acc, row) => {
			acc.totalIncome += parseIsk(row.contributionIncome)
			acc.totalTaxableIncome += parseIsk(row.taxableContributionIncome)
			if (row.characterId !== UNATTRIBUTED_CHARACTER_ID) {
				acc.membersInView += 1
			}
			return acc
		},
		{ totalIncome: 0, totalTaxableIncome: 0, membersInView: 0 }
	)

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of summaries) {
			ids.add(row.corporationId)
			if (row.characterId !== UNATTRIBUTED_CHARACTER_ID) {
				ids.add(row.characterId)
			}
		}
		return [...ids]
	}, [summaries])

	const { data: entityNames = {} } = useEntityNames(entityIds, {
		enabled: Boolean(effectiveCorporationId),
	})

	return (
		<Container>
			<PageHeader
				title="Tax Member Summary"
				description="View member-attributed contribution into corporation wallet inflows and taxable contribution by source."
			/>

			<Section>
				{corporationOptions.length > 0 ? (
					<TaxCorporationScopeSelector
						corporations={corporationOptions}
						effectiveCorporationId={effectiveCorporationId}
						onSelect={setSelectedCorporationId}
					/>
				) : (
					<Card>
						<CardHeader>
							<CardTitle>No Corporation Scope</CardTitle>
							<CardDescription>No corporation scope is available for this account.</CardDescription>
						</CardHeader>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Filters</CardTitle>
						<CardDescription>
							Filter by period and optionally search members by character name prefix or exact ID.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
						<div className="space-y-2">
							<div className="text-sm font-medium">Date Range</div>
							<DateRangeInput
								value={{ fromDate, toDate }}
								onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
									setFromDate(nextFromDate)
									setToDate(nextToDate)
								}}
								placeholder="Date range"
							/>
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Character</div>
							<Input
								value={characterQuery}
								onChange={(event) => setCharacterQuery(event.target.value)}
								placeholder="Character name or ID"
								disabled={!canSearchCharacter}
							/>
						</div>
						<div className="md:justify-self-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									void refetchMemberSummary()
									void refetchSummaryReport()
								}}
								disabled={isRefreshing}
							>
								{isRefreshing ? 'Refreshing…' : 'Refresh'}
							</Button>
						</div>
					</CardContent>
				</Card>

				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Members in View</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxNumber(totals.membersInView)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Total Income</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxIskCompact(totals.totalIncome)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Taxable Income Due</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxIskCompact(totals.totalTaxableIncome)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Taxes Paid</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxIskCompact(summaryReport?.taxPaid ?? '0')}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Member Contribution Summary</CardTitle>
						<CardDescription>
							Aggregated from corporation wallet entries attributed to members in the selected
							period.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to load member summaries.
							</div>
						) : isLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading member summaries...</div>
						) : error ? (
							<div className="py-8 text-sm text-destructive">
								{error instanceof Error ? error.message : 'Failed to load member summaries'}
							</div>
						) : summaries.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No member contribution records were found for the selected scope and period.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Character</TableHead>
										<TableHead>Contribution</TableHead>
										<TableHead>Taxable</TableHead>
										<TableHead>Assessments</TableHead>
										<TableHead>Last Assessment</TableHead>
										<TableHead className="w-[15rem] min-w-[15rem]">Source Split</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{summaries.map((row) => (
										<TableRow key={`${row.corporationId}:${row.characterId}`}>
											<TableCell>
												{row.characterId === UNATTRIBUTED_CHARACTER_ID ? (
													<div className="font-medium">Unattributed</div>
												) : (
													<TaxEntityDisplay entityId={row.characterId} entityNames={entityNames} />
												)}
											</TableCell>
											<TableCell>{formatTaxIskFull(row.contributionIncome)}</TableCell>
											<TableCell>{formatTaxIskFull(row.taxableContributionIncome)}</TableCell>
											<TableCell>{formatTaxNumber(row.assessmentCount)}</TableCell>
											<TableCell>{formatTaxDateTime(row.lastAssessmentAt)}</TableCell>
											<TableCell className="min-w-[15rem] text-xs">
												<TopSourceBreakdown topRefTypes={row.topRefTypes} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
