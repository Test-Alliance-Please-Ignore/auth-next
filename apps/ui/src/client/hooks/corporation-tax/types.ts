export type TaxReportQueryFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export type TaxReportQueryOptions = TaxReportQueryFilters & {
	enabled?: boolean
}

export type TaxCorporationScopeMode = 'admin' | 'auditor' | 'viewer'

export type TaxCorporationScopeRow = {
	corporationId: string
	included: boolean
	exclusionReason: string | null
	createdAt: Date
	updatedAt: Date
}

export type CorporationAccessRow = {
	corporationId: string
}
