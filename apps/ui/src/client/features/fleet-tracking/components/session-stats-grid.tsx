import { Card, CardContent } from '@/components/ui/card'

interface StatBoxProps {
	label: string
	value: string | number
	sublabel?: string
}

function StatBox({ label, value, sublabel }: StatBoxProps) {
	return (
		<Card>
			<CardContent className="p-4">
				<div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
				<div className="text-2xl font-semibold mt-1">{value}</div>
				{sublabel && <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>}
			</CardContent>
		</Card>
	)
}

interface SessionStatsGridProps {
	stats: Array<{ label: string; value: string | number; sublabel?: string }>
}

export function SessionStatsGrid({ stats }: SessionStatsGridProps) {
	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
			{stats.map((s) => (
				<StatBox key={s.label} label={s.label} value={s.value} sublabel={s.sublabel} />
			))}
		</div>
	)
}
