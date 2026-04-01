/**
 * Alert types for Fulcrum character reports
 */

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'

export type AlertType =
    | 'sp-plausibility'
    | 'ship-name-crossmatch'
    | 'plex-injector-trading'
    | 'data-fetch-failure'
    | 'corp-hopper'

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
