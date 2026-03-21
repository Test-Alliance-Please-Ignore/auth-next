import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxIskFull, formatTaxNumber, formatTaxRefTypeLabel } from '@/lib/tax-display'

import { compareBigIntValues, parseDecimalToCentiBigInt } from './shared'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxTopIncomeSourceRow } from '@repo/corporation-tax'

export function TopIncomeSourcesGrid(props: {
	rows: TaxTopIncomeSourceRow[]
	loading: boolean
	error: unknown
}) {
	const columnHelper = createMRTColumnHelper<TaxTopIncomeSourceRow>()
	const columns = useMemo<MRT_ColumnDef<TaxTopIncomeSourceRow>[]>(
		() => [
			columnHelper.accessor('refType', {
				header: 'Income Type',
				enableSorting: true,
				Cell: ({ row }) => formatTaxRefTypeLabel(row.original.refType),
			}),
			columnHelper.accessor('entryCount', {
				header: 'Entries',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxNumber(row.original.entryCount),
			}),
			columnHelper.accessor('essEntryCount', {
				header: 'ESS Entries',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxNumber(row.original.essEntryCount),
			}),
			columnHelper.accessor('totalIncome', {
				id: 'totalIncome',
				header: 'Total Income',
				enableSorting: true,
				sortingFn: (rowA, rowB) =>
					compareBigIntValues(
						parseDecimalToCentiBigInt(rowA.original.totalIncome),
						parseDecimalToCentiBigInt(rowB.original.totalIncome)
					),
				Cell: ({ row }) => formatTaxIskFull(row.original.totalIncome),
			}),
		],
		[columnHelper]
	)

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No income sources found."
		/>
	)
}
