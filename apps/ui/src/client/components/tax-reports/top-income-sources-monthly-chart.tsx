import { useMemo, useState } from 'react'

import { formatTaxIskCompact, formatTaxRefTypeLabel, getTaxRefTypeColor } from '@/lib/tax-display'
import { parseTaxAmount } from '@/lib/tax-report-utils'

import type { TaxTopIncomeSourceMonthlyRow } from '@repo/corporation-tax'

const MONTHLY_INCOME_CHART_HEIGHT = 260
const MONTHLY_BAR_WIDTH = 48
const MONTHLY_BAR_GAP = 18
const STACK_SEGMENT_RADIUS = 3
const MIN_STACK_SEGMENT_HOVER_HEIGHT = 8

function brightenHex(hex: string, amount = 0.16): string {
	const normalized = hex.replace('#', '')
	if (normalized.length !== 6) {
		return hex
	}
	const r = Number.parseInt(normalized.slice(0, 2), 16)
	const g = Number.parseInt(normalized.slice(2, 4), 16)
	const b = Number.parseInt(normalized.slice(4, 6), 16)
	if ([r, g, b].some((value) => Number.isNaN(value))) {
		return hex
	}
	const brighten = (value: number) => Math.min(255, Math.round(value + (255 - value) * amount))
	return `rgb(${brighten(r)}, ${brighten(g)}, ${brighten(b)})`
}

function hexToRgba(hex: string, alpha: number): string {
	const normalized = hex.replace('#', '')
	if (normalized.length !== 6) {
		return `rgba(255, 255, 255, ${alpha})`
	}
	const r = Number.parseInt(normalized.slice(0, 2), 16)
	const g = Number.parseInt(normalized.slice(2, 4), 16)
	const b = Number.parseInt(normalized.slice(4, 6), 16)
	if ([r, g, b].some((value) => Number.isNaN(value))) {
		return `rgba(255, 255, 255, ${alpha})`
	}
	return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getStackSegmentPath(input: {
	x: number
	y: number
	width: number
	height: number
	radius: number
	roundTop: boolean
	roundBottom: boolean
}): string {
	const { x, y, width, height, radius, roundTop, roundBottom } = input
	const r = Math.max(0, Math.min(radius, width / 2, height / 2))
	const topLeft = roundTop ? r : 0
	const topRight = roundTop ? r : 0
	const bottomRight = roundBottom ? r : 0
	const bottomLeft = roundBottom ? r : 0
	const x0 = x
	const y0 = y
	const x1 = x + width
	const y1 = y + height

	return [
		`M ${x0 + topLeft} ${y0}`,
		`H ${x1 - topRight}`,
		topRight ? `Q ${x1} ${y0} ${x1} ${y0 + topRight}` : `L ${x1} ${y0}`,
		`V ${y1 - bottomRight}`,
		bottomRight ? `Q ${x1} ${y1} ${x1 - bottomRight} ${y1}` : `L ${x1} ${y1}`,
		`H ${x0 + bottomLeft}`,
		bottomLeft ? `Q ${x0} ${y1} ${x0} ${y1 - bottomLeft}` : `L ${x0} ${y1}`,
		`V ${y0 + topLeft}`,
		topLeft ? `Q ${x0} ${y0} ${x0 + topLeft} ${y0}` : `L ${x0} ${y0}`,
		'Z',
	].join(' ')
}

export function TopIncomeSourcesMonthlyChart({
	rows,
	incomeMode,
	walletSource,
}: {
	rows: TaxTopIncomeSourceMonthlyRow[]
	incomeMode: 'total' | 'assessed'
	walletSource: 'corporation' | 'character'
}) {
	const [hoveredSegment, setHoveredSegment] = useState<{
		key: string
		x: number
		y: number
		color: string
		label: string
		value: number
		share: number
		details?: Array<{
			color: string
			label: string
			value: number
			share: number
		}>
	} | null>(null)

	const chartData = useMemo(() => {
		const refTypeTotals = new Map<string, number>()
		const monthMap = new Map<string, { monthStart: Date; values: Map<string, number> }>()
		for (const row of rows) {
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
	}, [rows])

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
	const formatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC',
	})
	const colorMap = new Map<string, string>(
		chartData.refTypes.map((refType) => [refType, getTaxRefTypeColor(refType)])
	)

	return (
		<div className="space-y-4">
			<div className="rounded border bg-muted/20 p-3">
				<div className="overflow-x-auto">
					<svg
						viewBox={`0 0 ${chartWidth} ${MONTHLY_INCOME_CHART_HEIGHT}`}
						className="h-72 min-w-[680px] w-full"
						role="img"
						aria-label={`${incomeMode === 'assessed' ? 'Monthly assessed tax' : 'Monthly total income'} from ${walletSource === 'character' ? 'player' : 'corporation'} wallets, stacked by income type`}
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
							const laidOutSegments = segments.map((segment, segmentIndex) => {
								const height = (segment.value / maxTotal) * drawableHeight
								currentY -= height
								return {
									...segment,
									height,
									y: currentY,
									isBottom: segmentIndex === 0,
									isTop: segmentIndex === segments.length - 1,
								}
							})
							const tinySegments = laidOutSegments.filter(
								(segment) => segment.height < MIN_STACK_SEGMENT_HOVER_HEIGHT
							)
							const tinyTotalValue = tinySegments.reduce((sum, segment) => sum + segment.value, 0)
							const totalStackHeight = laidOutSegments.reduce(
								(sum, segment) => sum + segment.height,
								0
							)
							const stackTopY = baselineY - totalStackHeight
							const tinyTotalHeight = tinySegments.reduce((sum, segment) => sum + segment.height, 0)
							const tinyOverlayHeight =
								tinySegments.length > 0
									? Math.max(MIN_STACK_SEGMENT_HOVER_HEIGHT, tinyTotalHeight)
									: 0
							const tinyOverlayPath =
								tinySegments.length > 0
									? getStackSegmentPath({
											x,
											y: stackTopY,
											width: MONTHLY_BAR_WIDTH,
											height: tinyOverlayHeight,
											radius: STACK_SEGMENT_RADIUS,
											roundTop: true,
											roundBottom: false,
										})
									: null
							return (
								<g key={month.monthStart.toISOString()}>
									{laidOutSegments.map((segment) => {
										const color = colorMap.get(segment.refType) ?? '#38bdf8'
										const segmentKey = `${month.monthStart.toISOString()}-${segment.refType}`
										const isHovered = hoveredSegment?.key === segmentKey
										const share = monthTotal > 0 ? (segment.value / monthTotal) * 100 : 0
										const visibleHeight = Math.max(1, segment.height)
										const segmentPath = getStackSegmentPath({
											x,
											y: segment.y,
											width: MONTHLY_BAR_WIDTH,
											height: visibleHeight,
											radius: STACK_SEGMENT_RADIUS,
											roundTop: segment.isTop,
											roundBottom: segment.isBottom,
										})
										const isTiny = segment.height < MIN_STACK_SEGMENT_HOVER_HEIGHT

										return (
											<g key={segmentKey}>
												<path
													d={segmentPath}
													fill={isHovered ? brightenHex(color) : color}
													stroke={isHovered ? hexToRgba(color, 0.55) : 'transparent'}
													strokeWidth={isHovered ? 1.5 : 0}
													pointerEvents={isTiny ? 'none' : 'auto'}
													style={{ cursor: isTiny ? 'auto' : 'default' }}
													onMouseEnter={
														isTiny
															? undefined
															: (event) =>
																	setHoveredSegment({
																		key: segmentKey,
																		x: event.clientX,
																		y: event.clientY,
																		color,
																		label: formatTaxRefTypeLabel(segment.refType),
																		value: segment.value,
																		share,
																	})
													}
													onMouseMove={
														isTiny
															? undefined
															: (event) =>
																	setHoveredSegment((current) =>
																		current?.key === segmentKey
																			? { ...current, x: event.clientX, y: event.clientY }
																			: {
																					key: segmentKey,
																					x: event.clientX,
																					y: event.clientY,
																					color,
																					label: formatTaxRefTypeLabel(segment.refType),
																					value: segment.value,
																					share,
																				}
																	)
													}
													onMouseLeave={
														isTiny
															? undefined
															: () =>
																	setHoveredSegment((current) =>
																		current?.key === segmentKey ? null : current
																	)
													}
													aria-label={`${formatTaxRefTypeLabel(segment.refType)} ${share.toFixed(1)}%`}
													role="img"
												/>
											</g>
										)
									})}
									{tinyOverlayPath && tinyTotalValue > 0 ? (
										<path
											d={tinyOverlayPath}
											fill="transparent"
											style={{ cursor: 'default' }}
											onMouseEnter={(event) =>
												setHoveredSegment({
													key: `${month.monthStart.toISOString()}-tiny`,
													x: event.clientX,
													y: event.clientY,
													color: '#94a3b8',
													label:
														tinySegments.length === 1
															? formatTaxRefTypeLabel(tinySegments[0]!.refType)
															: `Small sources (${tinySegments.length})`,
													value: tinyTotalValue,
													share: monthTotal > 0 ? (tinyTotalValue / monthTotal) * 100 : 0,
													details: tinySegments.map((tiny) => ({
														color: colorMap.get(tiny.refType) ?? '#38bdf8',
														label: formatTaxRefTypeLabel(tiny.refType),
														value: tiny.value,
														share: monthTotal > 0 ? (tiny.value / monthTotal) * 100 : 0,
													})),
												})
											}
											onMouseMove={(event) =>
												setHoveredSegment((current) =>
													current?.key === `${month.monthStart.toISOString()}-tiny`
														? { ...current, x: event.clientX, y: event.clientY }
														: current
												)
											}
											onMouseLeave={() =>
												setHoveredSegment((current) =>
													current?.key === `${month.monthStart.toISOString()}-tiny` ? null : current
												)
											}
											aria-label={`Small sources ${(monthTotal > 0
												? (tinyTotalValue / monthTotal) * 100
												: 0
											).toFixed(1)}%`}
											role="img"
										/>
									) : null}
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
				{hoveredSegment ? (
					<div
						className="pointer-events-none fixed z-50 min-w-[170px] rounded-md border border-border dropdown-surface px-3 py-2"
						style={{
							left: hoveredSegment.x,
							top: hoveredSegment.y - 12,
							transform: 'translate(-50%, -100%)',
						}}
					>
						<div className="flex items-center gap-2 text-xs font-medium">
							<span
								className="inline-block h-2 w-2 rounded-full"
								style={{ backgroundColor: hoveredSegment.color }}
							/>
							<span>{hoveredSegment.label}</span>
						</div>
						{hoveredSegment.details && hoveredSegment.details.length > 0 ? (
							<div className="mt-1 space-y-1 text-xs text-muted-foreground">
								{hoveredSegment.details.map((detail) => (
									<div
										key={`${hoveredSegment.key}:${detail.label}`}
										className="flex items-center gap-2"
									>
										<span
											className="inline-block h-2 w-2 rounded-full"
											style={{ backgroundColor: detail.color }}
										/>
										<span>
											{detail.label}: {formatTaxIskCompact(detail.value)} ({detail.share.toFixed(1)}
											%)
										</span>
									</div>
								))}
							</div>
						) : (
							<div className="text-xs text-muted-foreground">
								{formatTaxIskCompact(hoveredSegment.value)} ({hoveredSegment.share.toFixed(1)}%)
							</div>
						)}
					</div>
				) : null}
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
