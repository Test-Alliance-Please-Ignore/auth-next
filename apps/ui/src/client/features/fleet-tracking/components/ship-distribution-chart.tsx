import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDuration } from '../utils/format'

interface ShipDistributionChartProps {
	title: string
	items: Array<{
		shipTypeId: number
		shipTypeName?: string | null
		totalMinutes: number
	}>
	emptyText?: string
}

export function ShipDistributionChart({ title, items, emptyText }: ShipDistributionChartProps) {
	const sorted = [...items].sort((a, b) => b.totalMinutes - a.totalMinutes)
	const max = Math.max(...sorted.map((i) => i.totalMinutes), 1)

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{sorted.length === 0 ? (
					<div className="text-sm text-muted-foreground py-4">{emptyText ?? 'No ship data'}</div>
				) : (
					<ul className="space-y-2">
						{sorted.map((row) => {
							const pct = (row.totalMinutes / max) * 100
							return (
								<li key={row.shipTypeId} className="text-sm">
									<div className="flex items-baseline justify-between gap-2">
										<span>{row.shipTypeName ?? `type #${row.shipTypeId}`}</span>
										<span className="text-muted-foreground text-xs">
											{formatDuration(row.totalMinutes * 60_000)}
										</span>
									</div>
									<div className="h-2 mt-1 bg-muted rounded">
										<div
											className="h-full bg-primary rounded"
											style={{ width: `${pct}%` }}
										/>
									</div>
								</li>
							)
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}
