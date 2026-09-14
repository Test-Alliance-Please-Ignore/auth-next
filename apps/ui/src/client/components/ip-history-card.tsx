import { AlertTriangle, ChevronDown, Link2, Users } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { formatNumber, useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { UserIpHistoryEntry } from '@/lib/api'

export function IpHistoryCard({
	title,
	entries,
	buildHashInspectionLink,
}: {
	title: string
	entries: UserIpHistoryEntry[]
	buildHashInspectionLink: (ipHash: string) => string
}) {
	const { t } = useAppTranslation()
	const prioritizedEntries = [...entries].sort((a, b) => {
		const interactiveA = a.distinctUserCount > 1 ? 1 : 0
		const interactiveB = b.distinctUserCount > 1 ? 1 : 0
		if (interactiveA !== interactiveB) return interactiveB - interactiveA
		return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
	})

	return (
		<Card>
			<details className="group">
				<summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
					<CardTitle className="flex items-center gap-2 text-base">
						<Link2 className="h-4 w-4" />
						{title} ({formatNumber(entries.length)})
					</CardTitle>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="group-open:hidden">{t('admin.users.account.expand')}</span>
						<span className="hidden group-open:inline">{t('admin.users.account.collapse')}</span>
						<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
					</div>
				</summary>
				<CardContent className={cn('space-y-3 pt-0')}>
					{prioritizedEntries.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t('admin.users.ip.empty')}</p>
					) : (
						<div className="space-y-2">
							{prioritizedEntries.map((entry) => (
								<div
									key={entry.ipAddressHash}
									className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
								>
									<div className="min-w-0">
										<p className="truncate font-mono text-xs">{entry.ipAddressHash}</p>
										<p className="text-xs text-muted-foreground">
											{t('admin.users.ip.observed', {
												first: formatRelativeTime(entry.firstSeenAt),
												last: formatRelativeTime(entry.lastSeenAt),
											})}
										</p>
										<p
											className={
												entry.distinctUserCount > 1
													? 'flex items-center gap-1 text-xs text-destructive'
													: 'text-xs text-muted-foreground'
											}
										>
											{entry.distinctUserCount > 1 ? <AlertTriangle className="h-3 w-3" /> : null}
											{t('admin.users.ip.additional', {
												count: Math.max(0, entry.distinctUserCount - 1),
											})}
										</p>
									</div>
									{entry.distinctUserCount > 1 && (
										<Button asChild variant="primary" size="sm">
											<Link to={buildHashInspectionLink(entry.ipAddressHash)}>
												<Users className="mr-1.5 h-3.5 w-3.5" />
												{t('admin.users.ip.showMatches')}
											</Link>
										</Button>
									)}
								</div>
							))}
						</div>
					)}
				</CardContent>
			</details>
		</Card>
	)
}
