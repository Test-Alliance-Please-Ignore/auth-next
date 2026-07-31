import { ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { Button } from '@/components/ui/button'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { typeIconUrl } from '@/lib/eve-images'

import {
	REFRESH_COOLDOWN_MS,
	persistRefreshCooldownUntilMs,
	readRefreshCooldownUntilMs,
} from '../state/refresh-cooldown'
import { getKillmailUrl } from '../utils'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { LossWithSRPStatus, RecentLossRefreshStatusRecord, SRPConfigResponse } from '../types'

interface LossTableProps {
	losses: LossWithSRPStatus[]
	isLoading?: boolean
	config?: SRPConfigResponse | null
	onDismissLoss?: (killmailId: string) => Promise<void> | void
	dismissingKillmailId?: string | null
}

interface RecentLossesStatusAlertsProps {
	refreshStatus?: RecentLossRefreshStatusRecord | null
	refreshErrorMessage?: string | null
	loadFailures?: Array<{
		characterId: string
		characterName: string
		reason?: 'invalid_token' | 'cache_missing' | 'cache_incomplete' | 'fetch_failed'
		message?: string
		error?: string
	}>
}

export function LossTable({
	losses,
	isLoading,
	config,
	onDismissLoss,
	dismissingKillmailId,
}: LossTableProps) {
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const maxLossAgeDays = config?.maxLossAgeDays ?? 30

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
			{confirmationDialog}

			{losses.length === 0 ? (
				<div className="rounded-lg border border-dashed p-8 text-center">
					<p className="text-sm text-muted-foreground">
						{`No requestable losses found in the last ${maxLossAgeDays} days.`}
					</p>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-16" />
								<TableHead>Ship</TableHead>
								<TableHead>Character</TableHead>
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
											<div className="h-10 w-10 overflow-hidden rounded border border-border/50">
												<img
													src={typeIconUrl(loss.shipTypeId, 64)}
													alt={loss.shipTypeName || `Ship ${loss.shipTypeId}`}
													className="h-full w-full object-contain"
													loading="lazy"
												/>
											</div>
										</TableCell>
										<TableCell className="font-semibold">
											{loss.hasSRPRequest && loss.srpRequestId ? (
												<Link
													to={`/srp/request/${loss.srpRequestId}`}
													className="underline-offset-4 hover:underline focus-visible:underline"
												>
													{loss.shipTypeName || `Ship ${loss.shipTypeId}`}
												</Link>
											) : isTooOld ? (
												loss.shipTypeName || `Ship ${loss.shipTypeId}`
											) : (
												<Link
													to={`/srp/create?killmailId=${loss.killmailId}&killmailHash=${loss.killmailHash}`}
													className="underline-offset-4 hover:underline focus-visible:underline"
												>
													{loss.shipTypeName || `Ship ${loss.shipTypeId}`}
												</Link>
											)}
										</TableCell>
										<TableCell className="text-sm font-medium">
											{loss.victimCharacterName || loss.victimCharacterId || '—'}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											<EveTimeDisplay
												dateStr={loss.killmailTime}
												format="compact"
												className="whitespace-nowrap text-sm text-muted-foreground"
											/>
										</TableCell>
										<TableCell className="text-sm font-medium">
											<div>{loss.solarSystemName || loss.solarSystemId}</div>
											{loss.solarSystemRegionName ? (
												<div className="text-xs text-muted-foreground">
													{loss.solarSystemRegionName}
												</div>
											) : null}
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
													<div className="flex items-center gap-2">
														<Button size="sm" asChild>
															<Link
																to={`/srp/create?killmailId=${loss.killmailId}&killmailHash=${loss.killmailHash}`}
															>
																Request SRP
															</Link>
														</Button>
														<Button
															variant="ghost"
															size="sm"
															disabled={
																!onDismissLoss || dismissingKillmailId === loss.killmailId
															}
															onClick={() => {
																if (!onDismissLoss) return
																requestConfirmation({
																	title: 'Dismiss This Loss?',
																	description:
																		'This will remove the loss from your recent losses list and cannot be undone.',
																	confirmLabel: 'Dismiss Loss',
																	intent: 'destructive',
																	onConfirm: async () => {
																		await onDismissLoss(loss.killmailId)
																	},
																})
															}}
														>
															{dismissingKillmailId === loss.killmailId
																? 'Dismissing…'
																: 'Dismiss'}
														</Button>
													</div>
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

export function RecentLossesStatusAlerts({
	refreshStatus,
	refreshErrorMessage,
	loadFailures,
}: RecentLossesStatusAlertsProps) {
	const actionableLoadFailures =
		loadFailures?.filter((failure) => failure.reason === 'invalid_token' || failure.reason === 'fetch_failed') ?? []
	const hasLoadFailures = actionableLoadFailures.length > 0
	const isWorkflowRefreshing =
		refreshStatus?.status === 'queued' || refreshStatus?.status === 'running'

	if (!isWorkflowRefreshing && !refreshStatus && !refreshErrorMessage && !hasLoadFailures) {
		return null
	}

	const warningBanner = isWorkflowRefreshing
		? null
		: refreshStatus?.status === 'failed'
			? {
					title: 'Recent loss refresh failed',
					body: refreshStatus?.lastError ?? refreshErrorMessage ?? 'Unknown error',
					className: 'border-red-500/40 bg-red-500/10 text-red-400',
				}
			: refreshErrorMessage
				? {
						title: 'Recent loss refresh failed',
						body: refreshErrorMessage,
						className: 'border-red-500/40 bg-red-500/10 text-red-400',
					}
				: hasLoadFailures
					? {
							title: 'Some character losses could not be fetched',
							body: actionableLoadFailures,
							className: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
						}
					: null

	return (
		<div className="space-y-3">
			{isWorkflowRefreshing ? (
				<div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-400">
					<p className="mb-1 font-medium">
						Refreshing recent losses for {refreshStatus?.processedCharacters ?? 0}/{refreshStatus?.totalCharacters ?? 0}{' '}
						characters
					</p>
					<p className="text-xs text-muted-foreground">
						{refreshStatus?.currentCharacterName
							? `Currently fetching ${refreshStatus.currentCharacterName}.`
							: 'Starting background refresh workflow.'}
					</p>
				</div>
			) : null}

			{refreshStatus?.status === 'completed' ? (
				<div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
					<p className="mb-1 font-medium">Recent losses refreshed</p>
					<p className="text-xs text-muted-foreground">
						{refreshStatus?.successfulCharacters ?? 0} characters refreshed, {refreshStatus?.failedCharacters ?? 0}{' '}
						characters reported warnings.
					</p>
				</div>
			) : null}

			{warningBanner ? (
				<div className={`rounded-md border px-4 py-3 text-sm ${warningBanner.className}`}>
					<p className="mb-1 font-medium">{warningBanner.title}</p>
					{Array.isArray(warningBanner.body) ? (
						<ul className="space-y-0.5">
							{warningBanner.body.map((failure) => (
								<li key={failure.characterId} className="flex items-center gap-2 text-xs text-muted-foreground">
									<span className="font-medium text-foreground">{failure.characterName}</span>
									{failure.message
										? `— ${failure.message}`
										: failure.reason === 'invalid_token'
											? '— ESI token is invalid or expired. Please re-authenticate this character.'
												: '— Could not load losses right now. Please try again shortly.'}
								</li>
							))}
						</ul>
					) : (
						<p className="text-xs text-muted-foreground">{warningBanner.body}</p>
					)}
				</div>
			) : null}
		</div>
	)
}

interface RecentLossRefreshButtonProps {
	isRefreshing?: boolean
	refreshStatus?: RecentLossRefreshStatusRecord | null
	refreshCooldownUntil?: string | null
	onRefresh?: () => void
}

export function RecentLossRefreshButton({
	isRefreshing,
	refreshStatus,
	refreshCooldownUntil,
	onRefresh,
}: RecentLossRefreshButtonProps) {
	const [nowMs, setNowMs] = useState(() => Date.now())
	const [cooldownUntilMs, setCooldownUntilMs] = useState(() => {
		if (typeof window === 'undefined') return 0
		return readRefreshCooldownUntilMs(window.localStorage)
	})

	useEffect(() => {
		if (cooldownUntilMs <= Date.now()) return
		const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
		return () => window.clearInterval(intervalId)
	}, [cooldownUntilMs])

	useEffect(() => {
		if (typeof window === 'undefined') return
		persistRefreshCooldownUntilMs(window.localStorage, cooldownUntilMs)
	}, [cooldownUntilMs])

	useEffect(() => {
		if (!refreshCooldownUntil) return
		const serverCooldownUntilMs = Date.parse(refreshCooldownUntil)
		if (!Number.isFinite(serverCooldownUntilMs)) return
		setCooldownUntilMs((current) => {
			const next = Math.max(current, serverCooldownUntilMs)
			if (typeof window !== 'undefined') {
				persistRefreshCooldownUntilMs(window.localStorage, next)
			}
			return next
		})
	}, [refreshCooldownUntil])

	if (!onRefresh) return null

	const cooldownRemainingMs = Math.max(0, cooldownUntilMs - nowMs)
	const isCooldownActive = cooldownRemainingMs > 0
	const isWorkflowRefreshing =
		refreshStatus?.status === 'queued' || refreshStatus?.status === 'running'
	const refreshDisabled = Boolean(isRefreshing || isCooldownActive || isWorkflowRefreshing)
	const remainingSeconds = Math.ceil(cooldownRemainingMs / 1000)
	const remainingMinutesPart = String(Math.floor(remainingSeconds / 60)).padStart(2, '0')
	const remainingSecondsPart = String(remainingSeconds % 60).padStart(2, '0')

	const handleRefreshClick = () => {
		if (refreshDisabled) return
		const nextCooldownUntilMs = Date.now() + REFRESH_COOLDOWN_MS
		if (typeof window !== 'undefined') {
			// Persist immediately so a hard refresh right after click cannot bypass cooldown.
			persistRefreshCooldownUntilMs(window.localStorage, nextCooldownUntilMs)
		}
		setCooldownUntilMs(nextCooldownUntilMs)
		onRefresh()
	}

	return (
		<Button
			size="sm"
			className="whitespace-nowrap"
			onClick={handleRefreshClick}
			disabled={refreshDisabled}
			title={
				isCooldownActive
					? `Refresh available in ${remainingMinutesPart}:${remainingSecondsPart}`
					: isWorkflowRefreshing
						? 'Recent loss refresh is already in progress'
						: 'Refresh losses'
			}
		>
			<RefreshCw
				aria-hidden
				className={`mr-2 h-4 w-4 ${isRefreshing || isWorkflowRefreshing ? 'animate-spin' : ''}`}
			/>
			{isRefreshing
				? 'Starting…'
				: isWorkflowRefreshing
					? `Fetching… ${refreshStatus?.processedCharacters ?? 0}/${refreshStatus?.totalCharacters ?? 0}`
					: isCooldownActive
						? `Refresh in ${remainingMinutesPart}:${remainingSecondsPart}`
						: 'Refresh Losses'}
		</Button>
	)
}
