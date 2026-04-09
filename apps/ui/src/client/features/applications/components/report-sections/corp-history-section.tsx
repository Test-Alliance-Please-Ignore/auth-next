/**
 * Corporation History Section
 */

import { Badge } from '@/components/ui/badge'

interface ProcessedCorpHistoryEntry {
	corporation_id: string
	corporationName?: string
	start_date: string
	duration?: string
	is_deleted?: boolean
}

function CorpIcon({ corporationId }: { corporationId: string }) {
	return (
		<img
			src={`https://images.evetech.net/corporations/${corporationId}/logo?size=32`}
			alt=""
			className="h-5 w-5 rounded"
			loading="lazy"
		/>
	)
}

export function CorpHistorySection({ data }: { data: ProcessedCorpHistoryEntry[] }) {
	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No corporation history available.</p>
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/30">
			<table className="w-full caption-bottom text-sm">
				<thead className="sticky top-0 z-10 bg-card [&_tr]:border-b">
					<tr className="border-b">
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">Corporation</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">Joined</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">Duration</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody className="[&_tr:last-child]:border-0">
					{data.map((entry, i) => (
						<tr
							key={entry.corporation_id + '-' + entry.start_date}
							className="border-b transition-colors hover:bg-muted/50"
						>
							<td className="px-4 py-2 align-middle">
								<div className="flex items-center gap-2">
									<CorpIcon corporationId={entry.corporation_id} />
									<span className="font-medium">
										{entry.corporationName || entry.corporation_id}
									</span>
								</div>
							</td>
							<td className="px-4 py-2 align-middle">{new Date(entry.start_date).toLocaleDateString()}</td>
							<td className="px-4 py-2 align-middle">{entry.duration || '-'}</td>
							<td className="px-4 py-2 align-middle">
								{i === 0 ? (
									<Badge variant="success">Current</Badge>
								) : entry.is_deleted ? (
									<Badge variant="destructive">Closed</Badge>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
