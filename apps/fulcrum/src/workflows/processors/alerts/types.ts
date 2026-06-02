/**
 * Alert types for Fulcrum character reports
 */

import type { ReportSectionName } from '@repo/fulcrum'

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'

export type AlertType =
    | 'sp-plausibility'
    | 'ship-name-crossmatch'
    | 'plex-injector-trading'
    | 'large-isk-transfer'
    | 'data-fetch-failure'
    | 'corp-hopper'
    | 'blacklist-association'
    | 'ip-blacklist-association'
    | 'legacy-additional-associations'
    | 'legacy-blacklist-association'

export interface ReportAlert {
    id: string
    type: AlertType
    severity: AlertSeverity
    title: string
    description: string
    details: Record<string, unknown>
    surfaceSections?: ReportSectionName[]
}

export interface ReportAlerts {
    alerts: ReportAlert[]
    generatedAt: string
}
