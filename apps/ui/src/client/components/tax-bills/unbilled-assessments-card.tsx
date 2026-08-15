import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTaxAssessments } from '@/hooks/corporation-tax'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull } from '@/lib/tax-display'

import type { TaxAssessment } from '@repo/corporation-tax'

type UnbilledAssessmentsCardProps = {
	effectiveCorporationId: string | null
	canView: boolean
	canIssue: boolean
	createBillPending: boolean
	createBillError: unknown
	onCreateBill: (assessmentId: string) => void
}

export function UnbilledAssessmentsCard({
	effectiveCorporationId,
	canView,
	canIssue,
	createBillPending,
	createBillError,
	onCreateBill,
}: UnbilledAssessmentsCardProps) {
	const grid = useReportGridState({
		defaultSortBy: 'taxPeriodEnd',
		defaultSortDir: 'desc',
		defaultPageSize: 25,
		resetOn: effectiveCorporationId,
	})
	const { data, isFetching, error } = useTaxAssessments(effectiveCorporationId ?? undefined, {
		assessmentScope: 'corporation',
		unbilledOnly: true,
		limit: grid.limit,
		offset: grid.offset,
		sortBy: grid.sortBy as 'taxPeriodEnd' | 'taxDue' | 'taxDelta',
		sortDir: grid.sortDir,
		enabled: canView,
	})
	const rows = data?.rows ?? []
	const columns = useMemo(
		() => [
			{ id: 'assessment', header: 'Assessment', cell: (row: TaxAssessment) => row.id },
			{
				id: 'taxDue',
				header: 'Tax Due',
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPeriodStart',
				header: 'Period Start',
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodStart),
			},
			{
				id: 'taxPeriodEnd',
				header: 'Period End',
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodEnd),
			},
			{
				id: 'action',
				header: 'Action',
				cell: (row: TaxAssessment) => (
					<div className="flex justify-end">
						<Button
							variant="primary"
							size="sm"
							disabled={!canIssue || createBillPending}
							onClick={() => onCreateBill(row.id)}
						>
							{createBillPending ? 'Creating...' : 'Create Bill'}
						</Button>
					</div>
				),
			},
		],
		[canIssue, createBillPending, onCreateBill]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>Unbilled Assessments</CardTitle>
				<CardDescription>
					Finalized corporation-scope assessments without a linked bill. Create bills manually as
					needed.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{!effectiveCorporationId ? (
					<div className="py-8 text-sm text-muted-foreground">
						Select a corporation to view unbilled assessments.
					</div>
				) : (
					<TaxReportTable
						columns={columns}
						rows={rows}
						loading={isFetching}
						error={error}
						emptyMessage="No unbilled finalized assessments found."
						pagination={grid.pagination}
						onPaginationChange={grid.onPaginationChange}
						rowCount={data?.totalRows ?? 0}
						itemLabel="assessments"
						sorting={grid.sorting}
						onSortingChange={grid.onSortingChange}
						getRowKey={(row) => row.id}
					/>
				)}
				{createBillError ? (
					<div className="mt-3 text-sm text-destructive">
						{createBillError instanceof Error ? createBillError.message : 'Failed to create bill'}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
