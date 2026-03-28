import { ComplianceGrid } from '@/components/tax-reports/grids'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTaxIskCompact } from '@/lib/tax-display'
import { parseTaxAmount } from '@/lib/tax-report-utils'

import type { TaxCompliancePoint } from '@repo/corporation-tax'

interface TaxReportSelectorProps {
	selectedReportView: string
	onSelectReportView: (value: string) => void
	reportSelectorQuery: string
	onReportSelectorQueryChange: (value: string) => void
	visibleReportOptions: Array<{ value: string; label: string }>
}

export function TaxReportSelector(props: TaxReportSelectorProps) {
	return (
		<>
			<div className="md:hidden">
				<Select
					value={props.selectedReportView}
					onValueChange={(nextValue) => {
						props.onReportSelectorQueryChange('')
						props.onSelectReportView(nextValue)
					}}
					query={props.reportSelectorQuery}
					onQueryChange={props.onReportSelectorQueryChange}
					searchable
					options={props.visibleReportOptions.map((option) => ({ value: option.value,
						label: option.label,
					}))}
					placeholder="Choose report"
					emptyText="No reports match"
				/>
			</div>

			<div className="hidden md:block overflow-x-auto">
				<Tabs value={props.selectedReportView} onValueChange={props.onSelectReportView}>
					<TabsList>
						{props.visibleReportOptions.map((option) => (
							<TabsTrigger key={option.value} value={option.value}>
								{option.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
		</>
	)
}

export function TaxComplianceReportSection(props: {
	loading: boolean
	error: unknown
	rows: TaxCompliancePoint[]
	chartRows: TaxCompliancePoint[]
}) {
	if (props.loading) {
		return <div className="py-8 text-sm text-muted-foreground">Loading compliance trend...</div>
	}

	if (props.error) {
		return (
			<div className="py-8 text-sm text-destructive">
				{props.error instanceof Error ? props.error.message : 'Failed to load compliance report'}
			</div>
		)
	}

	if (props.rows.length === 0) {
		return (
			<div className="py-8 text-sm text-muted-foreground">
				No compliance trend points available.
			</div>
		)
	}

	const chartWidth = 860
	const chartHeight = 300
	const topPadding = 24
	const bottomPadding = 48
	const leftPadding = 44
	const rightPadding = 20
	const plotWidth = chartWidth - leftPadding - rightPadding
	const plotHeight = chartHeight - topPadding - bottomPadding
	const zeroY = topPadding + plotHeight / 2
	const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
	const deltas = props.chartRows.map((row) => parseTaxAmount(row.taxDelta))
	const maxAbsDelta = Math.max(1, ...deltas.map((value) => Math.abs(value)))
	const pointCount = Math.max(1, props.chartRows.length)
	const step = plotWidth / pointCount
	const barWidth = Math.max(12, Math.min(42, step * 0.58))
	const halfPlotHeight = plotHeight / 2

	return (
		<div className="space-y-4">
			<div className="rounded border bg-muted/20 p-3">
				<svg
					viewBox={`0 0 ${chartWidth} ${chartHeight}`}
					className="w-full"
					role="img"
					aria-label="Compliance period delta chart"
				>
					<line
						x1={leftPadding}
						y1={zeroY}
						x2={chartWidth - rightPadding}
						y2={zeroY}
						stroke="hsl(var(--border))"
						strokeWidth="1"
					/>
					<text
						x={leftPadding}
						y={zeroY - 6}
						textAnchor="start"
						fill="hsl(var(--muted-foreground))"
						fontSize="10"
					>
						Overpaid
					</text>
					<text
						x={leftPadding}
						y={zeroY + 14}
						textAnchor="start"
						fill="hsl(var(--muted-foreground))"
						fontSize="10"
					>
						Underpaid
					</text>
					{props.chartRows.map((row, index) => {
						const delta = parseTaxAmount(row.taxDelta)
						const absDelta = Math.abs(delta)
						const barHeight = Math.max(1, (absDelta / maxAbsDelta) * (halfPlotHeight - 10))
						const centerX = leftPadding + index * step + step / 2
						const barX = centerX - barWidth / 2
						const barY = delta >= 0 ? zeroY : zeroY - barHeight
						const label = formatter.format(new Date(row.rollupDate))
						const fill = delta >= 0 ? 'hsl(var(--destructive))' : 'hsl(var(--success))'
						const valueY =
							delta >= 0
								? Math.min(chartHeight - bottomPadding + 11, zeroY + barHeight + 12)
								: Math.max(topPadding + 9, zeroY - barHeight - 6)

						return (
							<g key={`${row.rollupDate}-${index}`}>
								<rect x={barX} y={barY} width={barWidth} height={barHeight} rx={2} fill={fill} />
								<text
									x={centerX}
									y={valueY}
									textAnchor="middle"
									fill="hsl(var(--foreground))"
									fontSize="10"
								>
									{formatTaxIskCompact(delta)}
								</text>
								<text
									x={centerX}
									y={chartHeight - 12}
									textAnchor="middle"
									fill="hsl(var(--muted-foreground))"
									fontSize="10"
								>
									{label}
								</text>
							</g>
						)
					})}
				</svg>
				<div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
					<div className="flex items-center gap-2">
						<span className="h-2 w-2 rounded-full bg-destructive" />
						Underpaid (positive delta)
					</div>
					<div className="flex items-center gap-2">
						<span className="h-2 w-2 rounded-full bg-success" />
						Overpaid (negative delta)
					</div>
					<div>Showing {props.chartRows.length} periods</div>
				</div>
			</div>

			<ComplianceGrid rows={props.rows} loading={false} error={null} />
		</div>
	)
}
