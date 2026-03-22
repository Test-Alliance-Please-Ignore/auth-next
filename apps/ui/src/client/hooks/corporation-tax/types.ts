import type {
	TaxRollupReportQueryFilters,
	TaxRollupReportQueryOptions,
} from '@/lib/tax-report-types'

export type { TaxRollupReportQueryFilters, TaxRollupReportQueryOptions }

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
