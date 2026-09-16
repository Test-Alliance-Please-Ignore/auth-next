import { useState } from 'react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { i18n, useAppTranslation } from '@/i18n'

import { useLeaderboard } from '../hooks'
import { useMoonScanPermissions } from '../permissions'

import type { LeaderboardWindow } from '../types'

const WINDOWS: Array<{ value: LeaderboardWindow; label: string }> = [
	{
		value: 'all',
		get label() {
			return i18n.t('moonScan.allTime')
		},
	},
	{
		value: '30d',
		get label() {
			return i18n.t('moonScan.last30Days')
		},
	},
	{
		value: '7d',
		get label() {
			return i18n.t('moonScan.last7Days')
		},
	},
]

export default function LeaderboardPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('moonScan.moonScanLeaderboard'))

	const { canLeaderboard } = useMoonScanPermissions()

	const [window, setWindow] = useState<LeaderboardWindow>('all')
	const { data: entries, isLoading, error } = useLeaderboard(window, canLeaderboard)

	if (!canLeaderboard) {
		return (
			<Container>
				<PageHeader
					title={t('moonScan.scanLeaderboard')}
					description={t('moonScan.youDoNotHavePermissionToViewThisPage')}
				/>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={t('moonScan.scanLeaderboard')}
				description={t('moonScan.topContributorsRankedByVerifiedMoonScans')}
			/>

			<div className="mt-section">
				<Select
					value={window}
					onValueChange={(nextValue) => setWindow(nextValue as LeaderboardWindow)}
					options={WINDOWS.map((entry) => ({ value: entry.value, label: entry.label }))}
					className="w-44"
					inputClassName="h-9"
				/>
			</div>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					{t('moonScan.failedToLoadLeaderboard')}
				</div>
			)}

			<div className="mt-4 rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>{t('moonScan.character')}</TableHead>
							<TableHead className="text-right">{t('moonScan.verifiedScans')}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 10 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 3 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-20" />
											</TableCell>
										))}
									</TableRow>
								))
							: (entries ?? []).map((entry, idx) => (
									<TableRow key={entry.characterId}>
										<TableCell className="text-muted-foreground font-mono text-sm">
											{idx + 1}
										</TableCell>
										<TableCell className="font-medium">{entry.characterName}</TableCell>
										<TableCell className="text-right font-mono tabular-nums">
											{entry.scanCount}
										</TableCell>
									</TableRow>
								))}
						{!isLoading && entries?.length === 0 && (
							<TableRow>
								<TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
									{t('moonScan.noVerifiedScansForThisPeriod')}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</Container>
	)
}
