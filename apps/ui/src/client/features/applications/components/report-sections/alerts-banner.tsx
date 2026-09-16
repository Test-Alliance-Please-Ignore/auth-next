import { ChevronDown } from 'lucide-react'
/**
 * Alerts Banner - Displays character report alerts at the top of Overview or a specific tab section
 */

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { useEntityNames } from '@/hooks/useEntityNames'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'

import { useReportSectionData } from '../../hooks'
import { renderBlacklistContextLine } from '../../utils/blacklist-context'
import { formatStandingLabel, getStandingColorClass } from '../../utils/standing'

import type { BadgeProps } from '@/components/ui/badge'
import type { ReportSectionName } from '../../api'

// ============================================================================
// Types (matching the backend ReportAlerts structure)
// ============================================================================

type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'

interface ReportAlert {
	id: string
	type: string
	severity: AlertSeverity
	title: string
	description: string
	details: Record<string, unknown>
	surfaceSections?: ReportSectionName[]
}

interface ReportAlerts {
	alerts: ReportAlert[]
	generatedAt: string
}

// ============================================================================
// Severity helpers
// ============================================================================

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
}

const SEVERITY_VARIANT: Record<AlertSeverity, BadgeProps['variant']> = {
	critical: 'destructive',
	high: 'destructive',
	medium: 'warning',
	low: 'secondary',
}

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
	get critical() {
		return i18n.t('hrpages.critical')
	},
	get high() {
		return i18n.t('hrpages.high')
	},
	get medium() {
		return i18n.t('hrpages.medium')
	},
	get low() {
		return i18n.t('hrpages.low')
	},
}

const SEVERITY_BORDER: Record<AlertSeverity, string> = {
	critical: 'border-l-destructive',
	high: 'border-l-destructive/70',
	medium: 'border-l-warning',
	low: 'border-l-muted-foreground',
}

// ============================================================================
// Alert Item
// ============================================================================

function AlertItem({ alert }: { alert: ReportAlert }) {
	const { t } = useAppTranslation()

	const [expanded, setExpanded] = useState(false)
	const hasDetails = alert.details && Object.keys(alert.details).length > 0

	return (
		<div className={`border-l-4 ${SEVERITY_BORDER[alert.severity]} rounded-r-md bg-card px-4 py-3`}>
			<button
				type="button"
				className="flex w-full cursor-pointer items-start justify-between gap-3 text-left"
				onClick={() => hasDetails && setExpanded((v) => !v)}
				aria-expanded={expanded}
				disabled={!hasDetails}
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<Badge variant={SEVERITY_VARIANT[alert.severity]} className="text-[11px]">
							{SEVERITY_LABEL[alert.severity]}
						</Badge>
						<span className="text-sm font-medium">{alert.title}</span>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
				</div>
				{hasDetails ? (
					<div className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
						<span>{expanded ? t('hrpages.hide') : t('hrpages.details')}</span>
						<ChevronDown
							className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
						/>
					</div>
				) : null}
			</button>

			{expanded && alert.details && (
				<div className="mt-3 border-t border-border pt-3">
					<AlertDetails alert={alert} />
				</div>
			)}
		</div>
	)
}

// ============================================================================
// Alert Details (type-specific rendering)
// ============================================================================

function AlertDetails({ alert }: { alert: ReportAlert }) {
	const { t } = useAppTranslation()

	switch (alert.type) {
		case 'sp-plausibility':
			return <SpPlausibilityDetails details={alert.details} />
		case 'ship-name-crossmatch':
			return <ShipNameDetails details={alert.details} />
		case 'plex-injector-trading':
			return <PlexInjectorDetails details={alert.details} />
		case 'large-isk-transfer':
			return <LargeIskTransferDetails details={alert.details} />
		case 'data-fetch-failure':
			return <DataFetchFailureDetails details={alert.details} />
		case 'corp-hopper':
			return <CorpHopperDetails details={alert.details} />
		case 'blacklist-association':
			return <BlacklistAssociationDetails details={alert.details} />
		case 'ip-blacklist-association':
			return <IpBlacklistAssociationDetails details={alert.details} />
		case 'legacy-additional-associations':
			return <LegacyAssociationDetails details={alert.details} alertType={alert.type} />
		case 'legacy-blacklist-association':
			return <LegacyAssociationDetails details={alert.details} alertType={alert.type} />
		default:
			return (
				<p className="text-xs text-muted-foreground">
					{t('hrpages.additionalDetailsAreNotDisplayed')}
				</p>
			)
	}
}

function LegacyAssociationDetails({
	details,
	alertType,
}: {
	details: Record<string, unknown>
	alertType: 'legacy-additional-associations' | 'legacy-blacklist-association'
}) {
	const { t } = useAppTranslation()

	const items = Array.isArray(details.items)
		? (details.items as Array<{
				id: string
				legacyAuthUserId: string
				status: string
				candidates?: {
					characters?: Array<{
						characterId: string
						characterName: string
						alreadyLinkedToModernUser?: boolean
						linkedToOtherUserId?: string | null
						isDeleted?: boolean
					}>
					notes?: Array<{ legacyNoteId: string }>
					ipAddressCount?: number
				}
				conflicts?: {
					blacklistSignals?: {
						hasAnyBlacklistSignal?: boolean
						matchedTargets?: Array<{
							targetType?: string
							targetValue?: string
							discoverySources?: string[]
						}>
					}
				}
			}>)
		: []

	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noAssociationItems')}</p>
	}

	return (
		<div className="space-y-2 text-sm">
			{items.map((item) => {
				const characterCount = item.candidates?.characters?.length ?? 0
				const characters = item.candidates?.characters ?? []
				const noteCount = item.candidates?.notes?.length ?? 0
				const ipAddressCount = item.candidates?.ipAddressCount ?? 0
				const hasBlacklistSignal = Boolean(item.conflicts?.blacklistSignals?.hasAnyBlacklistSignal)
				const matchedTargets =
					item.conflicts?.blacklistSignals?.matchedTargets?.filter(
						(
							target
						): target is { targetType: string; targetValue: string; discoverySources?: string[] } =>
							typeof target?.targetType === 'string' && typeof target?.targetValue === 'string'
					) ?? []
				return (
					<div key={item.id} className="rounded border p-2">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium">
								{t('hrpages.legacyUser')}
								{item.legacyAuthUserId}
							</span>
							<Badge variant="secondary">{item.status}</Badge>
							{hasBlacklistSignal ? (
								<Badge variant="destructive">{t('hrpages.blocklistAlert')}</Badge>
							) : null}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{characterCount}
							{t('hrpages.characterS')}
							{noteCount}
							{t('hrpages.noteS')}
							{ipAddressCount}
							{t('hrpages.ipAddressEs')}
						</div>
						{alertType === 'legacy-additional-associations' && characters.length > 0 ? (
							<div className="mt-2 space-y-1.5">
								<div className="text-xs font-semibold text-muted-foreground">
									{t('hrpages.associatedCharacters')}
								</div>
								{characters.map((character) => (
									<div
										key={`${item.id}:character:${character.characterId}`}
										className="rounded border border-border/70 bg-card/70 px-2 py-1.5"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium text-foreground">{character.characterName}</span>
											<span className="font-mono text-xs text-muted-foreground">
												({character.characterId})
											</span>
											{character.alreadyLinkedToModernUser ? (
												<Badge variant="success" className="text-[10px]">
													{t('hrpages.alreadyLinked')}
												</Badge>
											) : character.linkedToOtherUserId ? (
												<Badge variant="destructive" className="text-[10px]">
													{t('hrpages.linkedToOtherUser')}
												</Badge>
											) : character.isDeleted ? (
												<Badge variant="warning" className="text-[10px]">
													{t('hrpages.deleted')}
												</Badge>
											) : (
												<Badge variant="warning" className="text-[10px]">
													{t('hrpages.notLinked')}
												</Badge>
											)}
										</div>
									</div>
								))}
							</div>
						) : null}
						{alertType === 'legacy-blacklist-association' && matchedTargets.length > 0 ? (
							<div className="mt-2 space-y-1.5">
								<div className="text-xs font-semibold text-muted-foreground">
									{t('hrpages.matchedBlocklistItems')}
								</div>
								<LegacyBlacklistTargetList targets={matchedTargets} alertItemId={item.id} />
							</div>
						) : null}
					</div>
				)
			})}
		</div>
	)
}

function LegacyBlacklistTargetList({
	targets,
	alertItemId,
}: {
	targets: Array<{
		targetType: string
		targetValue: string
		discoverySources?: string[]
	}>
	alertItemId: string
}) {
	const lookupIds = useMemo(
		() =>
			[
				...new Set(
					targets
						.filter((target) =>
							['character_id', 'corporation_id', 'alliance_id'].includes(target.targetType)
						)
						.map((target) => target.targetValue)
						.filter(Boolean)
				),
			].sort(),
		[targets]
	)
	const { data: entityNames = {} } = useEntityNames(lookupIds, { enabled: lookupIds.length > 0 })

	return (
		<div className="space-y-1.5">
			{targets.map((target, index) => {
				const resolvedName = entityNames[target.targetValue]
				return (
					<div
						key={`${alertItemId}:${target.targetType}:${target.targetValue}:${index}`}
						className="rounded border border-border/70 bg-card/70 px-2 py-1.5"
					>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="ghost" className="text-[10px]">
								{target.targetType.replace(/_/g, ' ')}
							</Badge>
							<div className="min-w-0">
								<div className="break-all font-medium text-foreground">
									{resolvedName ?? target.targetValue}
								</div>
								{resolvedName ? (
									<div className="break-all font-mono text-[10px] text-muted-foreground">
										{target.targetValue}
									</div>
								) : null}
							</div>
							{(target.discoverySources ?? []).slice(0, 3).map((source) => (
								<Badge
									key={`${alertItemId}:${target.targetValue}:${source}`}
									variant="warning"
									className="text-[10px]"
								>
									{source.replace(/_/g, ' ')}
								</Badge>
							))}
						</div>
					</div>
				)
			})}
		</div>
	)
}

function IpBlacklistAssociationDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const matches = details.matches as
		| Array<{
				userId: string
				mainCharacterId: string
				mainCharacterName: string | null
				matchingIpHashes: string[]
		  }>
		| undefined

	if (!matches || matches.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noMatchingUsers')}</p>
	}

	return (
		<div className="space-y-2 text-sm">
			{matches.map((match) => (
				<div key={match.userId} className="rounded border p-2">
					<p className="font-medium">{match.mainCharacterName ?? match.mainCharacterId}</p>
					<p className="text-xs text-muted-foreground font-mono break-all">
						{match.matchingIpHashes.join(', ')}
					</p>
				</div>
			))}
		</div>
	)
}

function SpPlausibilityDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const totalSp = details.totalSp as number | undefined
	const unallocatedSp = details.unallocatedSp as number | undefined
	const accountAgeYears = details.accountAgeYears as number | undefined
	const maxPlausibleSp = details.maxPlausibleSp as number | undefined
	const ratio = details.ratio as number | undefined

	return (
		<div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
			{totalSp != null && (
				<>
					<span className="text-muted-foreground">{t('hrpages.totalSp')}</span>
					<span>{totalSp.toLocaleString(getActiveLocale())}</span>
				</>
			)}
			{unallocatedSp != null && (
				<>
					<span className="text-muted-foreground">{t('hrpages.unallocatedSp')}</span>
					<span>{unallocatedSp.toLocaleString(getActiveLocale())}</span>
				</>
			)}
			{accountAgeYears != null && (
				<>
					<span className="text-muted-foreground">{t('hrpages.accountAge')}</span>
					<span>
						{accountAgeYears.toFixed(1)}
						{t('hrpages.years')}
					</span>
				</>
			)}
			{maxPlausibleSp != null && (
				<>
					<span className="text-muted-foreground">{t('hrpages.maxPlausibleSp')}</span>
					<span>{maxPlausibleSp.toLocaleString(getActiveLocale())}</span>
				</>
			)}
			{ratio != null && (
				<>
					<span className="text-muted-foreground">{t('hrpages.spRatio')}</span>
					<span>{(ratio * 100).toFixed(0)}%</span>
				</>
			)}
		</div>
	)
}

function ShipNameDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const matches = details.matches as
		| Array<{
				shipType: string
				customName: string
				characterId?: number
		  }>
		| undefined
	const excludedSiblingNames = details.excludedSiblingNames as string[] | undefined

	return (
		<div className="space-y-2 text-sm">
			{matches && matches.length > 0 && (
				<div>
					<span className="text-muted-foreground">{t('hrpages.matchingShips')}</span>
					<ul className="mt-1 list-inside list-disc space-y-0.5">
						{matches.map((m, i) => (
							<li key={i}>
								<span className="font-medium">{m.customName}</span>
								<span className="text-muted-foreground"> — {m.shipType}</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{excludedSiblingNames && excludedSiblingNames.length > 0 && (
				<p className="text-xs text-muted-foreground">
					{t('hrpages.excludedAlts')}
					{excludedSiblingNames.join(', ')}
				</p>
			)}
		</div>
	)
}

function PlexInjectorDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const items = details.items as
		| Array<{
				typeName: string
				transactionCount: number
				contractCount: number
				totalIskVolume: number
				buyVolume: number
				sellVolume: number
		  }>
		| undefined

	return (
		<div className="space-y-2 text-sm">
			{items?.map((item, i) => (
				<div key={i} className="grid grid-cols-2 gap-x-6 gap-y-1">
					<span className="col-span-2 font-medium">{item.typeName}</span>
					<span className="text-muted-foreground">{t('hrpages.transactions')}</span>
					<span>{item.transactionCount}</span>
					{item.contractCount > 0 && (
						<>
							<span className="text-muted-foreground">{t('hrpages.contractItems')}</span>
							<span>{item.contractCount}</span>
						</>
					)}
					<span className="text-muted-foreground">{t('hrpages.buyVolume')}</span>
					<span>{formatIsk(item.buyVolume)}</span>
					<span className="text-muted-foreground">{t('hrpages.sellVolume')}</span>
					<span>{formatIsk(item.sellVolume)}</span>
				</div>
			))}
		</div>
	)
}

function DataFetchFailureDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const failedSteps = details.failedSteps as string[] | undefined
	const errors = details.errors as string[] | undefined

	return (
		<div className="space-y-1 text-sm">
			{failedSteps && failedSteps.length > 0 && (
				<div>
					<span className="text-muted-foreground">{t('hrpages.failedSteps')}</span>
					<ul className="mt-1 list-inside list-disc space-y-0.5">
						{failedSteps.map((step, i) => (
							<li key={step}>
								<span className="font-mono text-xs">{step}</span>
								{errors?.[i] && (
									<span className="ml-2 text-xs text-muted-foreground">— {errors[i]}</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	)
}

function CorpHopperDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const recentCorps = (details.recentCorps ?? details.lastFive) as
		| Array<{
				corporationName: string
				durationDays: number
				isCurrent?: boolean
		  }>
		| undefined

	if (!recentCorps || recentCorps.length === 0) return null

	return (
		<div className="space-y-2 text-sm">
			<span className="text-muted-foreground">{t('hrpages.recentPlayerCorporations')}</span>
			<div className="space-y-1">
				{recentCorps.map((corp, i) => (
					<div key={i} className="flex items-center justify-between gap-4">
						<span>
							{corp.corporationName}
							{corp.isCurrent && (
								<span className="ml-2 text-xs text-muted-foreground">{t('hrpages.current')}</span>
							)}
						</span>
						<span
							className={
								!corp.isCurrent && corp.durationDays < 30
									? 'font-medium text-yellow-400'
									: 'text-muted-foreground'
							}
						>
							{corp.durationDays}
							{t('hrpages.days')}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

function BlacklistAssociationDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const associations = details.associations as
		| Array<{
				characterId: string
				characterName?: string
				standing?: {
					value?: number
					label?: string
				}
				matches: Array<{ source: string; detail: string; occurredAt?: string }>
		  }>
		| undefined

	if (!associations || associations.length === 0) return null

	const SOURCE_LABELS: Record<string, string> = {
		'wallet-journal': t('hrpages.walletJournal'),
		'wallet-transactions': t('hrpages.walletTransactions'),
		contracts: t('hrpages.contracts'),
		contacts: t('hrpages.contacts'),
		mails: t('hrpages.mails'),
		'ship-names': t('hrpages.shipNames'),
	}

	return (
		<div className="space-y-3 text-sm">
			{associations.map((assoc) => (
				<div key={assoc.characterId} className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="font-medium text-destructive">
							{assoc.characterName ?? assoc.characterId}
						</span>
						{assoc.standing?.value != null ? (
							<span className={getStandingColorClass(assoc.standing.value)}>
								{assoc.standing.label ?? formatStandingLabel(assoc.standing.value)}
							</span>
						) : null}
						{assoc.characterName && (
							<span className="text-xs text-muted-foreground">({assoc.characterId})</span>
						)}
						<Badge variant="destructive" className="text-[10px]">
							{t('hrpages.hitCount', { count: assoc.matches.length })}
						</Badge>
					</div>
					<ul className="list-inside list-disc space-y-0.5 pl-1">
						{assoc.matches.map((match, i) => (
							<li key={i}>
								<span className="text-xs font-medium">
									{SOURCE_LABELS[match.source] ?? match.source}
								</span>
								<span className="text-xs text-muted-foreground">
									{' '}
									— {renderBlacklistContextLine(match.detail)}
								</span>
								{match.occurredAt ? (
									<span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
										<span>·</span>
										<EveTimeDisplay dateStr={match.occurredAt} format="compact" />
									</span>
								) : null}
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	)
}

function LargeIskTransferDetails({ details }: { details: Record<string, unknown> }) {
	const { t } = useAppTranslation()

	const totalIncoming = details.totalIncoming as number | undefined
	const totalOutgoing = details.totalOutgoing as number | undefined
	const transfers = details.transfers as
		| Array<{
				date: string
				amount: number
				otherPartyName: string
				refTypeLabel: string
				direction: 'incoming' | 'outgoing'
		  }>
		| undefined

	return (
		<div className="space-y-3 text-sm">
			<div className="grid grid-cols-2 gap-x-6 gap-y-1">
				{totalIncoming != null && totalIncoming > 0 && (
					<>
						<span className="text-muted-foreground">{t('hrpages.totalIncoming')}</span>
						<span className="text-green-400">{formatIsk(totalIncoming)}</span>
					</>
				)}
				{totalOutgoing != null && totalOutgoing > 0 && (
					<>
						<span className="text-muted-foreground">{t('hrpages.totalOutgoing')}</span>
						<span className="text-red-400">{formatIsk(totalOutgoing)}</span>
					</>
				)}
			</div>
			{transfers && transfers.length > 0 && (
				<div>
					<span className="text-muted-foreground">{t('hrpages.topTransfers')}</span>
					<div className="mt-1 space-y-1">
						{transfers.map((t, i) => (
							<div key={i} className="flex items-center justify-between gap-4">
								<div className="min-w-0">
									<span className="font-medium">{t.otherPartyName}</span>
									<span className="ml-2 text-xs text-muted-foreground inline-flex items-center gap-1">
										<span>{t.refTypeLabel} ·</span>
										<EveTimeDisplay dateStr={t.date} format="compact" />
									</span>
								</div>
								<span
									className={`shrink-0 font-mono ${t.direction === 'incoming' ? 'text-green-400' : 'text-red-400'}`}
								>
									{t.direction === 'incoming' ? '+' : '-'}
									{formatIsk(t.amount)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) {
		return i18n.t('hrpages.value1BIsk', { value1: (value / 1_000_000_000).toFixed(1) })
	}
	if (value >= 1_000_000) {
		return i18n.t('hrpages.value1MIsk', { value1: (value / 1_000_000).toFixed(0) })
	}
	return `${value.toLocaleString(getActiveLocale())} ISK`
}

// ============================================================================
// Main Banner Component
// ============================================================================

export function AlertsBanner({
	reportId,
	section,
}: {
	reportId: string
	section?: ReportSectionName
}) {
	const { t } = useAppTranslation()

	const { data, isLoading } = useReportSectionData(reportId, 'alerts', true)

	if (isLoading || !data) return null

	const alertsData = data as ReportAlerts
	if (!alertsData.alerts || alertsData.alerts.length === 0) return null

	const filtered = section
		? alertsData.alerts.filter((alert) => {
				const surfaces = alert.surfaceSections ?? []
				return surfaces.includes(section)
			})
		: alertsData.alerts

	if (filtered.length === 0) return null

	// Sort by severity
	const sorted = [...filtered].sort(
		(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
	)

	const highestSeverity = sorted[0]?.severity ?? 'low'

	return (
		<Card
			className={
				highestSeverity === 'critical' || highestSeverity === 'high' ? 'border-destructive/50' : ''
			}
		>
			<CardContent className="space-y-2 p-4">
				<div className="flex items-center gap-2">
					<span className="text-sm font-semibold">
						{t('hrpages.alertCount', { count: sorted.length })}
					</span>
				</div>
				<div className="space-y-2">
					{sorted.map((alert) => (
						<AlertItem key={alert.id} alert={alert} />
					))}
				</div>
			</CardContent>
		</Card>
	)
}
