import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { EsiStatusBadge } from '@/components/esi-status-badge'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { allianceLogoUrl, corporationLogoUrl } from '@/lib/eve-images'
import { formatISKShort } from '@/lib/format-utils'
import { cn } from '@/lib/utils'
import { formatSkillPoints } from '@repo/eve-types'

interface CharacterSpWalletLineProps {
	skillPoints: number | null | undefined
	walletBalance: string | null | undefined
	isLoading?: boolean
	className?: string
}

interface CharacterIdentitySummaryProps {
	characterId?: string | number
	characterName: string
	hasAuthAccount?: boolean
	hasValidToken: boolean | null | undefined
	corporationId?: string | null
	corporationName?: string | null
	allianceId?: string | null
	allianceName?: string | null
	skillPoints?: number | null | undefined
	walletBalance?: string | null | undefined
	showMetrics?: boolean
	isMetricsLoading?: boolean
	portraitSize?: 'sm' | 'md' | 'lg' | 'xl' | 'auto'
	nameBadges?: ReactNode
	enableCopyName?: boolean
	isNameCopied?: boolean
	onCopyName?: () => void
	className?: string
}

function isNpcCorporation(corporationId: string | null | undefined): boolean {
	if (!corporationId) return false
	const parsed = Number(corporationId)
	if (!Number.isFinite(parsed)) return false
	const id = Math.trunc(parsed)
	return id >= 1_000_000 && id <= 1_999_999
}

function getNearestPortraitSize(height: number): 64 | 128 | 256 | 512 {
	if (height <= 64) return 64
	if (height <= 128) return 128
	if (height <= 256) return 256
	return 512
}

export function CharacterSpWalletLine({
	skillPoints,
	walletBalance,
	isLoading = false,
	className,
}: CharacterSpWalletLineProps) {
	if (isLoading) {
		return (
			<div className={cn('mt-1 flex items-center gap-2 text-sm text-muted-foreground', className)}>
				<Skeleton className="h-4 w-24" />
				<span>—</span>
				<Skeleton className="h-4 w-28" />
			</div>
		)
	}

	return (
		<p className={cn('mt-1 text-sm text-muted-foreground', className)}>
			<span className="font-mono font-semibold tabular-nums">
				{skillPoints != null ? formatSkillPoints(skillPoints) : 'SP unavailable'}
			</span>
			<span className="mx-2">—</span>
			<span className="font-mono font-semibold tabular-nums">
				{walletBalance != null ? formatISKShort(walletBalance) : 'Wallet unavailable'}
			</span>
		</p>
	)
}

export function CharacterIdentitySummary({
	characterId,
	characterName,
	hasAuthAccount = true,
	hasValidToken,
	corporationId,
	corporationName,
	allianceId,
	allianceName,
	skillPoints,
	walletBalance,
	showMetrics = true,
	isMetricsLoading = false,
	portraitSize = 'auto',
	nameBadges,
	enableCopyName = false,
	isNameCopied = false,
	onCopyName,
	className,
}: CharacterIdentitySummaryProps) {
	const npcCorp = isNpcCorporation(corporationId)
	const detailsRef = useRef<HTMLDivElement | null>(null)
	const [detailsHeight, setDetailsHeight] = useState<number | null>(null)
	const isAutoPortrait = portraitSize === 'auto'

	useLayoutEffect(() => {
		if (!isAutoPortrait) return
		const element = detailsRef.current
		if (!element) return

		const update = () => {
			const next = Math.ceil(element.getBoundingClientRect().height)
			setDetailsHeight((prev) => (prev === next ? prev : next))
		}

		update()
		const observer = new ResizeObserver(update)
		observer.observe(element)
		return () => observer.disconnect()
	}, [isAutoPortrait, showMetrics, isMetricsLoading, characterName, corporationName, allianceName, nameBadges, skillPoints, walletBalance])

	return (
		<div className={cn('flex min-w-0 items-start gap-3', className)}>
			<MemberAvatar
				characterId={characterId}
				characterName={characterName}
				size={portraitSize}
				imageSize={
					isAutoPortrait && detailsHeight != null
						? getNearestPortraitSize(detailsHeight)
						: undefined
				}
				style={
					isAutoPortrait && detailsHeight != null
						? {
							height: detailsHeight,
							width: detailsHeight,
						}
						: undefined
				}
			/>
			<div ref={detailsRef} className="min-w-0">
				<div className="flex items-center gap-2">
					{enableCopyName && onCopyName ? (
						<button
							type="button"
							onClick={(event) => {
								event.preventDefault()
								event.stopPropagation()
								onCopyName()
							}}
							className="truncate text-left text-lg font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm cursor-copy"
							aria-label={`Copy ${characterName} to clipboard`}
							title={isNameCopied ? 'Copied' : 'Copy character name'}
						>
							{characterName}
						</button>
					) : (
						<p className="truncate text-lg font-semibold text-foreground">{characterName}</p>
					)}
					{enableCopyName && onCopyName ? (
						<button
							type="button"
							onClick={(event) => {
								event.preventDefault()
								event.stopPropagation()
								onCopyName()
							}}
							className="inline-flex size-5 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-blue-500 hover:text-blue-400 cursor-copy"
							aria-label={`Copy ${characterName} to clipboard`}
							title={isNameCopied ? 'Copied' : 'Copy character name'}
						>
							{isNameCopied ? (
								<Check className="h-3.5 w-3.5 text-green-500" />
							) : (
								<Copy className="h-3.5 w-3.5 text-blue-500" />
							)}
						</button>
					) : null}
					<EsiStatusBadge
						hasAuthAccount={hasAuthAccount}
						hasValidToken={hasValidToken}
						className="text-[10px] px-1.5 py-0"
					/>
					{nameBadges}
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-2">
					{corporationId && corporationName ? (
						<div className="inline-flex items-center gap-1.5">
							<img
								src={corporationLogoUrl(corporationId, 32)}
								alt={`${corporationName} logo`}
								className="size-5 rounded-sm border border-border/60 object-cover"
								loading="lazy"
							/>
							<span
								className={
									npcCorp
										? 'truncate max-w-[220px] text-base text-muted-foreground'
										: 'truncate max-w-[220px] text-base text-white'
								}
							>
								{corporationName}
							</span>
							{npcCorp && (
								<Badge variant="ghost" className="h-5 px-1.5 text-[10px]">
									NPC Corp
								</Badge>
							)}
						</div>
					) : (
						<span className="text-xs text-muted-foreground">Corporation unknown</span>
					)}
					{allianceId && allianceName && (
						<div className="inline-flex items-center gap-1.5">
							<span className="text-muted-foreground">•</span>
							<img
								src={allianceLogoUrl(allianceId, 32)}
								alt={`${allianceName} logo`}
								className="size-5 rounded-sm border border-border/60 object-cover"
								loading="lazy"
							/>
							<span className="truncate max-w-[220px] text-base text-muted-foreground">
								{allianceName}
							</span>
						</div>
					)}
				</div>
				{showMetrics && (
					<CharacterSpWalletLine
						skillPoints={skillPoints}
						walletBalance={walletBalance}
						isLoading={isMetricsLoading}
					/>
				)}
			</div>
		</div>
	)
}
