import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { useTaxAssessments } from '@/hooks/corporation-tax'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, TaxEntityDisplay } from '@/lib/tax-display'

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
				header: 'Scope',
				sortable: true,
				cell: (row: TaxAssessment) => row.assessmentScope,
			},
			{
				id: 'scopeId',
				header: 'Scope ID',
				sortable: true,
				cell: (row: TaxAssessment) =>
					row.assessmentScope === 'division' ? (
						row.scopeId
					) : (
						<TaxEntityDisplay entityId={row.scopeId} entityNames={entityNames} />
					),
			},
			{ id: 'status', header: 'Status', sortable: true, cell: (row: TaxAssessment) => row.status },
			{
				id: 'taxDue',
				header: 'Tax Due',
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxDelta',
				header: 'Delta',
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'taxPeriodEnd',
				header: 'Period End',
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodEnd),
			},
		],
		[entityNames]
	)

	if (!effectiveCorporationId) {
		return (
			<div className="py-8 text-sm text-muted-foreground">
				Select a corporation to view scoped assessments.
			</div>
		)
	}

	return (
		<TaxReportTable
			columns={columns}
			rows={assessments}
			loading={isLoading}
			error={error}
			emptyMessage="No assessments found for the selected corporation."
			pagination={grid.pagination}
			onPaginationChange={grid.onPaginationChange}
			rowCount={data?.totalRows ?? 0}
			itemLabel="assessments"
			sorting={grid.sorting}
			onSortingChange={grid.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
