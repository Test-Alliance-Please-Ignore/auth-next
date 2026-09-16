/**
 * Corporation History Section
 */

import { Badge } from '@/components/ui/badge'
import { getActiveLocale, useAppTranslation } from '@/i18n'
import { corporationLogoUrl } from '@/lib/eve-images'

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
			src={corporationLogoUrl(corporationId, 32)}
			alt=""
			className="h-5 w-5 rounded"
			loading="lazy"
		/>
	)
}

export function CorpHistorySection({ data }: { data: ProcessedCorpHistoryEntry[] }) {
	const { t } = useAppTranslation()

	if (data.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">{t('hrpages.noCorporationHistoryAvailable')}</p>
		)
	}

	return (
		<div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/30">
			<table className="w-full caption-bottom text-sm">
				<thead className="sticky top-0 z-10 bg-card [&_tr]:border-b">
					<tr className="border-b">
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
							{t('hrpages.corporation')}
						</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
							{t('hrpages.joined')}
						</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
							{t('hrpages.duration')}
						</th>
						<th className="h-10 px-4 text-left align-middle text-sm font-medium text-muted-foreground">
							{t('hrpages.status')}
						</th>
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
							<td className="px-4 py-2 align-middle">
								{new Date(entry.start_date).toLocaleDateString(getActiveLocale())}
							</td>
							<td className="px-4 py-2 align-middle">{entry.duration || '-'}</td>
							<td className="px-4 py-2 align-middle">
								{i === 0 ? (
									<Badge variant="success">{t('hrpages.current2')}</Badge>
								) : entry.is_deleted ? (
									<Badge variant="destructive">{t('hrpages.closed')}</Badge>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
