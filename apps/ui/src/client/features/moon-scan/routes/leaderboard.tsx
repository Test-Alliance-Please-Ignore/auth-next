import { useState } from 'react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useLeaderboard } from '../hooks'

import type { LeaderboardWindow } from '../types'

const WINDOWS: { value: LeaderboardWindow; label: string }[] = [
	{ value: 'all', label: 'All time' },
	{ value: '30d', label: 'Last 30 days' },
	{ value: '7d', label: 'Last 7 days' },
]

export default function LeaderboardPage() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:moons:view')

	const [window, setWindow] = useState<LeaderboardWindow>('all')
	const { data: entries, isLoading, error } = useLeaderboard(window)

	if (!canView) {
		return (
			<Container>
				<PageHeader title="Scan Leaderboard" description="You do not have permission to view this page." />
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Scan Leaderboard"
				description="Top contributors ranked by verified moon scans"
			/>

			<div className="mt-section flex gap-2">
				{WINDOWS.map((w) => (
					<button
						key={w.value}
						onClick={() => setWindow(w.value)}
						className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
							window === w.value
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-card text-muted-foreground hover:text-foreground'
						}`}
					>
						{w.label}
					</button>
				))}
			</div>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load leaderboard
				</div>
			)}

			<div className="mt-4 rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-12">#</TableHead>
							<TableHead>Character</TableHead>
							<TableHead className="text-right">Verified Scans</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 10 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 3 }).map((__, j) => (
											<TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
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
									No verified scans for this period.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</Container>
	)
}
