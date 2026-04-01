/**
 * EVE-style Notifications Section
 *
 * Left sidebar with notification type folders, right split pane with notification list (top)
 * and content (bottom). Client-side filtering, search, and pagination at 50 per page.
 */

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessedNotification {
    is_read?: boolean
    notification_id?: string
    sender_id?: string
    sender_type?: 'character' | 'corporation' | 'alliance' | 'faction' | 'other'
    senderName?: string
    text?: string
    parsedText?: Record<string, string>
    timestamp?: string
    type?: string
}

interface EnrichedNotificationData {
    notifications: ProcessedNotification[]
    types: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50

// Human-readable labels for common EVE notification types
const TYPE_LABELS: Record<string, string> = {
    AllWarDeclaredMsg: 'War Declared',
    AllWarInvalidatedMsg: 'War Invalidated',
    AllWarRetractedMsg: 'War Retracted',
    AllWarSurrenderMsg: 'War Surrender',
    BillOutOfMoneyMsg: 'Bill - Out of Money',
    BillPaidCorpAllMsg: 'Bill Paid',
    BountyClaimMsg: 'Bounty Claim',
    CharAppAcceptMsg: 'Application Accepted',
    CharAppRejectMsg: 'Application Rejected',
    CharAppWithdrawMsg: 'Application Withdrawn',
    CharLeftCorpMsg: 'Left Corporation',
    CorpAllBillMsg: 'Corporation Bill',
    CorpAppNewMsg: 'New Corp Application',
    CorpAppRejectCustomMsg: 'Corp App Rejected',
    CorpBecameWarEligible: 'War Eligible',
    CorpKicked: 'Corp Kicked',
    CorpNewCEOMsg: 'New CEO',
    CorpNoLongerWarEligible: 'No Longer War Eligible',
    CorpTaxChangeMsg: 'Tax Rate Changed',
    CorpVoteCEORevokedMsg: 'CEO Vote Revoked',
    EntosisCaptureStarted: 'Entosis Capture Started',
    InsuranceExpirationMsg: 'Insurance Expired',
    InsuranceFirstShipMsg: 'First Ship Insurance',
    InsuranceIssuedMsg: 'Insurance Issued',
    InsurancePayoutMsg: 'Insurance Payout',
    JumpCloneDeleteMsg: 'Jump Clone Deleted',
    KillReportFinalBlow: 'Kill - Final Blow',
    KillReportVictim: 'Kill - Victim',
    MoonminingAutomaticFracture: 'Moon Mining Fracture',
    MoonminingExtractionCancelled: 'Moon Extraction Cancelled',
    MoonminingExtractionFinished: 'Moon Extraction Finished',
    MoonminingExtractionStarted: 'Moon Extraction Started',
    MoonminingLaserFired: 'Moon Laser Fired',
    OrbitalAttacked: 'Orbital Attacked',
    OrbitalReinforced: 'Orbital Reinforced',
    OwnershipTransferred: 'Ownership Transferred',
    SkyhookDeployed: 'Skyhook Deployed',
    SkyhookDestroyed: 'Skyhook Destroyed',
    SkyhookLostShields: 'Skyhook Lost Shields',
    SkyhookOnline: 'Skyhook Online',
    SkyhookUnderAttack: 'Skyhook Under Attack',
    SovAllClaimAquiredMsg: 'Sov Claim Acquired',
    SovAllClaimLostMsg: 'Sov Claim Lost',
    SovStructureDestroyed: 'Sov Structure Destroyed',
    SovStructureReinforced: 'Sov Structure Reinforced',
    StructureAnchoring: 'Structure Anchoring',
    StructureDestroyed: 'Structure Destroyed',
    StructureFuelAlert: 'Structure Fuel Alert',
    StructureLostArmor: 'Structure Lost Armor',
    StructureLostShields: 'Structure Lost Shields',
    StructureOnline: 'Structure Online',
    StructureServicesOffline: 'Structure Services Offline',
    StructureUnanchoring: 'Structure Unanchoring',
    StructureUnderAttack: 'Structure Under Attack',
    StructureWentHighPower: 'Structure High Power',
    StructureWentLowPower: 'Structure Low Power',
    TowerAlertMsg: 'POS Alert',
    TowerResourceAlertMsg: 'POS Resource Alert',
    WarAdopted: 'War Adopted',
    WarDeclared: 'War Declared',
    WarHQRemovedMsg: 'War HQ Removed',
    WarInherited: 'War Inherited',
    WarRetractedByConcord: 'War Retracted by CONCORD',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseData(raw: unknown): EnrichedNotificationData {
    const data = raw as EnrichedNotificationData
    return {
        notifications: data.notifications ?? [],
        types: data.types ?? [],
    }
}

function humanType(type?: string): string {
    if (!type) return 'Unknown'
    return TYPE_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim()
}

function formatShortDate(timestamp?: string): string {
    if (!timestamp) return ''
    const d = new Date(timestamp)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function searchNotifications(
    notifications: ProcessedNotification[],
    query: string,
): ProcessedNotification[] {
    const q = query.toLowerCase().trim()
    if (!q) return notifications
    return notifications.filter((n) => {
        if (n.senderName?.toLowerCase().includes(q)) return true
        if (n.type?.toLowerCase().includes(q)) return true
        if (humanType(n.type).toLowerCase().includes(q)) return true
        if (n.text?.toLowerCase().includes(q)) return true
        return false
    })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsSection({ data: raw }: { data: unknown }) {
    const { notifications, types } = useMemo(() => normaliseData(raw), [raw])

    const [activeType, setActiveType] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [page, setPage] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')

    // Count notifications per type
    const typeCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const n of notifications) {
            if (n.type) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
        }
        return counts
    }, [notifications])

    // Filter by type
    const typeFiltered = useMemo(() => {
        if (!activeType) return notifications
        return notifications.filter((n) => n.type === activeType)
    }, [notifications, activeType])

    // Filter by search
    const filtered = useMemo(
        () => searchNotifications(typeFiltered, searchQuery),
        [typeFiltered, searchQuery],
    )

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    const selectedNotification = useMemo(
        () =>
            selectedId
                ? notifications.find((n) => n.notification_id === selectedId)
                : null,
        [notifications, selectedId],
    )

    const selectType = (type: string | null) => {
        setActiveType(type)
        setPage(0)
        setSelectedId(null)
    }

    if (notifications.length === 0) {
        return <p className="text-sm text-muted-foreground">No notifications found.</p>
    }

    return (
        <div className="flex h-[700px] overflow-hidden rounded-lg border border-border bg-card/40">
            {/* ---- Left sidebar ---- */}
            <div className="flex w-52 shrink-0 flex-col border-r border-border bg-card/60">
                <div className="border-b border-border px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Types
                    </span>
                </div>
                <nav className="flex-1 overflow-y-auto py-1">
                    {/* All notifications */}
                    <button
                        onClick={() => selectType(null)}
                        className={cn(
                            'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors',
                            activeType === null
                                ? 'bg-primary/15 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                        )}
                    >
                        <span className="truncate">All Notifications</span>
                        <span className="ml-1 shrink-0 text-[10px] tabular-nums opacity-60">
                            {notifications.length}
                        </span>
                    </button>

                    {/* Per-type folders */}
                    {types.map((type) => (
                        <button
                            key={type}
                            onClick={() => selectType(type)}
                            className={cn(
                                'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors',
                                activeType === type
                                    ? 'bg-primary/15 text-primary font-medium'
                                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                            )}
                        >
                            <span className="truncate">{humanType(type)}</span>
                            <span className="ml-1 shrink-0 text-[10px] tabular-nums opacity-60">
                                {typeCounts.get(type) ?? 0}
                            </span>
                        </button>
                    ))}
                </nav>
                <div className="border-t border-border px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                        {notifications.length} total
                    </span>
                </div>
            </div>

            {/* ---- Right side: split pane ---- */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* ---- Notification list (top half) ---- */}
                <div className="flex h-[55%] shrink-0 flex-col border-b border-border">
                    {/* Header with search */}
                    <div className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-1.5">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setPage(0)
                            }}
                            placeholder="Search notifications..."
                            className="h-6 flex-1 rounded border border-border bg-background/50 px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                        />
                        <span className="shrink-0 text-xs text-muted-foreground">
                            {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
                        </span>
                        {totalPages > 1 && (
                            <div className="flex shrink-0 items-center gap-1.5 text-xs">
                                <button
                                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                                    disabled={page === 0}
                                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                    ‹ Prev
                                </button>
                                <span className="text-muted-foreground">
                                    {page + 1}/{totalPages}
                                </span>
                                <button
                                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                    Next ›
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Rows */}
                    <div className="flex-1 overflow-y-auto">
                        {pageItems.length === 0 ? (
                            <p className="px-3 py-4 text-xs text-muted-foreground">
                                {searchQuery
                                    ? 'No notifications match your search.'
                                    : 'No notifications of this type.'}
                            </p>
                        ) : (
                            pageItems.map((n) => {
                                const isSelected = n.notification_id === selectedId
                                return (
                                    <button
                                        key={n.notification_id ?? Math.random()}
                                        onClick={() =>
                                            setSelectedId(n.notification_id ?? null)
                                        }
                                        className={cn(
                                            'flex w-full items-start gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors',
                                            isSelected
                                                ? 'bg-primary/10'
                                                : 'hover:bg-muted/30',
                                        )}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span
                                                    className={cn(
                                                        'truncate text-xs',
                                                        isSelected
                                                            ? 'font-semibold text-primary'
                                                            : 'font-medium text-foreground',
                                                    )}
                                                >
                                                    {humanType(n.type)}
                                                </span>
                                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                                    {formatShortDate(n.timestamp)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                                                <span className="truncate">
                                                    From: {n.senderName || n.sender_type || 'Unknown'}
                                                </span>
                                            </div>
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* ---- Notification content (bottom half) ---- */}
                <div className="flex h-[45%] shrink-0 flex-col overflow-hidden">
                    {selectedNotification ? (
                        <>
                            <div className="border-b border-border bg-card/80 px-4 py-2">
                                <h3 className="text-sm font-semibold text-foreground">
                                    {humanType(selectedNotification.type)}
                                </h3>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span>
                                        From:{' '}
                                        <strong>
                                            {selectedNotification.senderName ||
                                                selectedNotification.sender_type ||
                                                'Unknown'}
                                        </strong>
                                    </span>
                                    <span className="ml-auto">
                                        {selectedNotification.timestamp
                                            ? new Date(
                                                selectedNotification.timestamp,
                                            ).toLocaleString()
                                            : ''}
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto px-4 py-3">
                                {selectedNotification.parsedText &&
                                    Object.keys(selectedNotification.parsedText).length > 0 ? (
                                    <table className="w-full text-xs">
                                        <tbody>
                                            {Object.entries(
                                                selectedNotification.parsedText,
                                            ).map(([key, value]) => (
                                                <tr
                                                    key={key}
                                                    className="border-b border-border/30"
                                                >
                                                    <td className="py-1 pr-3 font-medium text-muted-foreground align-top whitespace-nowrap">
                                                        {key}
                                                    </td>
                                                    <td className="py-1 text-foreground break-all">
                                                        {value || '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : selectedNotification.text ? (
                                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                                        {selectedNotification.text}
                                    </p>
                                ) : (
                                    <p className="text-xs text-muted-foreground italic">
                                        No content available.
                                    </p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <p className="text-xs text-muted-foreground">
                                Select a notification to view its content.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
