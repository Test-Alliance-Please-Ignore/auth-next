export type TaxRollupReportQueryFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export type TaxRollupReportQueryOptions = TaxRollupReportQueryFilters & {
	enabled?: boolean
}
