export type TaxRollupReportQueryFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	refTypes?: string[]
	incomeMode?: 'total' | 'assessed'
	walletSource?: 'corporation' | 'character'
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

export type TaxRollupReportQueryOptions = TaxRollupReportQueryFilters & {
	enabled?: boolean
}

export type TaxIncomeSourceControls = {
	refTypes: string[]
	incomeMode: 'total' | 'assessed'
	walletSource: 'corporation' | 'character'
}
