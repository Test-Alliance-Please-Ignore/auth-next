import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxAssessment } from '@repo/corporation-tax'

type ScopedAssessmentSnapshotCardProps = {
	effectiveCorporationId: string | null
	assessmentsLoading: boolean
	assessmentsError: unknown
	assessments: TaxAssessment[]
	entityNames: Record<string, string>
}

export function ScopedAssessmentSnapshotCard({
	effectiveCorporationId,
	assessmentsLoading,
	assessmentsError,
	assessments,
	entityNames,
}: ScopedAssessmentSnapshotCardProps) {
	const columns = useMemo<Array<MRT_ColumnDef<TaxAssessment>>>(
		() => [
			{
				accessorKey: 'assessmentScope',
				header: 'Scope',
				enableSorting: true,
			},
			{
				accessorKey: 'scopeId',
				header: 'Scope ID',
				enableSorting: true,
				Cell: ({ row }) => {
					if (row.original.assessmentScope === 'division') {
						return row.original.scopeId
					}
					return <TaxEntityDisplay entityId={row.original.scopeId} entityNames={entityNames} />
				},
			},
			{
				accessorKey: 'status',
				header: 'Status',
				enableSorting: true,
			},
			{
				id: 'taxDue',
				accessorFn: (row) => Number(row.taxDue),
				header: 'Tax Due',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			},
			{
				id: 'taxDelta',
				accessorFn: (row) => Number(row.taxDelta),
				header: 'Delta',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			},
			{
				id: 'taxPeriodEnd',
				accessorFn: (row) => new Date(row.taxPeriodEnd).getTime(),
				header: 'Period End',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDate(row.original.taxPeriodEnd),
			},
		],
		[entityNames]
	)

	const content = !effectiveCorporationId ? (
		<div className="py-8 text-sm text-muted-foreground">
			Select a corporation to view scoped assessments.
		</div>
	) : (
		<TaxReportDataGrid
			columns={columns}
			rows={assessments}
			loading={assessmentsLoading}
			error={assessmentsError}
			emptyMessage="No assessments found for the selected corporation."
		/>
	)

	return <div className="space-y-4">{content}</div>
}
