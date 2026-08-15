export type TaxRollupReportQueryFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	refTypes?: string[]
	incomeMode?: 'total' | 'assessed'
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export type TaxRollupReportQueryOptions = TaxRollupReportQueryFilters & {
	enabled?: boolean
}
