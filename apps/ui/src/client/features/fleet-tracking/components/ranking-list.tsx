import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface RankingListProps<T> {
	title: string
	items: T[]
	emptyText?: string
	renderItem: (item: T, index: number) => React.ReactNode
}

export function RankingList<T>({ title, items, emptyText, renderItem }: RankingListProps<T>) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{items.length === 0 ? (
					<div className="text-sm text-muted-foreground py-4">{emptyText ?? 'No data'}</div>
				) : (
					<ol className="space-y-2">
						{items.map((item, i) => (
							<li key={i} className="flex items-center gap-3 text-sm">
								<span className="text-muted-foreground font-mono w-6 text-right">{i + 1}.</span>
								<div className="flex-1 min-w-0">{renderItem(item, i)}</div>
							</li>
						))}
					</ol>
				)}
			</CardContent>
		</Card>
	)
}
