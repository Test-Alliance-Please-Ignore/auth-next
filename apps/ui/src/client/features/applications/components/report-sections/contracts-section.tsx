/**
 * Contracts Section - MRT data grid with expandable details and filter buttons
 */

import { Package, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { MantineReactTable } from 'mantine-react-table'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { useFulcrumTable } from './use-fulcrum-table'

import type { MRT_ColumnDef } from 'mantine-react-table'

// ============================================================================
// Types
// ============================================================================

interface ProcessedContractItem {
	type_id: string
	typeName?: string
	quantity: number
	is_included: boolean
	is_singleton: boolean
	record_id: string
	raw_quantity?: number
}

interface ProcessedContract {
	contract_id: string
	type: string
	status: string
	issuerName?: string
	issuerCorporationName?: string
	acceptorName?: string
	assigneeName?: string
	date_issued: string
	date_expired: string
	date_accepted?: string
	date_completed?: string
	title?: string
	price?: number
	reward?: number
	collateral?: number
	buyout?: number
	volume?: number
	availability: string
	start_location_id?: string
	end_location_id?: string
	startLocationName?: string
	endLocationName?: string
	for_corporation?: boolean
	days_to_complete?: number
	items?: ProcessedContractItem[]
}

type ContractType = 'all' | 'item_exchange' | 'courier' | 'auction' | 'loan'
type ContractStatus = 'all' | 'outstanding' | 'finished' | 'in_progress' | 'cancelled'

// ============================================================================
// Helpers
// ============================================================================

function formatIsk(amount?: number): string {
	if (amount == null || amount === 0) return '-'
	if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B ISK`
	if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M ISK`
	if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K ISK`
	return `${amount.toFixed(0)} ISK`
}

const TYPE_LABELS: Record<string, string> = {
	item_exchange: 'Item Exchange',
	courier: 'Courier',
	auction: 'Auction',
	loan: 'Loan',
	unknown: 'Unknown',
}

const STATUS_LABELS: Record<string, string> = {
	outstanding: 'Outstanding',
	finished: 'Finished',
	finished_issuer: 'Finished',
	finished_contractor: 'Finished',
	in_progress: 'In Progress',
	cancelled: 'Cancelled',
	deleted: 'Deleted',
	failed: 'Failed',
	rejected: 'Rejected',
	reversed: 'Reversed',
}

function isFinishedStatus(status: string): boolean {
	return status === 'finished' || status === 'finished_issuer' || status === 'finished_contractor'
}

function isCancelledStatus(status: string): boolean {
	return (
		status === 'cancelled' ||
		status === 'deleted' ||
		status === 'failed' ||
		status === 'rejected' ||
		status === 'reversed'
	)
}

/** Generate a brief summary when no title is set */
function contractSummary(contract: ProcessedContract): string {
	if (contract.type === 'courier') {
		const vol = contract.volume ? `${contract.volume.toLocaleString()} m³` : ''
		return vol ? `Courier (${vol})` : 'Courier contract'
	}
	const itemCount = contract.items?.length ?? 0
	if (itemCount > 0) return `${itemCount} item${itemCount !== 1 ? 's' : ''}`
	return '-'
}

// ============================================================================
// Sub-components
// ============================================================================

function TypeBadge({ type }: { type: string }) {
	switch (type) {
		case 'item_exchange':
			return <Badge variant="default">Item Exchange</Badge>
		case 'courier':
			return <Badge variant="secondary">Courier</Badge>
		case 'auction':
			return <Badge variant="secondary">Auction</Badge>
		case 'loan':
			return <Badge variant="warning">Loan</Badge>
		default:
			return <Badge variant="secondary">{type}</Badge>
	}
}

function StatusBadge({ status }: { status: string }) {
	if (status === 'outstanding')
		return <Badge variant="default">Outstanding</Badge>
	if (isFinishedStatus(status))
		return <Badge variant="success">Finished</Badge>
	if (status === 'in_progress')
		return <Badge variant="secondary">In Progress</Badge>
	if (isCancelledStatus(status))
		return <Badge variant="destructive">{STATUS_LABELS[status] ?? status}</Badge>
	return <Badge variant="secondary">{status}</Badge>
}

function ContractDetails({ contract }: { contract: ProcessedContract }) {
	const hasItems = contract.items && contract.items.length > 0
	const includedItems = contract.items?.filter((i) => i.is_included) ?? []
	const requestedItems = contract.items?.filter((i) => !i.is_included) ?? []

	return (
		<div className="space-y-3 px-2 py-3">
			{/* Contract metadata */}
			<div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
				{contract.for_corporation && contract.issuerCorporationName && (
					<div>
						<span className="text-muted-foreground">On behalf of: </span>
						{contract.issuerCorporationName}
					</div>
				)}
				{contract.date_accepted && (
					<div>
						<span className="text-muted-foreground">Accepted: </span>
						{new Date(contract.date_accepted).toLocaleString()}
					</div>
				)}
				{contract.date_completed && (
					<div>
						<span className="text-muted-foreground">Completed: </span>
						{new Date(contract.date_completed).toLocaleString()}
					</div>
				)}
				<div>
					<span className="text-muted-foreground">Expires: </span>
					{new Date(contract.date_expired).toLocaleString()}
				</div>
				{contract.availability && (
					<div>
						<span className="text-muted-foreground">Availability: </span>
						<span className="capitalize">{contract.availability}</span>
					</div>
				)}
			</div>

			{/* Courier-specific details */}
			{contract.type === 'courier' && (
				<div className="rounded border bg-muted/20 p-3">
					<div className="flex items-center gap-2 text-sm font-medium mb-2">
						<Truck className="h-4 w-4" />
						Courier Details
					</div>
					<div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
						{contract.collateral != null && contract.collateral > 0 && (
							<div>
								<span className="text-muted-foreground">Collateral: </span>
								{formatIsk(contract.collateral)}
							</div>
						)}
						{contract.reward != null && contract.reward > 0 && (
							<div>
								<span className="text-muted-foreground">Reward: </span>
								{formatIsk(contract.reward)}
							</div>
						)}
						{contract.volume != null && (
							<div>
								<span className="text-muted-foreground">Volume: </span>
								{contract.volume.toLocaleString()} m³
							</div>
						)}
						{contract.days_to_complete != null && (
							<div>
								<span className="text-muted-foreground">Days to complete: </span>
								{contract.days_to_complete}
							</div>
						)}
					</div>
				</div>
			)}

			{/* Auction-specific details */}
			{contract.type === 'auction' && contract.buyout != null && contract.buyout > 0 && (
				<div className="text-sm">
					<span className="text-muted-foreground">Buyout: </span>
					{formatIsk(contract.buyout)}
				</div>
			)}

			{/* Contract items */}
			{hasItems && (
				<div className="space-y-2">
					{includedItems.length > 0 && (
						<div>
							<div className="flex items-center gap-2 text-sm font-medium mb-1">
								<Package className="h-4 w-4" />
								Items Offered ({includedItems.length})
							</div>
							<ItemTable items={includedItems} />
						</div>
					)}
					{requestedItems.length > 0 && (
						<div>
							<div className="flex items-center gap-2 text-sm font-medium mb-1">
								<Package className="h-4 w-4 text-orange-400" />
								Items Requested ({requestedItems.length})
							</div>
							<ItemTable items={requestedItems} />
						</div>
					)}
				</div>
			)}

			{!hasItems && (contract.type === 'item_exchange' || contract.type === 'auction') && (
				<p className="text-xs text-muted-foreground italic">No item data available</p>
			)}
		</div>
	)
}

function ItemTable({ items }: { items: ProcessedContractItem[] }) {
	return (
		<div className="rounded border overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Item</TableHead>
						<TableHead className="text-right">Quantity</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => (
						<TableRow key={item.record_id}>
							<TableCell className="text-sm py-1.5">
								{item.typeName || `Type ${item.type_id}`}
								{item.is_singleton && (
									<span className="ml-1.5 text-xs text-muted-foreground">(assembled)</span>
								)}
							</TableCell>
							<TableCell className="text-right text-sm tabular-nums py-1.5">
								{item.quantity.toLocaleString()}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}

// ============================================================================
// Filter Buttons
// ============================================================================

function FilterButton({
	active,
	onClick,
	children,
	count,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
	count?: number
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
				active
					? 'bg-primary text-primary-foreground'
					: 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
			)}
		>
			{children}
			{count != null && (
				<span className="ml-1 opacity-70">({count})</span>
			)}
		</button>
	)
}

// ============================================================================
// Column Definitions
// ============================================================================

const contractColumns: MRT_ColumnDef<ProcessedContract>[] = [
	{
		accessorKey: 'type',
		header: 'Type',
		filterVariant: 'multi-select',
		mantineFilterMultiSelectProps: {
			data: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
		},
		Cell: ({ row }) => <TypeBadge type={row.original.type} />,
	},
	{
		accessorKey: 'status',
		header: 'Status',
		filterVariant: 'multi-select',
		mantineFilterMultiSelectProps: {
			data: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
		},
		Cell: ({ row }) => <StatusBadge status={row.original.status} />,
	},
	{
		accessorKey: 'issuerName',
		header: 'From',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => row.original.issuerName || '-',
	},
	{
		accessorKey: 'acceptorName',
		header: 'To',
		filterVariant: 'autocomplete',
		Cell: ({ row }) => row.original.acceptorName || row.original.assigneeName || '-',
	},
	{
		accessorKey: 'title',
		header: 'Title / Info',
		Cell: ({ row }) => (
			<span className="max-w-[200px] truncate block">
				{row.original.title || contractSummary(row.original)}
			</span>
		),
	},
	{
		accessorKey: 'price',
		header: 'Price',
		enableGlobalFilter: false,
		filterVariant: 'range',
		accessorFn: (row) => row.price ?? row.reward ?? 0,
		mantineTableHeadCellProps: { style: { textAlign: 'right' } },
		Cell: ({ row }) => (
			<div className="text-right tabular-nums">
				{formatIsk(row.original.price || row.original.reward)}
			</div>
		),
	},
	{
		accessorKey: 'date_issued',
		header: 'Issued',
		filterVariant: 'date-range',
		accessorFn: (row) => new Date(row.date_issued),
		Cell: ({ row }) => (
			<span className="text-muted-foreground whitespace-nowrap">
				{new Date(row.original.date_issued).toLocaleDateString()}
			</span>
		),
	},
]

// ============================================================================
// Main Component
// ============================================================================

export function ContractsSection({ data }: { data: ProcessedContract[] }) {
	const [typeFilter, setTypeFilter] = useState<ContractType>('all')
	const [statusFilter, setStatusFilter] = useState<ContractStatus>('all')

	const typeCounts = useMemo(() => {
		const counts: Record<string, number> = {}
		for (const c of data) {
			counts[c.type] = (counts[c.type] ?? 0) + 1
		}
		return counts
	}, [data])

	const filtered = useMemo(() => {
		let result = data

		if (typeFilter !== 'all') {
			result = result.filter((c) => c.type === typeFilter)
		}

		if (statusFilter !== 'all') {
			result = result.filter((c) => {
				if (statusFilter === 'finished') return isFinishedStatus(c.status)
				if (statusFilter === 'cancelled') return isCancelledStatus(c.status)
				return c.status === statusFilter
			})
		}

		return result
	}, [data, typeFilter, statusFilter])

	const table = useFulcrumTable({
		columns: contractColumns,
		data: filtered,
		emptyMessage: 'No contracts match the current filters',
		searchPlaceholder: 'Search contracts...',
		renderDetailPanel: ({ row }) => <ContractDetails contract={row.original} />,
	})

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No contracts found.</p>
	}

	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground italic">
				Note: ESI only returns contracts from the last 30 days.
			</p>
			{/* Summary */}
			<div className="grid gap-4 sm:grid-cols-4">
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">Total</p>
						<p className="text-lg font-bold">{data.length}</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">Outstanding</p>
						<p className="text-lg font-bold">
							{data.filter((c) => c.status === 'outstanding').length}
						</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">Completed</p>
						<p className="text-lg font-bold">
							{data.filter((c) => isFinishedStatus(c.status)).length}
						</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">With Items</p>
						<p className="text-lg font-bold">
							{data.filter((c) => c.items && c.items.length > 0).length}
						</p>
					</CardContent>
				</Card>
			</div>

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				{/* Type filter */}
				<div className="flex flex-wrap gap-1">
					<FilterButton
						active={typeFilter === 'all'}
						onClick={() => setTypeFilter('all')}
						count={data.length}
					>
						All
					</FilterButton>
					{(['item_exchange', 'courier', 'auction', 'loan'] as const).map(
						(type) =>
							typeCounts[type] && (
								<FilterButton
									key={type}
									active={typeFilter === type}
									onClick={() =>
										setTypeFilter(typeFilter === type ? 'all' : type)
									}
									count={typeCounts[type]}
								>
									{TYPE_LABELS[type]}
								</FilterButton>
							),
					)}
				</div>

				<div className="h-5 w-px bg-border" />

				{/* Status filter */}
				<div className="flex flex-wrap gap-1">
					{(['all', 'outstanding', 'in_progress', 'finished', 'cancelled'] as const).map(
						(status) => (
							<FilterButton
								key={status}
								active={statusFilter === status}
								onClick={() =>
									setStatusFilter(statusFilter === status ? 'all' : status)
								}
							>
								{status === 'all' ? 'Any Status' : STATUS_LABELS[status] ?? status}
							</FilterButton>
						),
					)}
				</div>
			</div>

			{/* Data Grid */}
			<div className="tax-report-grid">
				<MantineReactTable table={table} />
			</div>

			<p className="text-xs text-muted-foreground">
				Showing {filtered.length} of {data.length} contracts
			</p>
		</div>
	)
}
