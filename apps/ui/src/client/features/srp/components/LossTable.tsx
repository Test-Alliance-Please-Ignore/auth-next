import { RefreshCw } from 'lucide-react'
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

interface LossTableProps {
	losses: LossWithSRPStatus[]
	isLoading?: boolean
	isRefreshing?: boolean
	onRefresh?: () => void
	config?: SRPConfigResponse | null
}

export function LossTable({ losses, isLoading, isRefreshing, onRefresh, config }: LossTableProps) {
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
					<Button variant="secondary" size="sm" onClick={onRefresh} disabled={isRefreshing}>
						<RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
						{isRefreshing ? 'Refreshing…' : 'Refresh Losses'}
					</Button>
				</div>
			)}

			{losses.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<p className="text-sm text-muted-foreground">No recent losses found. Fly safe! o7</p>
				</div>
			) : (
				<div className="overflow-hidden rounded-lg border-2 border-primary/30 bg-card shadow-lg">
					<Table>
						<TableHeader>
							<TableRow className="border-b-2 border-primary/40 bg-primary/30 hover:bg-primary/30">
								<TableHead className="w-20 font-bold text-foreground"></TableHead>
								<TableHead className="font-bold text-foreground">Ship</TableHead>
								<TableHead className="text-right font-bold text-foreground">Value (ISK)</TableHead>
								<TableHead className="font-bold text-foreground">Date/Time</TableHead>
								<TableHead className="font-bold text-foreground">Location</TableHead>
								<TableHead className="font-bold text-foreground">SRP Status</TableHead>
								<TableHead className="text-right font-bold text-foreground">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{losses.map((loss, index) => {
								const lossAgeMs = Date.now() - new Date(loss.killmailTime).getTime()
								const lossAgeDays = lossAgeMs / (1000 * 60 * 60 * 24)
								const isTooOld = lossAgeDays > maxLossAgeDays

								return (
									<TableRow
										key={loss.killmailId}
										className="border-b border-border/50 transition-colors hover:bg-primary/15"
										style={{
											background: index % 2 === 0 ? 'hsl(var(--card))' : 'hsl(var(--muted) / 0.5)',
										}}
									>
										<TableCell className="w-20 py-2">
											<img
												src={typeIconUrl(loss.shipTypeId, 64)}
												alt={loss.shipTypeName || `Ship ${loss.shipTypeId}`}
												className="h-12 w-12 rounded-md border border-border/50 object-contain"
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
												<Button variant="ghost" size="sm" asChild>
													<a
														href={getKillmailUrl(loss.killmailId)}
														target="_blank"
														rel="noopener noreferrer"
													>
														View Killmail
													</a>
												</Button>
												{loss.hasSRPRequest && loss.srpRequestId ? (
													<Button variant="ghost" size="sm" asChild>
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
