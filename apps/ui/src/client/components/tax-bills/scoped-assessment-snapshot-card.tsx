import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { useTaxAssessments } from '@/hooks/corporation-tax'
import { useAppTranslation } from '@/i18n'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxStatus, TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxAssessment } from '@repo/corporation-tax'

type ScopedAssessmentSnapshotCardProps = {
	effectiveCorporationId: string | null
	entityNames: Record<string, string>
	canView: boolean
}

export function ScopedAssessmentSnapshotCard({
	effectiveCorporationId,
	entityNames,
	canView,
}: ScopedAssessmentSnapshotCardProps) {
	const { t } = useAppTranslation()

	const grid = useReportGridState({
		defaultSortBy: 'taxPeriodEnd',
		defaultSortDir: 'desc',
		defaultPageSize: 25,
		resetOn: effectiveCorporationId,
	})
	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxAssessments(effectiveCorporationId ?? undefined, {
		limit: grid.limit,
		offset: grid.offset,
		sortBy: grid.sortBy as
			| 'taxPeriodEnd'
			| 'assessmentScope'
			| 'scopeId'
			| 'status'
			| 'taxDue'
			| 'taxDelta',
		sortDir: grid.sortDir,
		enabled: canView,
	})
	const assessments = data?.rows ?? []
	const columns = useMemo(
		() => [
			{
				id: 'assessmentScope',
				header: t('tax.scope'),
				sortable: true,
				cell: (row: TaxAssessment) => row.assessmentScope,
			},
			{
				id: 'scopeId',
				header: t('tax.scopeId'),
				sortable: true,
				cell: (row: TaxAssessment) =>
					row.assessmentScope === 'division' ? (
						row.scopeId
					) : (
						<TaxEntityDisplay entityId={row.scopeId} entityNames={entityNames} />
					),
			},
			{
				id: 'status',
				header: t('tax.status'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxStatus(row.status),
			},
			{
				id: 'taxDue',
				header: t('tax.taxDue'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxDelta',
				header: t('tax.delta'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'taxPeriodEnd',
				header: t('tax.periodEnd'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodEnd),
			},
		],
		[entityNames, t]
	)

	if (!effectiveCorporationId) {
		return (
			<div className="py-8 text-sm text-muted-foreground">
				{t('tax.selectACorporationToViewScopedAssessments')}
			</div>
		)
	}

	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={assessments}
			loading={isLoading}
			error={error}
			emptyMessage={t('tax.noAssessmentsFoundForTheSelectedCorporation')}
			pagination={grid.pagination}
			onPaginationChange={grid.onPaginationChange}
			rowCount={data?.totalRows ?? 0}
			itemLabel={t('tax.assessments')}
			sorting={grid.sorting}
			onSortingChange={grid.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
