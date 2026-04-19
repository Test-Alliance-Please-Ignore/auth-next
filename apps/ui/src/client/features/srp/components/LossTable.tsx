import { ExternalLink, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { typeIconUrl } from '@/lib/eve-images'

import { formatISK, formatRelativeTime, getKillmailUrl } from '../utils'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { LossWithSRPStatus, SRPConfigResponse } from '../types'

export interface CharacterRefreshResult {
	characterId: string
	characterName: string
	success: boolean
	reason?: 'invalid_token' | 'fetch_failed'
	error?: string
}

interface LossTableProps {
	losses: LossWithSRPStatus[]
	isLoading?: boolean
	isRefreshing?: boolean
	onRefresh?: () => void
	config?: SRPConfigResponse | null
	refreshResults?: CharacterRefreshResult[]
}

export function LossTable({ losses, isLoading, isRefreshing, onRefresh, config, refreshResults }: LossTableProps) {
	const maxLossAgeDays = config?.maxLossAgeDays ?? 60

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-center gap-3 rounded-lg border border-dashed p-8">
					<div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<p className="text-sm text-muted-foreground">Loading recent losses...</p>
				</div>
				<div className="space-y-2">
					{[...Array(3)].map((_, i) => (
						<div key={i} className="h-20 animate-pulse rounded-md bg-muted/30" />
					))}
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-3">
			{onRefresh && (
				<div className="flex justify-end">
					<Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
						<RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
						{isRefreshing ? 'Refreshing…' : 'Refresh Losses'}
					</Button>
				</div>
			)}

			{refreshResults && refreshResults.some((r) => !r.success) && (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
					<p className="mb-1 font-medium text-amber-400">Some characters could not be refreshed</p>
					<ul className="space-y-0.5">
						{refreshResults
							.filter((r) => !r.success)
							.map((r) => (
								<li key={r.characterId} className="flex items-center gap-2 text-xs text-muted-foreground">
									<span className="font-medium text-foreground">{r.characterName}</span>
									{r.reason === 'invalid_token'
										? '— token expired or invalid (re-auth required)'
										: r.error
											? `— ${r.error}`
											: '— fetch failed'}
								</li>
							))}
					</ul>
				</div>
			)}

			{losses.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<p className="text-sm text-muted-foreground">No recent losses found. Fly safe! o7</p>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-16" />
								<TableHead>Ship</TableHead>
								<TableHead className="text-right">Value (ISK)</TableHead>
								<TableHead>Date/Time</TableHead>
								<TableHead>Location</TableHead>
								<TableHead>SRP Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{losses.map((loss) => {
								const lossAgeMs = Date.now() - new Date(loss.killmailTime).getTime()
								const lossAgeDays = lossAgeMs / (1000 * 60 * 60 * 24)
								const isTooOld = lossAgeDays > maxLossAgeDays

								return (
									<TableRow key={loss.killmailId}>
										<TableCell className="py-2">
											<img
												src={typeIconUrl(loss.shipTypeId, 64)}
												alt={loss.shipTypeName || `Ship ${loss.shipTypeId}`}
												className="h-10 w-10 rounded border border-border/50 object-contain"
												loading="lazy"
											/>
										</TableCell>
										<TableCell className="font-semibold">
											{loss.shipTypeName || `Ship ${loss.shipTypeId}`}
										</TableCell>
										<TableCell className="text-right font-mono text-sm tabular-nums">
											{formatISK(loss.totalValue)}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{formatRelativeTime(loss.killmailTime)}
										</TableCell>
										<TableCell className="text-sm font-medium">
											{loss.solarSystemName || loss.solarSystemId}
										</TableCell>
										<TableCell>
											{loss.hasSRPRequest && loss.srpRequestStatus ? (
												<RequestStatusBadge status={loss.srpRequestStatus as any} />
											) : (
												<span className="inline-flex items-center rounded-md border border-border/50 bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
													No request
												</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-2">
												<Button variant="ghost" size="icon" className="h-8 w-8" asChild>
													<a
														href={getKillmailUrl(loss.killmailId)}
														target="_blank"
														rel="noopener noreferrer"
														title="View on zKillboard"
													>
														<ExternalLink className="h-4 w-4" />
													</a>
												</Button>
												{loss.hasSRPRequest && loss.srpRequestId ? (
													<Button variant="secondary" size="sm" asChild>
														<Link to={`/srp/request/${loss.srpRequestId}`}>View Request</Link>
													</Button>
												) : isTooOld ? (
													<span
														className="inline-flex items-center rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
														title={`Losses older than ${maxLossAgeDays} days are not eligible for SRP`}
													>
														Too old
													</span>
												) : (
													<Button size="sm" asChild>
														<Link
															to={`/srp/create?killmailId=${loss.killmailId}&killmailHash=${loss.killmailHash}`}
														>
															Request SRP
														</Link>
													</Button>
												)}
											</div>
										</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	)
}
