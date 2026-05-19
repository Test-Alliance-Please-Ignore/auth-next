import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FleetsPerDayChartProps {
	data: Array<{ day: string; count: number }>
}

export function FleetsPerDayChart({ data }: FleetsPerDayChartProps) {
	const max = Math.max(...data.map((d) => d.count), 1)
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Fleets per day</CardTitle>
			</CardHeader>
			<CardContent>
				{data.length === 0 ? (
					<div className="text-sm text-muted-foreground py-4">No fleets in this range.</div>
				) : (
					<div className="flex items-end gap-1 h-32">
						{data.map((d) => {
							const pct = (d.count / max) * 100
							return (
								<div
									key={d.day}
									className="flex-1 min-w-1 h-full flex flex-col justify-end"
									title={`${d.day}: ${d.count}`}
								>
									<div
										className="bg-primary rounded-t w-full"
										style={{ height: `${pct}%`, minHeight: d.count > 0 ? '2px' : '0' }}
									/>
								</div>
							)
						})}
					</div>
				)}
				<div className="flex justify-between text-xs text-muted-foreground mt-2">
					<span>{data[0]?.day}</span>
					<span>{data[data.length - 1]?.day}</span>
				</div>
			</CardContent>
		</Card>
	)
}