import { BillStatusReportGrid } from '@/components/tax-reports/grids'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { useTaxBillStatusReport } from '@/hooks/corporation-tax'

type BillStatusTabProps = {
	effectiveCorporationId: string | null
	canView: boolean
	canIssue: boolean
	entityNames: Record<string, string>
	syncBillPending?: boolean
	retractBillPending?: boolean
	onSyncBillStatus?: (assessmentId: string) => void
	onRetractBill?: (assessmentId: string) => void
	syncBillError?: unknown
	retractBillError?: unknown
}

export function BillStatusTab({
	effectiveCorporationId,
	canView,
	canIssue,
	entityNames,
	syncBillPending,
	retractBillPending,
	onSyncBillStatus,
	onRetractBill,
	syncBillError,
	retractBillError,
}: BillStatusTabProps) {
	const grid = useReportGridState({
		defaultSortBy: 'dueDate',
		defaultSortDir: 'asc',
		defaultPageSize: 25,
		resetOn: { effectiveCorporationId },
	})
	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxBillStatusReport({
		corporationId: effectiveCorporationId ?? undefined,
		limit: grid.limit,
		offset: grid.offset,
		sortBy: grid.sortBy,
		sortDir: grid.sortDir,
		enabled: canView,
	})

	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0

	return (
		<div className="space-y-3">
			<BillStatusReportGrid
				rows={rows}
				loading={isLoading}
				error={error}
				entityNames={entityNames}
				canManage={canIssue}
				sorting={grid.sorting}
				onSortingChange={grid.onSortingChange}
				pagination={grid.pagination}
				onPaginationChange={grid.onPaginationChange}
				rowCount={totalRows}
				syncBillPending={syncBillPending}
				retractBillPending={retractBillPending}
				onSyncBillStatus={onSyncBillStatus}
				onRetractBill={onRetractBill}
			/>
			{syncBillError ? (
				<div className="mt-3 text-sm text-destructive">
					{syncBillError instanceof Error
						? syncBillError.message
						: 'Failed to sync assessment bill status'}
				</div>
			) : null}
			{retractBillError ? (
				<div className="mt-3 text-sm text-destructive">
					{retractBillError instanceof Error
						? retractBillError.message
						: 'Failed to retract assessment bill'}
				</div>
			) : null}
		</div>
	)
}
