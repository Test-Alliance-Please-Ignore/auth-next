/**
 * Alerts Banner - Displays character report alerts at the top of the Overview tab
 */

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import { useReportSectionData } from '../../hooks'

import type { BadgeProps } from '@/components/ui/badge'

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
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
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
    const [expanded, setExpanded] = useState(false)
    const hasDetails = alert.details && Object.keys(alert.details).length > 0

    return (
        <div
            role={hasDetails ? 'button' : undefined}
            tabIndex={hasDetails ? 0 : undefined}
            onClick={hasDetails ? () => setExpanded(!expanded) : undefined}
            onKeyDown={hasDetails ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } } : undefined}
            className={`border-l-4 ${SEVERITY_BORDER[alert.severity]} rounded-r-md bg-card px-4 py-3 ${hasDetails ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <Badge variant={SEVERITY_VARIANT[alert.severity]} className="text-[11px]">
                            {SEVERITY_LABEL[alert.severity]}
                        </Badge>
                        <span className="text-sm font-medium">{alert.title}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
                </div>
                {hasDetails && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {expanded ? 'Hide' : 'Details'}
                    </span>
                )}
            </div>

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
        default:
            return (
                <pre className="overflow-x-auto text-xs text-muted-foreground">
                    {JSON.stringify(alert.details, null, 2)}
                </pre>
            )
    }
}

function SpPlausibilityDetails({ details }: { details: Record<string, unknown> }) {
    const totalSp = details.totalSp as number | undefined
    const unallocatedSp = details.unallocatedSp as number | undefined
    const accountAgeYears = details.accountAgeYears as number | undefined
    const maxPlausibleSp = details.maxPlausibleSp as number | undefined
    const ratio = details.ratio as number | undefined

    return (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {totalSp != null && (
                <>
                    <span className="text-muted-foreground">Total SP</span>
                    <span>{totalSp.toLocaleString()}</span>
                </>
            )}
            {unallocatedSp != null && (
                <>
                    <span className="text-muted-foreground">Unallocated SP</span>
                    <span>{unallocatedSp.toLocaleString()}</span>
                </>
            )}
            {accountAgeYears != null && (
                <>
                    <span className="text-muted-foreground">Account Age</span>
                    <span>{accountAgeYears.toFixed(1)} years</span>
                </>
            )}
            {maxPlausibleSp != null && (
                <>
                    <span className="text-muted-foreground">Max Plausible SP</span>
                    <span>{maxPlausibleSp.toLocaleString()}</span>
                </>
            )}
            {ratio != null && (
                <>
                    <span className="text-muted-foreground">SP Ratio</span>
                    <span>{(ratio * 100).toFixed(0)}%</span>
                </>
            )}
        </div>
    )
}

function ShipNameDetails({ details }: { details: Record<string, unknown> }) {
    const matches = details.matches as Array<{
        shipType: string
        customName: string
        characterId?: number
    }> | undefined
    const excludedSiblingNames = details.excludedSiblingNames as string[] | undefined

    return (
        <div className="space-y-2 text-sm">
            {matches && matches.length > 0 && (
                <div>
                    <span className="text-muted-foreground">Matching Ships:</span>
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
                    Excluded alts: {excludedSiblingNames.join(', ')}
                </p>
            )}
        </div>
    )
}

function PlexInjectorDetails({ details }: { details: Record<string, unknown> }) {
    const items = details.items as Array<{
        typeName: string
        transactionCount: number
        contractCount: number
        totalIskVolume: number
        buyVolume: number
        sellVolume: number
    }> | undefined

    return (
        <div className="space-y-2 text-sm">
            {items?.map((item, i) => (
                <div key={i} className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <span className="col-span-2 font-medium">{item.typeName}</span>
                    <span className="text-muted-foreground">Transactions</span>
                    <span>{item.transactionCount}</span>
                    {item.contractCount > 0 && (
                        <>
                            <span className="text-muted-foreground">Contract Items</span>
                            <span>{item.contractCount}</span>
                        </>
                    )}
                    <span className="text-muted-foreground">Buy Volume</span>
                    <span>{formatIsk(item.buyVolume)}</span>
                    <span className="text-muted-foreground">Sell Volume</span>
                    <span>{formatIsk(item.sellVolume)}</span>
                </div>
            ))}
        </div>
    )
}

function DataFetchFailureDetails({ details }: { details: Record<string, unknown> }) {
    const failedSteps = details.failedSteps as string[] | undefined
    const errors = details.errors as string[] | undefined

    return (
        <div className="space-y-1 text-sm">
            {failedSteps && failedSteps.length > 0 && (
                <div>
                    <span className="text-muted-foreground">Failed steps:</span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {failedSteps.map((step, i) => (
                            <li key={step}>
                                <span className="font-mono text-xs">{step}</span>
                                {errors?.[i] && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        — {errors[i]}
                                    </span>
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
    const recentCorps = (details.recentCorps ?? details.lastFive) as Array<{
        corporationName: string
        durationDays: number
        isCurrent?: boolean
    }> | undefined

    if (!recentCorps || recentCorps.length === 0) return null

    return (
        <div className="space-y-2 text-sm">
            <span className="text-muted-foreground">Recent player corporations:</span>
            <div className="space-y-1">
                {recentCorps.map((corp, i) => (
                    <div key={i} className="flex items-center justify-between gap-4">
                        <span>
                            {corp.corporationName}
                            {corp.isCurrent && (
                                <span className="ml-2 text-xs text-muted-foreground">(current)</span>
                            )}
                        </span>
                        <span className={!corp.isCurrent && corp.durationDays < 30 ? 'font-medium text-yellow-400' : 'text-muted-foreground'}>
                            {corp.durationDays} days
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function BlacklistAssociationDetails({ details }: { details: Record<string, unknown> }) {
    const associations = details.associations as Array<{
        characterId: string
        characterName?: string
        matches: Array<{ source: string; detail: string }>
    }> | undefined

    if (!associations || associations.length === 0) return null

    const SOURCE_LABELS: Record<string, string> = {
        'wallet-journal': 'Wallet Journal',
        'wallet-transactions': 'Wallet Transactions',
        'contracts': 'Contracts',
        'contacts': 'Contacts',
        'mails': 'Mails',
        'ship-names': 'Ship Names',
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    /** Replace ISO 8601 timestamps in a string with "Mon DD, YYYY HH:MM" */
    const humanizeDates = (text: string): string =>
        text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, (iso) => {
            const d = new Date(iso)
            if (Number.isNaN(d.getTime())) return iso
            const hh = String(d.getUTCHours()).padStart(2, '0')
            const mm = String(d.getUTCMinutes()).padStart(2, '0')
            return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm}`
        })

    return (
        <div className="space-y-3 text-sm">
            {associations.map((assoc) => (
                <div key={assoc.characterId} className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-destructive">
                            {assoc.characterName ?? assoc.characterId}
                        </span>
                        {assoc.characterName && (
                            <span className="text-xs text-muted-foreground">
                                ({assoc.characterId})
                            </span>
                        )}
                        <Badge variant="destructive" className="text-[10px]">
                            {assoc.matches.length} hit{assoc.matches.length !== 1 ? 's' : ''}
                        </Badge>
                    </div>
                    <ul className="list-inside list-disc space-y-0.5 pl-1">
                        {assoc.matches.map((match, i) => (
                            <li key={i}>
                                <span className="text-xs font-medium">{SOURCE_LABELS[match.source] ?? match.source}</span>
                                <span className="text-xs text-muted-foreground"> — {humanizeDates(match.detail)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    )
}

function LargeIskTransferDetails({ details }: { details: Record<string, unknown> }) {
    const totalIncoming = details.totalIncoming as number | undefined
    const totalOutgoing = details.totalOutgoing as number | undefined
    const transfers = details.transfers as Array<{
        date: string
        amount: number
        otherPartyName: string
        refTypeLabel: string
        direction: 'incoming' | 'outgoing'
    }> | undefined

    return (
        <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {totalIncoming != null && totalIncoming > 0 && (
                    <>
                        <span className="text-muted-foreground">Total Incoming</span>
                        <span className="text-green-400">{formatIsk(totalIncoming)}</span>
                    </>
                )}
                {totalOutgoing != null && totalOutgoing > 0 && (
                    <>
                        <span className="text-muted-foreground">Total Outgoing</span>
                        <span className="text-red-400">{formatIsk(totalOutgoing)}</span>
                    </>
                )}
            </div>
            {transfers && transfers.length > 0 && (
                <div>
                    <span className="text-muted-foreground">Top transfers:</span>
                    <div className="mt-1 space-y-1">
                        {transfers.map((t, i) => (
                            <div key={i} className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <span className="font-medium">{t.otherPartyName}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        {t.refTypeLabel} · {new Date(t.date).toLocaleDateString()}
                                    </span>
                                </div>
                                <span className={`shrink-0 font-mono ${t.direction === 'incoming' ? 'text-green-400' : 'text-red-400'}`}>
                                    {t.direction === 'incoming' ? '+' : '-'}{formatIsk(t.amount)}
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
        return `${(value / 1_000_000_000).toFixed(1)}B ISK`
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(0)}M ISK`
    }
    return `${value.toLocaleString()} ISK`
}

// ============================================================================
// Main Banner Component
// ============================================================================

export function AlertsBanner({ reportId }: { reportId: string }) {
    const { data, isLoading } = useReportSectionData(reportId, 'alerts', true)

    if (isLoading || !data) return null

    const alertsData = data as ReportAlerts
    if (!alertsData.alerts || alertsData.alerts.length === 0) return null

    // Sort by severity
    const sorted = [...alertsData.alerts].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )

    const highestSeverity = sorted[0]?.severity ?? 'low'

    return (
        <Card className={highestSeverity === 'critical' || highestSeverity === 'high' ? 'border-destructive/50' : ''}>
            <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                        {sorted.length} Alert{sorted.length !== 1 ? 's' : ''}
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
