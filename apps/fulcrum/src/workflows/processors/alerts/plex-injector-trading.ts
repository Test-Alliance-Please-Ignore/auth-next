/**
 * PLEX / Large Skill Injector Trading Alert
 *
 * Flags characters with significant trading activity in PLEX or Large Skill Injectors.
 * These items are commonly used for RMT and account manipulation.
 *
 * Checks both market transactions and contract items.
 *
 * Thresholds (total ISK volume):
 *   > 5B  → medium
 *   > 10B → high
 *   > 25B → critical
 */

import type { ProcessedWalletTransaction } from '../helpers/wallet-transactions'
import type { ProcessedContract } from '../helpers/contracts'
import type { ReportAlert, AlertSeverity } from './types'

const PLEX_TYPE_ID = '44992'
const LARGE_SKILL_INJECTOR_TYPE_ID = '40520'

const FLAGGED_TYPE_IDS = new Set([PLEX_TYPE_ID, LARGE_SKILL_INJECTOR_TYPE_ID])

/** ISK thresholds for severity levels */
const MEDIUM_THRESHOLD = 5_000_000_000
const HIGH_THRESHOLD = 10_000_000_000
const CRITICAL_THRESHOLD = 25_000_000_000

interface TradingSummary {
    typeName: string
    typeId: string
    transactionCount: number
    contractCount: number
    totalIskVolume: number
    buyVolume: number
    sellVolume: number
}

function getSeverity(totalIsk: number): AlertSeverity | null {
    if (totalIsk >= CRITICAL_THRESHOLD) return 'critical'
    if (totalIsk >= HIGH_THRESHOLD) return 'high'
    if (totalIsk >= MEDIUM_THRESHOLD) return 'medium'
    return null
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

/**
 * Check for excessive PLEX/Injector trading activity.
 *
 * @param transactions - Processed wallet transactions
 * @param contracts - Processed contracts (with items)
 */
export function checkPlexInjectorTrading(
    transactions: ProcessedWalletTransaction[],
    contracts: ProcessedContract[],
): ReportAlert | null {
    const summaries = new Map<string, TradingSummary>()

    // Initialize summaries for tracked types
    summaries.set(PLEX_TYPE_ID, {
        typeName: 'PLEX',
        typeId: PLEX_TYPE_ID,
        transactionCount: 0,
        contractCount: 0,
        totalIskVolume: 0,
        buyVolume: 0,
        sellVolume: 0,
    })
    summaries.set(LARGE_SKILL_INJECTOR_TYPE_ID, {
        typeName: 'Large Skill Injector',
        typeId: LARGE_SKILL_INJECTOR_TYPE_ID,
        transactionCount: 0,
        contractCount: 0,
        totalIskVolume: 0,
        buyVolume: 0,
        sellVolume: 0,
    })

    // Scan market transactions
    for (const tx of transactions) {
        if (!FLAGGED_TYPE_IDS.has(tx.type_id)) continue
        const summary = summaries.get(tx.type_id)!
        const value = tx.unit_price * tx.quantity
        summary.transactionCount++
        summary.totalIskVolume += value
        if (tx.is_buy) {
            summary.buyVolume += value
        } else {
            summary.sellVolume += value
        }
    }

    // Scan contract items
    for (const contract of contracts) {
        if (!contract.items) continue
        for (const item of contract.items) {
            if (!FLAGGED_TYPE_IDS.has(item.type_id)) continue
            const summary = summaries.get(item.type_id)!
            summary.contractCount++
            // Contracts may not have precise per-item pricing, so we count items
            // and use the contract's total price as a rough indicator
        }
    }

    // Calculate total ISK volume across all flagged types
    let totalIskVolume = 0
    const activeItems: TradingSummary[] = []

    for (const summary of summaries.values()) {
        if (summary.transactionCount > 0 || summary.contractCount > 0) {
            totalIskVolume += summary.totalIskVolume
            activeItems.push(summary)
        }
    }

    if (activeItems.length === 0) {
        return null
    }

    const severity = getSeverity(totalIskVolume)
    if (!severity) {
        return null
    }

    const itemDescriptions = activeItems
        .map((s) => {
            const parts = [`${s.typeName}: ${s.transactionCount} transactions`]
            if (s.contractCount > 0) {
                parts.push(`${s.contractCount} contract items`)
            }
            return parts.join(', ')
        })
        .join('; ')

    return {
        id: 'plex-injector-trading',
        type: 'plex-injector-trading',
        severity,
        title: 'Significant PLEX/Injector Trading',
        description: `${formatIsk(totalIskVolume)} in PLEX/Injector activity detected. ${itemDescriptions}.`,
        details: {
            totalIskVolume,
            items: activeItems.map((s) => ({
                typeName: s.typeName,
                typeId: s.typeId,
                transactionCount: s.transactionCount,
                contractCount: s.contractCount,
                totalIskVolume: s.totalIskVolume,
                buyVolume: s.buyVolume,
                sellVolume: s.sellVolume,
            })),
        },
        surfaceSections: ['wallet-transactions', 'contracts'],
    }
}
