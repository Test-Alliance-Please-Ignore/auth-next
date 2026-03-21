import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber } from '@/lib/tax-display'

import { compareBigIntValues, parseDecimalToCentiBigInt } from './shared'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxCompliancePoint } from '@repo/corporation-tax'

export function ComplianceGrid(props: {
	rows: TaxCompliancePoint[]
	loading: boolean
	error: unknown
}) {
	const columnHelper = createMRTColumnHelper<TaxCompliancePoint>()
	const columns = useMemo<MRT_ColumnDef<TaxCompliancePoint>[]>(
		() => [
			columnHelper.accessor((row) => new Date(row.rollupDate).getTime(), {
				id: 'rollupDate',
				header: 'Date',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDateTime(row.original.rollupDate),
			}),
			columnHelper.accessor('taxDue', {
				id: 'taxDue',
				header: 'Tax Due',
				enableSorting: true,
				sortingFn: (rowA, rowB) =>
					compareBigIntValues(
						parseDecimalToCentiBigInt(rowA.original.taxDue),
						parseDecimalToCentiBigInt(rowB.original.taxDue)
					),
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			}),
			columnHelper.accessor('taxPaid', {
				id: 'taxPaid',
				header: 'Tax Paid',
				enableSorting: true,
				sortingFn: (rowA, rowB) =>
					compareBigIntValues(
						parseDecimalToCentiBigInt(rowA.original.taxPaid),
						parseDecimalToCentiBigInt(rowB.original.taxPaid)
					),
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			}),
			columnHelper.accessor('taxDelta', {
				id: 'taxDelta',
				header: 'Delta',
				enableSorting: true,
				sortingFn: (rowA, rowB) =>
					compareBigIntValues(
						parseDecimalToCentiBigInt(rowA.original.taxDelta),
						parseDecimalToCentiBigInt(rowB.original.taxDelta)
					),
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			}),
			columnHelper.accessor('entryCount', {
				header: 'Entries',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxNumber(row.original.entryCount),
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
			emptyMessage="No compliance trend points available."
		/>
	)
}
