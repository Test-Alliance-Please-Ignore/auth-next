/**
 * Wallet Journal Section - MRT data grid with search and pagination
 */

import { useMemo, useState } from 'react'
import { MantineReactTable } from 'mantine-react-table'

import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { Select } from '@/components/ui/select'
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

function normalize(text?: string): string {
	return (text ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}

function isHighlightedJournalType(entry: ProcessedWalletJournalEntry): boolean {
	const typeLabel = normalize(entry.refTypeLabel)
	const description = normalize(entry.description)
	return (
		typeLabel.includes('player trading')
		|| typeLabel.includes('gm cash transfer')
		|| description.includes('player trading')
		|| description.includes('gm cash transfer')
	)
}

const columns: MRT_ColumnDef<ProcessedWalletJournalEntry>[] = [
	{
		accessorKey: 'date',
		header: 'Date/Time',
		filterVariant: 'date-range',
		accessorFn: (row) => new Date(row.date),
		Cell: ({ row }) => <EveTimeDisplay dateStr={row.original.date} format="compact" />,
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
		Cell: ({ row }) => (
			<span className={isHighlightedJournalType(row.original) ? 'font-semibold text-foreground' : undefined}>
				{row.original.firstPartyName || '-'}
			</span>
		),
	},
	{
		accessorKey: 'secondPartyName',
		header: 'To',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => (
			<span className={isHighlightedJournalType(row.original) ? 'font-semibold text-foreground' : undefined}>
				{row.original.secondPartyName || '-'}
			</span>
		),
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
	const [refTypeFilter, setRefTypeFilter] = useState<string>('all')
	const availableRefTypes = useMemo(
		() =>
			Array.from(
				new Set(data.map((entry) => entry.refTypeLabel).filter((type): type is string => Boolean(type))),
			).sort(),
		[data],
	)
	const refTypeOptions = useMemo(
		() => [
			{ value: 'all', label: 'All Types' },
			...availableRefTypes.map((type) => ({ value: type, label: type })),
		],
		[availableRefTypes],
	)
	const filteredData = useMemo(
		() =>
			refTypeFilter === 'all'
				? data
				: data.filter((entry) => (entry.refTypeLabel ?? 'Unknown') === refTypeFilter),
		[data, refTypeFilter],
	)

	const table = useFulcrumTable({
		columns,
		data: filteredData,
		emptyMessage: 'No journal entries found.',
		searchPlaceholder: 'Search journal...',
		pageSize: 1000,
		getRowClassName: (row) => (isHighlightedJournalType(row) ? 'bg-amber-500/10' : undefined),
		renderTopToolbarCustomActions: () => (
			<div className="ml-auto flex items-center gap-2">
				<label htmlFor="journal-ref-type-filter" className="text-xs font-medium text-muted-foreground">
					Transaction Type
				</label>
				<Select
					inputId="journal-ref-type-filter"
					value={refTypeFilter}
					onValueChange={(value) => setRefTypeFilter(value)}
					options={refTypeOptions}
					searchable
					placeholder="All Types"
					className="w-56"
				/>
				<span className="text-xs text-muted-foreground">
					{filteredData.length} / {data.length}
				</span>
			</div>
		),
	})

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No journal entries found.</p>
	}

	// Most recent entry's balance is the current wallet balance
	const currentBalance = data[0]?.balanceFormatted

	return (
		<div className="space-y-3">
			{currentBalance && (
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">Wallet Balance:</span>
					<span className="font-mono font-semibold">{currentBalance} ISK</span>
				</div>
			)}
			<p className="text-xs text-muted-foreground italic">
				Note: ESI only returns journal entries from the last 30 days.
			</p>
			<div className="tax-report-grid">
				<MantineReactTable table={table} />
			</div>
		</div>
	)
}
