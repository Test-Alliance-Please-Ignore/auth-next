import { useMemo } from 'react'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useAppTranslation } from '@/i18n'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxBillStatusReportRow } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function BillStatusReportGrid(props: {
	rows: TaxBillStatusReportRow[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
	canManage?: boolean
	onSyncBillStatus?: (assessmentId: string) => void
	onRetractBill?: (assessmentId: string) => void
	syncBillPending?: boolean
	retractBillPending?: boolean
}) {
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'billStatus',
				header: t('tax.billStatus'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => <BillStatusBadge status={row.billStatus} />,
			},
			{
				id: 'corporationId',
				header: t('tax.corporation'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'taxPeriodStart',
				header: t('tax.periodStart'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.taxPeriodStart),
			},
			{
				id: 'taxPeriodEnd',
				header: t('tax.periodEnd'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.taxPeriodEnd),
			},
			{
				id: 'issueDate',
				header: t('tax.issueDate'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.issueDate),
			},
			{
				id: 'dueDate',
				header: t('tax.dueDate'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.dueDate),
			},
			{
				id: 'taxDue',
				header: t('tax.taxDue'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: t('tax.taxPaid'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: t('tax.delta'),
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'actions',
				header: t('tax.actions'),
				className: 'text-right',
				headerClassName: 'text-right',
				cell: (row: TaxBillStatusReportRow) => {
					const canSync = row.billStatus === 'issued' || row.billStatus === 'overdue'
					const canRetract = canSync
					const busy = props.syncBillPending || props.retractBillPending
					if (!props.canManage) return <span className="text-xs text-muted-foreground">-</span>
					return (
						<div className="flex items-center justify-end gap-2">
							{canSync ? (
								<Button
									variant="primary"
									size="sm"
									disabled={Boolean(busy) || !props.onSyncBillStatus}
									onClick={() => props.onSyncBillStatus?.(row.assessmentId)}
								>
									{props.syncBillPending ? t('tax.syncing') : t('tax.sync')}
								</Button>
							) : null}
							{canRetract ? (
								<Button
									variant="destructive"
									size="sm"
									showIcon={false}
									disabled={Boolean(busy) || !props.onRetractBill}
									onClick={() => props.onRetractBill?.(row.assessmentId)}
								>
									{props.retractBillPending ? t('tax.retracting') : t('tax.retract')}
								</Button>
							) : null}
							{!canSync && !canRetract ? (
								<span className="text-xs text-muted-foreground">{t('tax.noActions')}</span>
							) : null}
						</div>
					)
				},
			},
		],
		[
			props.canManage,
			props.entityNames,
			props.onRetractBill,
			props.onSyncBillStatus,
			props.retractBillPending,
			props.syncBillPending,
			t,
		]
	)

	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={t('tax.noBillStatusRowsFound')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.bills')}
			getRowKey={(row) => row.assessmentId}
		/>
	)
}
