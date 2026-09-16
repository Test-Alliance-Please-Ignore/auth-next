/**
 * Wallet Transactions Section with search, filters, and pagination.
 */

import { Loader2 } from 'lucide-react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'

import { EntityNameLink } from './entity-name-link'
import { FulcrumDataTable } from './fulcrum-data-table'

import type { ReportChunkProgress } from '../../hooks'
import type { FulcrumDataTableColumn } from './fulcrum-data-table'

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

function buildWalletTransactionColumns(): Array<
	FulcrumDataTableColumn<ProcessedWalletTransaction>
> {
	return [
		{
			id: 'date',
			header: 'Date/Time',
			getValue: (row) => new Date(row.date),
			filter: { kind: 'date-range' },
			cell: (row) => <EveTimeDisplay dateStr={row.date} format="compact" />,
		},
		{
			id: 'is_buy',
			header: i18n.t('hrpages.type'),
			getValue: (row) => String(row.is_buy),
			globalFilter: false,
			filter: {
				kind: 'select',
				options: [
					{ value: 'true', label: i18n.t('hrpages.buy') },
					{ value: 'false', label: i18n.t('hrpages.sell') },
				],
			},
			cell: (row) => (
				<Badge variant={row.is_buy ? 'destructive' : 'success'}>
					{row.is_buy ? i18n.t('hrpages.buy') : i18n.t('hrpages.sell')}
				</Badge>
			),
		},
		{
			id: 'typeName',
			header: i18n.t('hrpages.item'),
			getValue: (row) => row.typeName,
			filter: { kind: 'autocomplete' },
			cell: (row) => <span className="font-medium">{row.typeName || '-'}</span>,
		},
		{
			id: 'clientDisplayName',
			header: i18n.t('hrpages.with'),
			getValue: (row) => row.clientDisplayName ?? row.clientName,
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<EntityNameLink entityId={row.client_id} href={row.clientDisplayHref}>
					{row.clientDisplayName || row.clientName || '-'}
				</EntityNameLink>
			),
		},
		{
			id: 'locationName',
			header: i18n.t('hrpages.location'),
			getValue: (row) => row.locationName,
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<span className="max-w-[200px] truncate block text-muted-foreground">
					{row.locationName || '-'}
				</span>
			),
		},
		{
			id: 'quantity',
			header: i18n.t('hrpages.qty'),
			getValue: (row) => row.quantity,
			globalFilter: false,
			filter: { kind: 'range' },
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => (
				<div className="font-mono">{row.quantity.toLocaleString(getActiveLocale())}</div>
			),
		},
		{
			id: 'unit_price',
			header: i18n.t('hrpages.unitPrice'),
			getValue: (row) => {
				const v = row.unit_price
				return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
			},
			globalFilter: false,
			filter: { kind: 'range' },
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => <div className="font-mono text-sm">{formatIsk(row.unit_price)}</div>,
		},
		{
			id: 'totalValue',
			header: i18n.t('hrpages.total'),
			getValue: (row) => {
				const v = row.totalValue
				return typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
			},
			globalFilter: false,
			filter: { kind: 'range' },
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => <div className="font-mono font-medium">{formatIsk(row.totalValue)} ISK</div>,
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
	const { t } = useAppTranslation()

	const data = !rawData ? [] : Array.isArray(rawData) ? rawData : rawData.transactions
	const truncated = !rawData || Array.isArray(rawData) ? false : (rawData.truncated ?? false)
	const isLoadingChunks = Boolean(
		!rawData && loadingProgress && loadingProgress.loadedChunks < loadingProgress.totalChunks
	)
	const columns = useMemo(() => buildWalletTransactionColumns(), [t])

	const table = (
		<FulcrumDataTable
			columns={columns}
			rows={data}
			emptyMessage={
				isLoadingChunks ? t('hrpages.loadingTransactions') : t('hrpages.noTransactionsFound')
			}
			searchPlaceholder={t('hrpages.searchTransactions')}
			pageSize={100}
			pageSizeOptions={[50, 100, 200, 500]}
			compactRows
			getRowKey={(transaction) => transaction.transaction_id}
			customActions={
				isLoadingChunks ? (
					<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						{t('hrpages.loadingChunks')}
						{loadingProgress?.loadedChunks ?? 0}/{loadingProgress?.totalChunks ?? 0}
					</span>
				) : undefined
			}
		/>
	)

	if (data.length === 0 && !isLoadingChunks) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noWalletTransactionsFound')}</p>
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
					<span className="text-muted-foreground">{t('hrpages.totalBought')}</span>
					<span className="font-mono font-semibold text-red-400">{formatIsk(totalBuy)} ISK</span>
				</div>
				<div>
					<span className="text-muted-foreground">{t('hrpages.totalSold')}</span>
					<span className="font-mono font-semibold text-green-400">{formatIsk(totalSell)} ISK</span>
				</div>
				<div>
					<span className="text-muted-foreground">{t('hrpages.net')}</span>
					<span
						className={`font-mono font-semibold ${totalSell - totalBuy >= 0 ? 'text-green-400' : 'text-red-400'}`}
					>
						{formatIsk(totalSell - totalBuy)} ISK
					</span>
				</div>
			</div>
			{truncated && (
				<p className="text-xs text-muted-foreground italic">
					{t('hrpages.noteNotAllTransactionHistoryCouldBeRetrievedDueTo')}
				</p>
			)}
			{table}
		</div>
	)
}
