import { cn } from '@/lib/utils'

interface StructureFuelUsageChartPoint {
	observedAt: string
	fuelBlockUnits: number | null
	fuelBurnRatePerHour: number | null
}

interface StructureFuelUsageChartProps {
	points: StructureFuelUsageChartPoint[]
	className?: string
}

function formatFuelValue(value: number | null): string {
	if (value === null) {
		return '-'
	}
	return value.toLocaleString()
}

function formatBurnRateValue(value: number | null): string {
	if (value === null) {
		return '-'
	}
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`
}

function getLineSegments(
	values: Array<number | null>,
	xForIndex: (index: number) => number,
	yForValue: (value: number) => number
): string[] {
	const segments: string[] = []
	let current: string[] = []

	values.forEach((value, index) => {
		if (value === null) {
			if (current.length > 0) {
				segments.push(current.join(' '))
				current = []
			}
			return
		}

		current.push(`${current.length === 0 ? 'M' : 'L'} ${xForIndex(index).toFixed(2)} ${yForValue(value).toFixed(2)}`)
	})

	if (current.length > 0) {
		segments.push(current.join(' '))
	}

	return segments
}

export function StructureFuelUsageChart({ points, className }: StructureFuelUsageChartProps) {
	const width = 720
	const height = 260
	const margin = { top: 16, right: 64, bottom: 32, left: 64 }
	const chartWidth = width - margin.left - margin.right
	const chartHeight = height - margin.top - margin.bottom
	const fuelValues = points.map((point) => point.fuelBlockUnits).filter((value): value is number => value !== null)
	const burnValues = points
		.map((point) => point.fuelBurnRatePerHour)
		.filter((value): value is number => value !== null)

	if (points.length === 0 || fuelValues.length === 0) {
		return (
			<div className={cn('rounded-lg border border-dashed border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground', className)}>
				No fuel history has been recorded yet for this structure.
			</div>
		)
	}

	const fuelMax = Math.max(...fuelValues, 1)
	const burnMax = Math.max(...burnValues, 1)
	const xForIndex = (index: number) =>
		margin.left + (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
	const fuelYForValue = (value: number) => margin.top + chartHeight - (value / fuelMax) * chartHeight
	const burnYForValue = (value: number) => margin.top + chartHeight - (value / burnMax) * chartHeight
	const fuelSegments = getLineSegments(points.map((point) => point.fuelBlockUnits), xForIndex, fuelYForValue)
	const burnSegments = getLineSegments(
		points.map((point) => point.fuelBurnRatePerHour),
		xForIndex,
		burnYForValue
	)

	const startLabel = new Date(points[0]?.observedAt ?? '').toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	})
	const endLabel = new Date(points[points.length - 1]?.observedAt ?? '').toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	})

	return (
		<div className={cn('space-y-3', className)}>
			<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-2">
					<span className="h-2 w-2 rounded-full bg-primary" />
					Fuel blocks {formatFuelValue(points[points.length - 1]?.fuelBlockUnits ?? null)}
				</span>
				<span className="inline-flex items-center gap-2">
					<span className="h-2 w-2 rounded-full bg-amber-400" />
					Burn rate {formatBurnRateValue(points[points.length - 1]?.fuelBurnRatePerHour ?? null)}
				</span>
				<span>7-day hourly span</span>
			</div>
			<div className="overflow-hidden rounded-lg border border-border/60 bg-muted/10">
				<svg viewBox={`0 0 ${width} ${height}`} className="block h-64 w-full">
					<defs>
						<linearGradient id="structure-fuel-fill" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.24" />
							<stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
						</linearGradient>
					</defs>
					{[0, 1, 2, 3].map((step) => {
						const y = margin.top + (chartHeight / 3) * step
						return (
							<line
								key={step}
								x1={margin.left}
								x2={width - margin.right}
								y1={y}
								y2={y}
								stroke="hsl(var(--border))"
								strokeOpacity="0.5"
								strokeDasharray="4 4"
							/>
						)
					})}
					{fuelSegments.map((segment, index) => (
						<path
							key={`fuel-${index}`}
							d={segment}
							fill="none"
							stroke="hsl(var(--primary))"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					))}
					{burnSegments.map((segment, index) => (
						<path
							key={`burn-${index}`}
							d={segment}
							fill="none"
							stroke="hsl(38 92% 50%)"
							strokeWidth="2"
							strokeDasharray="7 5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					))}
					<line
						x1={margin.left}
						x2={margin.left}
						y1={margin.top}
						y2={margin.top + chartHeight}
						stroke="hsl(var(--border))"
						strokeOpacity="0.7"
					/>
					<line
						x1={width - margin.right}
						x2={width - margin.right}
						y1={margin.top}
						y2={margin.top + chartHeight}
						stroke="hsl(var(--border))"
						strokeOpacity="0.7"
					/>
					<text x={margin.left} y={12} className="fill-muted-foreground text-[10px]">
						{fuelMax.toLocaleString()} blocks
					</text>
					<text x={width - margin.right} y={12} textAnchor="end" className="fill-muted-foreground text-[10px]">
						{burnMax.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr
					</text>
					<text x={margin.left} y={height - 6} className="fill-muted-foreground text-[10px]">
						{startLabel}
					</text>
					<text x={width - margin.right} y={height - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">
						{endLabel}
					</text>
				</svg>
			</div>
		</div>
	)
}
