import { formatDistanceToNow } from 'date-fns'
import { Building2, Calendar } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface CorporationHistoryEntry {
	recordId: number
	corporationId: number
	corporationName?: string
	startDate: string
	isDeleted?: boolean
}

interface CharacterCorporationHistoryProps {
	history: CorporationHistoryEntry[]
}

export function CharacterCorporationHistory({ history }: CharacterCorporationHistoryProps) {
	// Sort history by start date (newest first)
	const sortedHistory = [...history].sort(
		(a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Corporation History</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{sortedHistory.length === 0 ? (
						<p className="text-sm text-muted-foreground">No corporation history available</p>
					) : (
						sortedHistory.slice(0, 5).map((entry) => (
							<div
								key={entry.recordId}
								className="flex items-start justify-between py-2 border-b last:border-0"
							>
								<div className="flex items-start gap-2">
									<Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
									<div>
										<p className="text-sm font-medium">
											{entry.corporationName ? (
												<span title={`Corporation ID: ${entry.corporationId}`}>
													{entry.corporationName}
												</span>
											) : (
												`Corporation #${entry.corporationId}`
											)}
											{entry.isDeleted && (
												<span className="text-xs text-red-500 ml-2">(Closed)</span>
											)}
										</p>
										<p className="text-xs text-muted-foreground flex items-center gap-1">
											<Calendar className="h-3 w-3" />
											Joined {formatDistanceToNow(new Date(entry.startDate), { addSuffix: true })}
										</p>
									</div>
								</div>
							</div>
						))
					)}
					{sortedHistory.length > 5 && (
						<p className="text-xs text-muted-foreground text-center">
							And {sortedHistory.length - 5} more...
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
