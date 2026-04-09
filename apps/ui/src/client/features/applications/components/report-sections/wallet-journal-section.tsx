/**
 * Wallet Journal Section - MRT data grid with search and pagination
 */

import { MantineReactTable } from 'mantine-react-table'

import { useFulcrumTable } from './use-fulcrum-table'

import type { MRT_ColumnDef } from 'mantine-react-table'

interface ProcessedWalletJournalEntry {
	id: string
	date: string
	refTypeLabel?: string
	amountFormatted?: string
	balanceFormatted?: string
	firstPartyName?: string
	secondPartyName?: string
	amount?: number
	description?: string
}

const columns: MRT_ColumnDef<ProcessedWalletJournalEntry>[] = [
	{
		accessorKey: 'date',
		header: 'Date',
		filterVariant: 'date-range',
		accessorFn: (row) => new Date(row.date),
		Cell: ({ row }) => new Date(row.original.date).toLocaleDateString(),
	},
	{
		accessorKey: 'refTypeLabel',
		header: 'Type',
		filterVariant: 'multi-select',
		enableColumnFilter: true,
		mantineFilterMultiSelectProps: {
			comboboxProps: { withinPortal: true },
		},
		Cell: ({ row }) => row.original.refTypeLabel || '-',
	},
	{
		accessorKey: 'firstPartyName',
		header: 'From',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => row.original.firstPartyName || '-',
	},
	{
		accessorKey: 'secondPartyName',
		header: 'To',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => row.original.secondPartyName || '-',
	},
	{
		accessorKey: 'description',
		header: 'Description',
		Cell: ({ row }) => (
			<span className="max-w-[200px] truncate block text-muted-foreground">
				{row.original.description || '-'}
			</span>
		),
	},
	{
		accessorKey: 'amount',
		header: 'Amount',
		enableGlobalFilter: false,
		filterVariant: 'range',
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div
				className={`text-right font-mono font-medium ${row.original.amount != null && row.original.amount < 0
					? 'text-red-400'
					: 'text-green-400'
					}`}
			>
				{row.original.amountFormatted || '-'}
			</div>
		),
	},
	{
		accessorKey: 'balanceFormatted',
		header: 'Balance',
		enableGlobalFilter: false,
		enableColumnFilter: false,
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div className="text-right font-mono text-sm">{row.original.balanceFormatted || '-'}</div>
		),
	},
]

export function WalletJournalSection({ data }: { data: ProcessedWalletJournalEntry[] }) {
	const table = useFulcrumTable({
		columns,
		data,
		emptyMessage: 'No journal entries found.',
		searchPlaceholder: 'Search journal...',
	})

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No journal entries found.</p>
	}

	return (
		<div className="space-y-3">
			<p className="text-xs text-muted-foreground italic">
				Note: ESI only returns journal entries from the last 30 days.
			</p>
			<div className="tax-report-grid">
				<MantineReactTable table={table} />
			</div>
		</div>
	)
}
