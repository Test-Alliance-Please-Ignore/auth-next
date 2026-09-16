import { Calendar } from 'lucide-react'

import { useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'
import { corporationLogoUrl } from '@/lib/eve-images'

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
	const { t } = useAppTranslation()

	// Sort history by start date (newest first)
	const sortedHistory = [...history].sort(
		(a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('characterpages.corporationHistory')}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{sortedHistory.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t('characterpages.noCorporationHistoryAvailable')}
						</p>
					) : (
						sortedHistory.slice(0, 5).map((entry) => (
							<div
								key={entry.recordId}
								className="flex items-start justify-between py-2 border-b last:border-0"
							>
								<div className="flex items-start gap-2">
									<img
										src={corporationLogoUrl(entry.corporationId, 32)}
										alt={
											entry.corporationName ||
											t('characterpages.corporationValue1', { value1: entry.corporationId })
										}
										className="h-6 w-6 rounded mt-0.5"
									/>
									<div>
										<p className="text-sm font-medium">
											{entry.corporationName ? (
												<span
													title={t('characterpages.corporationIdValue1', {
														value1: entry.corporationId,
													})}
												>
													{entry.corporationName}
												</span>
											) : (
												t('characterpages.corporationValue1', { value1: entry.corporationId })
											)}
											{entry.isDeleted && (
												<span className="text-xs text-red-500 ml-2">
													{t('characterpages.closed')}
												</span>
											)}
										</p>
										<p className="text-xs text-muted-foreground flex items-center gap-1">
											<Calendar className="h-3 w-3" />
											{t('characterpages.joined')}
											{formatDistanceToNow(new Date(entry.startDate), { addSuffix: true })}
										</p>
									</div>
								</div>
							</div>
						))
					)}
					{sortedHistory.length > 5 && (
						<p className="text-xs text-muted-foreground text-center">
							{t('characterpages.and')}
							{sortedHistory.length - 5}
							{t('characterpages.more')}
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}
