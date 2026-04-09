/**
 * Large ISK Transfer Alert
 *
 * Flags characters with large direct player-to-player ISK transfers in their
 * wallet journal. These can indicate RMT, hostile funding, or suspicious activity.
 *
 * Only checks ref types that represent direct player transfers (not NPC payments,
 * market transactions, insurance, bounties, etc.)
 *
 * Thresholds (largest single transfer):
 *   >= 500M  → low
 *   >= 2B    → medium
 *   >= 10B   → high
 *   >= 50B   → critical
 */

import { ALERT_THRESHOLDS } from '../../../config/alert-thresholds'

import type { ProcessedWalletJournalEntry } from '../helpers/wallet-journal'
import type { ReportAlert, AlertSeverity } from './types'

/** ESI ref_type values that represent direct player-to-player ISK transfers */
const PLAYER_TRANSFER_REF_TYPES = new Set([
    'player_donation',
    'player_trading',
    'corporation_account_withdrawal',
    'contract_price',
    'contract_reward',
    'contract_collateral',
])

/** Thresholds based on the largest single transfer amount (from shared config) */
const LOW_THRESHOLD = ALERT_THRESHOLDS.ISK_TRANSFER_NOTABLE
const MEDIUM_THRESHOLD = ALERT_THRESHOLDS.ISK_TRANSFER_LARGE
const HIGH_THRESHOLD = ALERT_THRESHOLDS.ISK_TRANSFER_VERY_LARGE
const CRITICAL_THRESHOLD = ALERT_THRESHOLDS.ISK_TRANSFER_EXTREME

interface TransferSummary {
    id: string
    date: string
    amount: number
    otherPartyName: string
    refType: string
    refTypeLabel: string
    direction: 'incoming' | 'outgoing'
}

function getSeverity(largestAmount: number): AlertSeverity | null {
    if (largestAmount >= CRITICAL_THRESHOLD) return 'critical'
    if (largestAmount >= HIGH_THRESHOLD) return 'high'
    if (largestAmount >= MEDIUM_THRESHOLD) return 'medium'
    if (largestAmount >= LOW_THRESHOLD) return 'low'
    return null
}

function formatIsk(value: number): string {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B ISK`
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M ISK`
    return `${value.toLocaleString()} ISK`
}

/**
 * Check for large direct ISK transfers between players.
 *
 * @param journal - Processed wallet journal entries
 */
export function checkLargeIskTransfer(
    journal: ProcessedWalletJournalEntry[],
): ReportAlert | null {
    const transfers: TransferSummary[] = []

    for (const entry of journal) {
        if (!PLAYER_TRANSFER_REF_TYPES.has(entry.ref_type)) continue

        const amount = entry.amountNumber
        if (Math.abs(amount) < LOW_THRESHOLD) continue

        const isIncoming = amount > 0
        const otherPartyName = isIncoming
            ? (entry.firstPartyName ?? 'Unknown')
            : (entry.secondPartyName ?? 'Unknown')

        transfers.push({
            id: entry.id,
            date: entry.date,
            amount: Math.abs(amount),
            otherPartyName,
            refType: entry.ref_type,
            refTypeLabel: entry.refTypeLabel,
            direction: isIncoming ? 'incoming' : 'outgoing',
        })
    }

    if (transfers.length === 0) return null

    // Sort by amount descending
    transfers.sort((a, b) => b.amount - a.amount)

    const largestAmount = transfers[0].amount
    const severity = getSeverity(largestAmount)
    if (!severity) return null

    const totalIncoming = transfers
        .filter((t) => t.direction === 'incoming')
        .reduce((sum, t) => sum + t.amount, 0)
    const totalOutgoing = transfers
        .filter((t) => t.direction === 'outgoing')
        .reduce((sum, t) => sum + t.amount, 0)

    return {
        id: 'large-isk-transfer',
        type: 'large-isk-transfer',
        severity,
        title: 'Large ISK Transfers Detected',
        description: `${transfers.length} large player-to-player transfer${transfers.length !== 1 ? 's' : ''} found. Largest: ${formatIsk(largestAmount)}.`,
        details: {
            transferCount: transfers.length,
            totalIncoming,
            totalOutgoing,
            largestAmount,
            transfers: transfers.slice(0, 10), // Top 10 by amount
        },
    }
}
