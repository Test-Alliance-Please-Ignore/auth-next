import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTaxAssessments } from '@/hooks/corporation-tax'
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()

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
			{ id: 'assessment', header: t('tax.assessment'), cell: (row: TaxAssessment) => row.id },
			{
				id: 'taxDue',
				header: t('tax.taxDue'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPeriodStart',
				header: t('tax.periodStart'),
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodStart),
			},
			{
				id: 'taxPeriodEnd',
				header: t('tax.periodEnd'),
				sortable: true,
				cell: (row: TaxAssessment) => formatTaxDate(row.taxPeriodEnd),
			},
			{
				id: 'action',
				header: t('tax.action'),
				cell: (row: TaxAssessment) => (
					<div className="flex justify-end">
						<Button
							variant="primary"
							size="sm"
							disabled={!canIssue || createBillPending}
							onClick={() => onCreateBill(row.id)}
						>
							{createBillPending ? t('tax.creating') : t('tax.createBill')}
						</Button>
					</div>
				),
			},
		],
		[canIssue, createBillPending, onCreateBill, t]
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('tax.unbilledAssessments')}</CardTitle>
				<CardDescription>
					{t('tax.finalizedCorporationScopeAssessmentsWithoutALinkedBillCreateBills')}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{!effectiveCorporationId ? (
					<div className="py-8 text-sm text-muted-foreground">
						{t('tax.selectACorporationToViewUnbilledAssessments')}
					</div>
				) : (
					<DataTable
						variant="plain"
						errorMessage={t('tax.failedToLoadReport')}
						columns={columns}
						rows={rows}
						loading={isFetching}
						error={error}
						emptyMessage={t('tax.noUnbilledFinalizedAssessmentsFound')}
						pagination={grid.pagination}
						onPaginationChange={grid.onPaginationChange}
						rowCount={data?.totalRows ?? 0}
						itemLabel={t('tax.assessments')}
						sorting={grid.sorting}
						onSortingChange={grid.onSortingChange}
						getRowKey={(row) => row.id}
					/>
				)}
				{createBillError ? (
					<div className="mt-3 text-sm text-destructive">
						{createBillError instanceof Error
							? createBillError.message
							: t('tax.failedToCreateBill')}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
