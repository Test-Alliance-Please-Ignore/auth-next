/**
 * Wallet Transactions Section - MRT data grid with search and pagination
 */

import { Loader2 } from 'lucide-react'
import { MantineReactTable } from 'mantine-react-table'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'

import { EntityNameLink } from './entity-name-link'
import { useFulcrumTable } from './use-fulcrum-table'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { ReportChunkProgress } from '../../hooks'

interface ProcessedWalletTransaction {
	transaction_id: string
	client_id?: string
	typeName?: string
	clientName?: string
	clientDisplayName?: string
	clientDisplayHref?: string
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

function buildWalletTransactionColumns(): Array<MRT_ColumnDef<ProcessedWalletTransaction>> {
	return [
		{
			accessorKey: 'date',
			header: 'Date/Time',
			filterVariant: 'date-range',
			accessorFn: (row) => new Date(row.date),
			Cell: ({ row }) => <EveTimeDisplay dateStr={row.original.date} format="compact" />,
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
			Cell: ({ row }) => <span className="font-medium">{row.original.typeName || '-'}</span>,
		},
		{
			accessorKey: 'clientDisplayName',
			header: 'With',
			filterVariant: 'autocomplete',
			accessorFn: (row) => row.clientDisplayName ?? row.clientName ?? '',
			Cell: ({ row }) => (
				<EntityNameLink entityId={row.original.client_id} href={row.original.clientDisplayHref}>
					{row.original.clientDisplayName || row.original.clientName || '-'}
				</EntityNameLink>
			),
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
				<div className="text-right font-mono font-medium">
					{formatIsk(row.original.totalValue)} ISK
				</div>
			),
		},
	]
}

export function WalletTransactionsSection({
	data: rawData,
	loadingProgress,
}: {
	data: ProcessedWalletTransaction[] | WalletTransactionsData | undefined
	loadingProgress?: ReportChunkProgress
}) {
	const data = !rawData ? [] : Array.isArray(rawData) ? rawData : rawData.transactions
	const truncated = !rawData || Array.isArray(rawData) ? false : (rawData.truncated ?? false)
	const isLoadingChunks = Boolean(
		!rawData && loadingProgress && loadingProgress.loadedChunks < loadingProgress.totalChunks
	)
	const columns = useMemo(() => buildWalletTransactionColumns(), [])

	const table = useFulcrumTable({
		columns,
		data,
		emptyMessage: isLoadingChunks ? 'Loading transactions...' : 'No transactions found.',
		searchPlaceholder: 'Search transactions...',
		pageSize: 100,
		rowsPerPageOptions: ['50', '100', '200', '500'],
		compactRows: true,
		renderTopToolbarCustomActions: isLoadingChunks
			? () => (
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						Loading chunks {loadingProgress?.loadedChunks ?? 0}/{loadingProgress?.totalChunks ?? 0}
					</span>
				)
			: undefined,
	})

	if (data.length === 0 && !isLoadingChunks) {
		return <p className="text-sm text-muted-foreground">No wallet transactions found.</p>
	}

	// Compute totals across the complete client-side dataset.
	const { totalBuy, totalSell } = data.reduce(
		(acc, txn) => {
			const val =
				typeof txn.totalValue === 'number'
					? txn.totalValue
					: parseFloat(String(txn.totalValue).replace(/,/g, ''))
			if (!isNaN(val)) {
				if (txn.is_buy) acc.totalBuy += val
				else acc.totalSell += val
			}
			return acc
		},
		{ totalBuy: 0, totalSell: 0 }
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
					<span
						className={`font-mono font-semibold ${totalSell - totalBuy >= 0 ? 'text-green-400' : 'text-red-400'}`}
					>
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
