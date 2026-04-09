/**
 * Wallet Transactions Section - MRT data grid with search and pagination
 */

import { MantineReactTable } from 'mantine-react-table'

import { Badge } from '@/components/ui/badge'

import { useFulcrumTable } from './use-fulcrum-table'

import type { MRT_ColumnDef } from 'mantine-react-table'

interface ProcessedWalletTransaction {
	transaction_id: string
	typeName?: string
	clientName?: string
	locationName?: string
	quantity: number
	unit_price: string
	totalValue: string
	is_buy: boolean
	date: string
}

interface WalletTransactionsData {
	transactions: ProcessedWalletTransaction[]
	truncated?: boolean
}

function formatIsk(value: string | number): string {
	const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value
	if (isNaN(num)) return '-'
	if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
	if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
	if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`
	return num.toFixed(0)
}

const columns: MRT_ColumnDef<ProcessedWalletTransaction>[] = [
	{
		accessorKey: 'date',
		header: 'Date',
		filterVariant: 'date-range',
		accessorFn: (row) => new Date(row.date),
		Cell: ({ row }) => new Date(row.original.date).toLocaleDateString(),
	},
	{
		accessorKey: 'is_buy',
		header: 'Type',
		enableGlobalFilter: false,
		filterVariant: 'select',
		mantineFilterSelectProps: {
			data: [
				{ value: 'true', label: 'Buy' },
				{ value: 'false', label: 'Sell' },
			],
		},
		filterFn: (row, _columnId, filterValue) => {
			if (!filterValue) return true
			return String(row.original.is_buy) === filterValue
		},
		Cell: ({ row }) => (
			<Badge variant={row.original.is_buy ? 'destructive' : 'success'}>
				{row.original.is_buy ? 'Buy' : 'Sell'}
			</Badge>
		),
	},
	{
		accessorKey: 'typeName',
		header: 'Item',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => (
			<span className="font-medium">{row.original.typeName || '-'}</span>
		),
	},
	{
		accessorKey: 'clientName',
		header: 'With',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => row.original.clientName || '-',
	},
	{
		accessorKey: 'locationName',
		header: 'Location',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => (
			<span className="max-w-[200px] truncate block text-muted-foreground">
				{row.original.locationName || '-'}
			</span>
		),
	},
	{
		accessorKey: 'quantity',
		header: 'Qty',
		enableGlobalFilter: false,
		filterVariant: 'range',
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div className="text-right font-mono">{row.original.quantity.toLocaleString()}</div>
		),
	},
	{
		accessorKey: 'unit_price',
		header: 'Unit Price',
		enableGlobalFilter: false,
		filterVariant: 'range',
		accessorFn: (row) => {
			const v = row.unit_price
			return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
		},
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div className="text-right font-mono text-sm">{formatIsk(row.original.unit_price)}</div>
		),
	},
	{
		accessorKey: 'totalValue',
		header: 'Total',
		enableGlobalFilter: false,
		filterVariant: 'range',
		accessorFn: (row) => {
			const v = row.totalValue
			return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
		},
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div className="text-right font-mono font-medium">{formatIsk(row.original.totalValue)} ISK</div>
		),
	},
]

export function WalletTransactionsSection({
	data: rawData,
}: {
	data: ProcessedWalletTransaction[] | WalletTransactionsData
}) {
	const data = Array.isArray(rawData) ? rawData : rawData.transactions
	const truncated = Array.isArray(rawData) ? false : rawData.truncated ?? false

	const table = useFulcrumTable({
		columns,
		data,
		emptyMessage: 'No transactions found.',
		searchPlaceholder: 'Search transactions...',
	})

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No wallet transactions found.</p>
	}

	// Compute total buy/sell volumes
	const { totalBuy, totalSell } = data.reduce(
		(acc, txn) => {
			const val = typeof txn.totalValue === 'number'
				? txn.totalValue
				: parseFloat(String(txn.totalValue).replace(/,/g, ''))
			if (!isNaN(val)) {
				if (txn.is_buy) acc.totalBuy += val
				else acc.totalSell += val
			}
			return acc
		},
		{ totalBuy: 0, totalSell: 0 },
	)

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
				<div>
					<span className="text-muted-foreground">Total Bought: </span>
					<span className="font-mono font-semibold text-red-400">{formatIsk(totalBuy)} ISK</span>
				</div>
				<div>
					<span className="text-muted-foreground">Total Sold: </span>
					<span className="font-mono font-semibold text-green-400">{formatIsk(totalSell)} ISK</span>
				</div>
				<div>
					<span className="text-muted-foreground">Net: </span>
					<span className={`font-mono font-semibold ${totalSell - totalBuy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
						{formatIsk(totalSell - totalBuy)} ISK
					</span>
				</div>
			</div>
			{truncated && (
				<p className="text-xs text-muted-foreground italic">
					Note: Not all transaction history could be retrieved due to ESI rate limits.
				</p>
			)}
			<div className="tax-report-grid">
				<MantineReactTable table={table} />
			</div>
		</div>
	)
}
