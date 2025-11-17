export interface CorporationScanTarget {
	corporationId: string
	structureTypeFilter?: string[] | null
	minimumFuelHours: number
}

export interface StructureMonitorHealthSummary {
	structureId: string
	status: 'idle' | 'starting' | 'active' | 'degraded' | 'unresponsive' | 'disabled'
	lastHeartbeatAt?: string | null
	lastError?: string | null
}

