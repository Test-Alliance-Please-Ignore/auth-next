/**
 * Wallet Journal Section with search, filters, and pagination.
 */

import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { HoverPopover } from '@/components/ui/hover-popover'
import { Select } from '@/components/ui/select'
import { i18n, useAppTranslation } from '@/i18n'

import { EntityNameLink } from './entity-name-link'
import { FulcrumDataTable } from './fulcrum-data-table'

import type { ReportChunkProgress } from '../../hooks'
import type { FulcrumDataTableColumn } from './fulcrum-data-table'

interface ProcessedWalletJournalEntry {
	id: string
	date: string
	first_party_id?: string
	refTypeLabel?: string
	amountFormatted?: string
	balanceFormatted?: string
	firstPartyName?: string
	firstPartyDisplayName?: string
	firstPartyDisplayHref?: string
	second_party_id?: string
	secondPartyName?: string
	secondPartyDisplayName?: string
	secondPartyDisplayHref?: string
	tax_receiver_id?: string
	amount?: number
	description?: string
}

function normalize(text?: string): string {
	return (text ?? '')
		.toLowerCase()
		.replace(/[\s_-]+/g, ' ')
		.trim()
}

function isHighlightedJournalType(entry: ProcessedWalletJournalEntry): boolean {
	const typeLabel = normalize(entry.refTypeLabel)
	const description = normalize(entry.description)
	return (
		typeLabel.includes(i18n.t('hrpages.playerTrading')) ||
		typeLabel.includes(i18n.t('hrpages.gmCashTransfer')) ||
		description.includes(i18n.t('hrpages.playerTrading')) ||
		description.includes(i18n.t('hrpages.gmCashTransfer'))
	)
}

function buildWalletJournalColumns(): Array<FulcrumDataTableColumn<ProcessedWalletJournalEntry>> {
	return [
		{
			id: 'date',
			header: 'Date/Time',
			getValue: (row) => new Date(row.date),
			filter: { kind: 'date-range' },
			cell: (row) => <EveTimeDisplay dateStr={row.date} format="compact" />,
		},
		{
			id: 'refTypeLabel',
			header: i18n.t('hrpages.type'),
			getValue: (row) => row.refTypeLabel,
			filter: { kind: 'multi-select' },
			cell: (row) => row.refTypeLabel || '-',
		},
		{
			id: 'firstPartyDisplayName',
			header: i18n.t('hrpages.from'),
			getValue: (row) => row.firstPartyDisplayName ?? row.firstPartyName,
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<span
					className={isHighlightedJournalType(row) ? 'font-semibold text-foreground' : undefined}
				>
					<EntityNameLink entityId={row.first_party_id} href={row.firstPartyDisplayHref}>
						{row.firstPartyDisplayName || row.firstPartyName || '-'}
					</EntityNameLink>
				</span>
			),
		},
		{
			id: 'secondPartyDisplayName',
			header: i18n.t('hrpages.to'),
			getValue: (row) => row.secondPartyDisplayName ?? row.secondPartyName,
			filter: { kind: 'autocomplete' },
			cell: (row) => (
				<span
					className={isHighlightedJournalType(row) ? 'font-semibold text-foreground' : undefined}
				>
					<EntityNameLink entityId={row.second_party_id} href={row.secondPartyDisplayHref}>
						{row.secondPartyDisplayName || row.secondPartyName || '-'}
					</EntityNameLink>
				</span>
			),
		},
		{
			id: 'description',
			header: i18n.t('hrpages.description'),
			getValue: (row) => row.description,
			cell: (row) =>
				row.description ? (
					<HoverPopover
						trigger={
							<span className="block max-w-[200px] truncate text-muted-foreground">
								{row.description}
							</span>
						}
						className="max-w-[min(32rem,calc(100vw-2rem))] whitespace-normal break-words"
					>
						<p className="text-sm text-foreground">{row.description}</p>
					</HoverPopover>
				) : (
					<span className="block max-w-[200px] truncate text-muted-foreground">-</span>
				),
		},
		{
			id: 'amount',
			header: i18n.t('hrpages.amount'),
			getValue: (row) => row.amount,
			globalFilter: false,
			filter: { kind: 'range' },
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => (
				<div
					className={`font-mono font-medium ${
						row.amount != null && row.amount < 0 ? 'text-red-400' : 'text-green-400'
					}`}
				>
					{row.amountFormatted || '-'}
				</div>
			),
		},
		{
			id: 'balanceFormatted',
			header: i18n.t('hrpages.balance'),
			getValue: (row) => row.balanceFormatted,
			globalFilter: false,
			headerClassName: 'text-right',
			className: 'text-right',
			cell: (row) => <div className="font-mono text-sm">{row.balanceFormatted || '-'}</div>,
		},
	]
}

export function WalletJournalSection({
	data,
	loadingProgress,
}: {
	data: ProcessedWalletJournalEntry[] | undefined
	loadingProgress?: ReportChunkProgress
}) {
	const { t } = useAppTranslation()

	const rows = data ?? []
	const isLoadingChunks = Boolean(
		!data && loadingProgress && loadingProgress.loadedChunks < loadingProgress.totalChunks
	)
	const [refTypeFilter, setRefTypeFilter] = useState<string>('all')
	const columns = useMemo(() => buildWalletJournalColumns(), [t])
	const availableRefTypes = useMemo(
		() =>
			Array.from(
				new Set(
					rows.map((entry) => entry.refTypeLabel).filter((type): type is string => Boolean(type))
				)
			).sort(),
		[rows, t]
	)
	const refTypeOptions = useMemo(
		() => [
			{ value: 'all', label: t('hrpages.allTypes') },
			...availableRefTypes.map((type) => ({ value: type, label: type })),
		],
		[availableRefTypes, t]
	)
	const filteredData = useMemo(
		() =>
			refTypeFilter === 'all'
				? rows
				: rows.filter((entry) => (entry.refTypeLabel ?? t('hrpages.unknown')) === refTypeFilter),
		[rows, refTypeFilter, t]
	)

	const table = (
		<FulcrumDataTable
			columns={columns}
			rows={filteredData}
			emptyMessage={
				isLoadingChunks ? t('hrpages.loadingJournalEntries') : t('hrpages.noJournalEntriesFound')
			}
			searchPlaceholder={t('hrpages.searchJournal')}
			pageSize={100}
			compactRows
			getRowKey={(entry) => entry.id}
			getRowClassName={(row) => (isHighlightedJournalType(row) ? '!bg-amber-500/10' : undefined)}
			customActions={
				<div className="ml-auto flex items-center gap-2">
					{isLoadingChunks && (
						<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
							{t('hrpages.loadingChunks')}
							{loadingProgress?.loadedChunks ?? 0}/{loadingProgress?.totalChunks ?? 0}
						</span>
					)}
					<label
						htmlFor="journal-ref-type-filter"
						className="text-xs font-medium text-muted-foreground"
					>
						{t('hrpages.transactionType')}
					</label>
					<Select
						inputId="journal-ref-type-filter"
						value={refTypeFilter}
						onValueChange={(value) => setRefTypeFilter(value)}
						options={refTypeOptions}
						searchable
						placeholder={t('hrpages.allTypes')}
						className="w-56"
					/>
					<span className="text-xs text-muted-foreground">
						{filteredData.length} / {rows.length}
					</span>
				</div>
			}
		/>
	)

	if (rows.length === 0 && !isLoadingChunks) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noJournalEntriesFound')}</p>
	}

	// Most recent entry's balance is the current wallet balance
	const currentBalance = rows[0]?.balanceFormatted

	return (
		<div className="space-y-3">
			{currentBalance && (
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">{t('hrpages.walletBalance2')}</span>
					<span className="font-mono font-semibold">{currentBalance} ISK</span>
				</div>
			)}
			<p className="text-xs text-muted-foreground italic">
				{t('hrpages.noteEsiOnlyReturnsJournalEntriesFromTheLast30')}
			</p>
			{table}
		</div>
	)
}
