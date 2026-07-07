import { useState } from 'react'
import { ExternalLink } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatPoints } from '@/lib/format-utils'

import { CreateMarketDialog } from '../components/create-market-dialog'
import { useMarkets } from '../hooks'

import type { BadgeVariant } from '@/components/ui/badge'
import type { MarketStatus } from '../types'

const STATUS_VARIANT: Record<MarketStatus, BadgeVariant> = {
	draft: 'secondary',
	open: 'success',
	closed: 'warning',
	resolving: 'warning',
	resolved: 'default',
	voided: 'destructive',
}

export default function PredictionMarketMarkets() {
	usePageTitle('Admin - Prediction Markets')
	const [createOpen, setCreateOpen] = useState(false)
	const { data, isLoading, error } = useMarkets({ limit: 50 })

	const markets = data?.markets ?? []
	const guildId = data?.guildId ?? null

	const threadUrl = (threadId: string | null) =>
		threadId && guildId ? `https://discord.com/channels/${guildId}/${threadId}` : null

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Prediction Markets</h1>
					<p className="mt-1 text-muted-foreground">
						Create markets and post them to the predictions forum channel.
					</p>
				</div>
				<Button variant="primary" onClick={() => setCreateOpen(true)}>
					New market
				</Button>
			</div>

			{error ? (
				<p className="text-sm text-destructive">
					Failed to load markets: {(error as Error).message}
				</p>
			) : null}

			<div className="rounded-md border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Question</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Outcomes</TableHead>
							<TableHead>Pool</TableHead>
							<TableHead>Closes</TableHead>
							<TableHead>Forum</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground">
									Loading…
								</TableCell>
							</TableRow>
						) : markets.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center text-muted-foreground">
									No markets yet.
								</TableCell>
							</TableRow>
						) : (
							markets.map((m) => {
								const url = threadUrl(m.discordThreadId)
								return (
									<TableRow key={m.id}>
										<TableCell className="max-w-md truncate font-medium">{m.question}</TableCell>
										<TableCell>
											<Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
										</TableCell>
										<TableCell>{m.outcomeCount}</TableCell>
										<TableCell>{formatPoints(m.totalPool)}</TableCell>
										<TableCell>{new Date(m.closesAt).toLocaleString()}</TableCell>
										<TableCell>
											{url ? (
												<a
													href={url}
													target="_blank"
													rel="noreferrer"
													className="inline-flex items-center gap-1 text-primary hover:underline"
												>
													Open <ExternalLink className="h-3 w-3" />
												</a>
											) : (
												<span className="text-xs text-muted-foreground">
													{m.discordThreadId ? 'posted' : 'not posted'}
												</span>
											)}
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>

			<CreateMarketDialog open={createOpen} onOpenChange={setCreateOpen} />
		</div>
	)
}
