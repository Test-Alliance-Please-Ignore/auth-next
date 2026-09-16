/**
 * Contracts Section with expandable details and filter buttons.
 */

import { Package, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'

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
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { EntityNameLink } from './entity-name-link'
import { FulcrumDataTable } from './fulcrum-data-table'

import type { FulcrumDataTableColumn } from './fulcrum-data-table'

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
	issuer_id?: string
	issuerName?: string
	issuerDisplayName?: string
	issuerDisplayHref?: string
	issuerCorporationId?: string
	issuerCorporationName?: string
	issuerCorporationDisplayHref?: string
	acceptor_id?: string
	acceptorName?: string
	acceptorDisplayName?: string
	acceptorDisplayHref?: string
	assignee_id?: string
	assigneeName?: string
	assigneeDisplayName?: string
	assigneeDisplayHref?: string
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
	if (amount >= 1_000_000_000)
		return i18n.t('hrpages.value1BIsk', { value1: (amount / 1_000_000_000).toFixed(1) })
	if (amount >= 1_000_000)
		return i18n.t('hrpages.value1MIsk', { value1: (amount / 1_000_000).toFixed(1) })
	if (amount >= 1_000) return i18n.t('hrpages.value1KIsk', { value1: (amount / 1_000).toFixed(1) })
	return `${amount.toFixed(0)} ISK`
}

const TYPE_LABELS: Record<string, string> = {
	get item_exchange() {
		return i18n.t('hrpages.itemExchange')
	},
	get courier() {
		return i18n.t('hrpages.courier')
	},
	get auction() {
		return i18n.t('hrpages.auction')
	},
	get loan() {
		return i18n.t('hrpages.loan')
	},
	get unknown() {
		return i18n.t('hrpages.unknown')
	},
}

const STATUS_LABELS: Record<string, string> = {
	get outstanding() {
		return i18n.t('hrpages.outstanding')
	},
	get finished() {
		return i18n.t('hrpages.finished')
	},
	get finished_issuer() {
		return i18n.t('hrpages.finished')
	},
	get finished_contractor() {
		return i18n.t('hrpages.finished')
	},
	get in_progress() {
		return i18n.t('hrpages.inProgress')
	},
	get cancelled() {
		return i18n.t('hrpages.cancelled')
	},
	get deleted() {
		return i18n.t('hrpages.deleted')
	},
	get failed() {
		return i18n.t('hrpages.failed')
	},
	get rejected() {
		return i18n.t('hrpages.rejected')
	},
	get reversed() {
		return i18n.t('hrpages.reversed')
	},
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
		const vol = contract.volume ? `${contract.volume.toLocaleString(getActiveLocale())} m³` : ''
		return vol
			? i18n.t('hrpages.courierValue1', { value1: vol })
			: i18n.t('hrpages.courierContract')
	}
	const itemCount = contract.items?.length ?? 0
	if (itemCount > 0) return i18n.t('hrpages.contractItems', { value1: itemCount })
	return '-'
}

// ============================================================================
// Sub-components
// ============================================================================

function TypeBadge({ type }: { type: string }) {
	const { t } = useAppTranslation()

	switch (type) {
		case 'item_exchange':
			return <Badge variant="default">{t('hrpages.itemExchange')}</Badge>
		case 'courier':
			return <Badge variant="secondary">{t('hrpages.courier')}</Badge>
		case 'auction':
			return <Badge variant="secondary">{t('hrpages.auction')}</Badge>
		case 'loan':
			return <Badge variant="warning">{t('hrpages.loan')}</Badge>
		default:
			return <Badge variant="secondary">{type}</Badge>
	}
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useAppTranslation()

	if (status === 'outstanding') return <Badge variant="default">{t('hrpages.outstanding')}</Badge>
	if (isFinishedStatus(status)) return <Badge variant="success">{t('hrpages.finished')}</Badge>
	if (status === 'in_progress') return <Badge variant="secondary">{t('hrpages.inProgress')}</Badge>
	if (isCancelledStatus(status))
		return <Badge variant="destructive">{STATUS_LABELS[status] ?? status}</Badge>
	return <Badge variant="secondary">{status}</Badge>
}

function ContractDetails({ contract }: { contract: ProcessedContract }) {
	const { t } = useAppTranslation()

	const hasItems = contract.items && contract.items.length > 0
	const includedItems = contract.items?.filter((i) => i.is_included) ?? []
	const requestedItems = contract.items?.filter((i) => !i.is_included) ?? []

	return (
		<div className="space-y-3 px-2 py-3">
			{/* Contract metadata */}
			<div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
				{contract.for_corporation && contract.issuerCorporationName && (
					<div>
						<span className="text-muted-foreground">{t('hrpages.onBehalfOf')}</span>
						<EntityNameLink
							entityId={contract.issuerCorporationId}
							href={contract.issuerCorporationDisplayHref}
						>
							{contract.issuerCorporationName}
						</EntityNameLink>
					</div>
				)}
				{contract.date_accepted && (
					<div>
						<span className="text-muted-foreground">{t('hrpages.accepted2')}</span>
						{new Date(contract.date_accepted).toLocaleString(getActiveLocale())}
					</div>
				)}
				{contract.date_completed && (
					<div>
						<span className="text-muted-foreground">{t('hrpages.completed2')}</span>
						{new Date(contract.date_completed).toLocaleString(getActiveLocale())}
					</div>
				)}
				<div>
					<span className="text-muted-foreground">{t('hrpages.expires2')}</span>
					{new Date(contract.date_expired).toLocaleString(getActiveLocale())}
				</div>
				{contract.availability && (
					<div>
						<span className="text-muted-foreground">{t('hrpages.availability')}</span>
						<span className="capitalize">{contract.availability}</span>
					</div>
				)}
			</div>

			{/* Courier-specific details */}
			{contract.type === 'courier' && (
				<div className="rounded border bg-muted/20 p-3">
					<div className="flex items-center gap-2 text-sm font-medium mb-2">
						<Truck className="h-4 w-4" />
						{t('hrpages.courierDetails')}
					</div>
					<div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 text-sm">
						{contract.collateral != null && contract.collateral > 0 && (
							<div>
								<span className="text-muted-foreground">{t('hrpages.collateral')}</span>
								{formatIsk(contract.collateral)}
							</div>
						)}
						{contract.reward != null && contract.reward > 0 && (
							<div>
								<span className="text-muted-foreground">{t('hrpages.reward')}</span>
								{formatIsk(contract.reward)}
							</div>
						)}
						{contract.volume != null && (
							<div>
								<span className="text-muted-foreground">{t('hrpages.volume')}</span>
								{contract.volume.toLocaleString(getActiveLocale())}
								{t('hrpages.m')}
							</div>
						)}
						{contract.days_to_complete != null && (
							<div>
								<span className="text-muted-foreground">{t('hrpages.daysToComplete')}</span>
								{contract.days_to_complete}
							</div>
						)}
					</div>
				</div>
			)}

			{/* Auction-specific details */}
			{contract.type === 'auction' && contract.buyout != null && contract.buyout > 0 && (
				<div className="text-sm">
					<span className="text-muted-foreground">{t('hrpages.buyout')}</span>
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
								{t('hrpages.itemsOffered')}
								{includedItems.length})
							</div>
							<ItemTable items={includedItems} />
						</div>
					)}
					{requestedItems.length > 0 && (
						<div>
							<div className="flex items-center gap-2 text-sm font-medium mb-1">
								<Package className="h-4 w-4 text-orange-400" />
								{t('hrpages.itemsRequested')}
								{requestedItems.length})
							</div>
							<ItemTable items={requestedItems} />
						</div>
					)}
				</div>
			)}

			{!hasItems && (contract.type === 'item_exchange' || contract.type === 'auction') && (
				<p className="text-xs text-muted-foreground italic">{t('hrpages.noItemDataAvailable')}</p>
			)}
		</div>
	)
}

function ItemTable({ items }: { items: ProcessedContractItem[] }) {
	const { t } = useAppTranslation()

	return (
		<div className="rounded border overflow-hidden">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t('hrpages.item')}</TableHead>
						<TableHead className="text-right">{t('hrpages.quantity')}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => (
						<TableRow key={item.record_id}>
							<TableCell className="text-sm py-1.5">
								{item.typeName || t('hrpages.typeValue1', { value1: item.type_id })}
								{item.is_singleton && (
									<span className="ml-1.5 text-xs text-muted-foreground">
										{t('hrpages.assembled')}
									</span>
								)}
							</TableCell>
							<TableCell className="text-right text-sm tabular-nums py-1.5">
								{item.quantity.toLocaleString(getActiveLocale())}
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
					: 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
			)}
		>
			{children}
			{count != null && <span className="ml-1 opacity-70">({count})</span>}
		</button>
	)
}

// ============================================================================
// Column Definitions
// ============================================================================

function buildContractColumns(): Array<FulcrumDataTableColumn<ProcessedContract>> {
	return [
		{
			id: 'type',
			header: i18n.t('hrpages.type'),
			getValue: (row) => row.type,
			filter: {
				kind: 'multi-select',
				options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
			},
			cell: (row) => <TypeBadge type={row.type} />,
		},
		{
			id: 'status',
			header: i18n.t('hrpages.status'),
			getValue: (row) => row.status,
			filter: {
				kind: 'multi-select',
				options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
			},
			cell: (row) => <StatusBadge status={row.status} />,
		},
		{
			id: 'issuerDisplayName',
			header: i18n.t('hrpages.from'),
			getValue: (row) => row.issuerDisplayName ?? row.issuerName,
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<EntityNameLink entityId={row.issuer_id} href={row.issuerDisplayHref}>
					{row.issuerDisplayName || row.issuerName || '-'}
				</EntityNameLink>
			),
		},
		{
			id: 'acceptorDisplayName',
			header: i18n.t('hrpages.to'),
			getValue: (row) =>
				row.acceptorDisplayName ??
				row.acceptorName ??
				row.assigneeDisplayName ??
				row.assigneeName ??
				'',
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<EntityNameLink
					entityId={row.acceptor_id ?? row.assignee_id}
					href={row.acceptorDisplayHref ?? row.assigneeDisplayHref}
				>
					{row.acceptorDisplayName ||
						row.acceptorName ||
						row.assigneeDisplayName ||
						row.assigneeName ||
						'-'}
				</EntityNameLink>
			),
		},
		{
			id: 'title',
			header: i18n.t('hrpages.titleInfo'),
			getValue: (row) => row.title || contractSummary(row),
			cell: (row) => (
				<span className="max-w-[200px] truncate block">{row.title || contractSummary(row)}</span>
			),
		},
		{
			id: 'price',
			header: i18n.t('hrpages.price'),
			getValue: (row) => row.price ?? row.reward ?? 0,
			globalFilter: false,
			filter: { kind: 'range' },
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => <div className="tabular-nums">{formatIsk(row.price || row.reward)}</div>,
		},
		{
			id: 'date_issued',
			header: i18n.t('hrpages.issued'),
			getValue: (row) => new Date(row.date_issued),
			filter: { kind: 'date-range' },
			cell: (row) => (
				<span className="text-muted-foreground whitespace-nowrap">
					{new Date(row.date_issued).toLocaleDateString(getActiveLocale())}
				</span>
			),
		},
	]
}

// ============================================================================
// Main Component
// ============================================================================

export function ContractsSection({ data }: { data: ProcessedContract[] }) {
	const { t } = useAppTranslation()

	const [typeFilter, setTypeFilter] = useState<ContractType>('all')
	const [statusFilter, setStatusFilter] = useState<ContractStatus>('all')
	const contractColumns = useMemo(() => buildContractColumns(), [t])

	const typeCounts = useMemo(() => {
		const counts: Record<string, number> = {}
		for (const c of data) {
			counts[c.type] = (counts[c.type] ?? 0) + 1
		}
		return counts
	}, [data, t])

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
	}, [data, typeFilter, statusFilter, t])

	const table = (
		<FulcrumDataTable
			columns={contractColumns}
			rows={filtered}
			emptyMessage={t('hrpages.noContractsMatchTheCurrentFilters')}
			searchPlaceholder={t('hrpages.searchContracts')}
			pageSize={25}
			compactRows
			getRowKey={(contract) => contract.contract_id}
			renderExpandedRow={(contract) => <ContractDetails contract={contract} />}
		/>
	)

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noContractsFound')}</p>
	}

	return (
		<div className="space-y-4">
			<p className="text-xs text-muted-foreground italic">
				{t('hrpages.noteEsiOnlyReturnsContractsFromTheLast30Days')}
			</p>
			{/* Summary */}
			<div className="grid gap-4 sm:grid-cols-4">
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">{t('hrpages.total')}</p>
						<p className="text-lg font-bold">{data.length}</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">{t('hrpages.outstanding')}</p>
						<p className="text-lg font-bold">
							{data.filter((c) => c.status === 'outstanding').length}
						</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">{t('hrpages.completed')}</p>
						<p className="text-lg font-bold">
							{data.filter((c) => isFinishedStatus(c.status)).length}
						</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">{t('hrpages.withItems')}</p>
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
						{t('hrpages.all')}
					</FilterButton>
					{(['item_exchange', 'courier', 'auction', 'loan'] as const).map(
						(type) =>
							typeCounts[type] && (
								<FilterButton
									key={type}
									active={typeFilter === type}
									onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
									count={typeCounts[type]}
								>
									{TYPE_LABELS[type]}
								</FilterButton>
							)
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
								onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
							>
								{status === 'all' ? t('hrpages.anyStatus') : (STATUS_LABELS[status] ?? status)}
							</FilterButton>
						)
					)}
				</div>
			</div>

			{/* Data table */}
			{table}

			<p className="text-xs text-muted-foreground">
				{t('hrpages.showing')}
				{filtered.length}
				{t('hrpages.of')}
				{data.length}
				{t('hrpages.contracts2')}
			</p>
		</div>
	)
}
