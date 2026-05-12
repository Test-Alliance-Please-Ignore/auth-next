/**
 * Alert types for Fulcrum character reports
 */

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

export interface ReportAlert {
    id: string
    type: AlertType
    severity: AlertSeverity
    title: string
    description: string
    details: Record<string, unknown>
}

export interface ReportAlerts {
    alerts: ReportAlert[]
    generatedAt: string
}
