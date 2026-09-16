import { useMemo, useState } from 'react'

import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import { TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxAuditLogEntry } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

type TaxAuditLogGridProps = {
	rows: TaxAuditLogEntry[]
	loading?: boolean
	error?: unknown
	entityNames: Record<string, string>
	actorDisplayNames: Record<string, string>
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectDiffPaths(before: unknown, after: unknown, basePath = '$'): Set<string> {
	const changed = new Set<string>()
	if (Object.is(before, after)) {
		return changed
	}

	if (Array.isArray(before) && Array.isArray(after)) {
		const maxLength = Math.max(before.length, after.length)
		for (let index = 0; index < maxLength; index += 1) {
			const childPath = `${basePath}[${index}]`
			const childChanges = collectDiffPaths(before[index], after[index], childPath)
			for (const path of childChanges) {
				changed.add(path)
			}
		}
		if (before.length !== after.length) {
			changed.add(basePath)
		}
		return changed
	}

	if (isPlainObject(before) && isPlainObject(after)) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)])
		for (const key of keys) {
			const childPath = `${basePath}.${key}`
			const childChanges = collectDiffPaths(before[key], after[key], childPath)
			for (const path of childChanges) {
				changed.add(path)
			}
		}
		return changed
	}

	changed.add(basePath)
	return changed
}

function pathHasDiff(path: string, changedPaths: Set<string>): boolean {
	for (const candidate of changedPaths) {
		if (candidate === path) {
			return true
		}
		if (candidate.startsWith(`${path}.`) || candidate.startsWith(`${path}[`)) {
			return true
		}
	}
	return false
}

function formatPrimitive(value: unknown): string {
	if (typeof value === 'string') {
		return JSON.stringify(value)
	}
	if (value === null) {
		return 'null'
	}
	if (typeof value === 'undefined') {
		return 'undefined'
	}
	return String(value)
}

function JsonValueView({
	value,
	path = '$',
	depth = 0,
	isLast = true,
	changedPaths,
}: {
	value: unknown
	path?: string
	depth?: number
	isLast?: boolean
	changedPaths: Set<string>
}) {
	const indent = { paddingLeft: `${depth * 16}px` }
	const lineClass = (linePath: string) =>
		pathHasDiff(linePath, changedPaths) ? 'bg-amber-500/10 text-amber-100' : ''

	if (Array.isArray(value)) {
		return (
			<>
				<div style={indent}>[</div>
				{value.map((item, index) => {
					const childPath = `${path}[${index}]`
					const childIsLast = index === value.length - 1
					if (Array.isArray(item) || isPlainObject(item)) {
						return (
							<div key={childPath} className={lineClass(childPath)}>
								<JsonValueView
									value={item}
									path={childPath}
									depth={depth + 1}
									isLast={childIsLast}
									changedPaths={changedPaths}
								/>
							</div>
						)
					}
					return (
						<div
							key={childPath}
							style={{ paddingLeft: `${(depth + 1) * 16}px` }}
							className={lineClass(childPath)}
						>
							{formatPrimitive(item)}
							{childIsLast ? '' : ','}
						</div>
					)
				})}
				<div style={indent}>]{isLast ? '' : ','}</div>
			</>
		)
	}

	if (isPlainObject(value)) {
		const entries = Object.entries(value)
		return (
			<>
				<div style={indent}>{'{'}</div>
				{entries.map(([key, childValue], index) => {
					const childPath = `${path}.${key}`
					const childIsLast = index === entries.length - 1
					if (Array.isArray(childValue) || isPlainObject(childValue)) {
						return (
							<div key={childPath} className={lineClass(childPath)}>
								<div style={{ paddingLeft: `${(depth + 1) * 16}px` }}>"{key}":</div>
								<JsonValueView
									value={childValue}
									path={childPath}
									depth={depth + 2}
									isLast={childIsLast}
									changedPaths={changedPaths}
								/>
							</div>
						)
					}
					return (
						<div
							key={childPath}
							style={{ paddingLeft: `${(depth + 1) * 16}px` }}
							className={lineClass(childPath)}
						>
							"{key}": {formatPrimitive(childValue)}
							{childIsLast ? '' : ','}
						</div>
					)
				})}
				<div style={indent}>
					{'}'}
					{isLast ? '' : ','}
				</div>
			</>
		)
	}

	return (
		<div style={indent} className={lineClass(path)}>
			{formatPrimitive(value)}
			{isLast ? '' : ','}
		</div>
	)
}

export function TaxAuditLogGrid(props: TaxAuditLogGridProps) {
	const { t } = useAppTranslation()

	const [selectedEntry, setSelectedEntry] = useState<TaxAuditLogEntry | null>(null)
	const changedPaths = useMemo(
		() => collectDiffPaths(selectedEntry?.before ?? null, selectedEntry?.after ?? null),
		[selectedEntry, t]
	)

	const columns = [
		{
			id: 'createdAt',
			header: t('tax.time'),
			sortable: true,
			cell: (row: TaxAuditLogEntry) => formatTaxDateTime(row.createdAt),
		},
		{
			id: 'action',
			header: t('tax.action'),
			sortable: true,
			cell: (row: TaxAuditLogEntry) => <span className="font-medium">{row.action}</span>,
		},
		{
			id: 'actorUserId',
			header: t('tax.actor'),
			sortable: true,
			cell: (row: TaxAuditLogEntry) => {
				const actorUserId = row.actorUserId
				const actorName = props.actorDisplayNames[actorUserId]
				return (
					<div className="flex flex-col">
						<span>{actorName ?? actorUserId}</span>
						{actorName ? (
							<span className="font-mono text-xs text-muted-foreground">{actorUserId}</span>
						) : null}
					</div>
				)
			},
		},
		{
			id: 'corporationId',
			header: t('tax.corporation'),
			sortable: true,
			cell: (row: TaxAuditLogEntry) => {
				const corporationId = row.corporationId
				if (!corporationId) {
					return <span>{t('tax.global')}</span>
				}
				return (
					<TaxCorporationDisplay corporationId={corporationId} entityNames={props.entityNames} />
				)
			},
		},
		{
			id: 'actions',
			header: t('tax.actions'),
			cell: (row: TaxAuditLogEntry) => (
				<Button
					variant="ghost"
					type="button"
					className="h-8 px-3"
					onClick={() => setSelectedEntry(row)}
				>
					{t('tax.view')}
				</Button>
			),
		},
	]

	return (
		<>
			<DataTable
				variant="plain"
				errorMessage={t('tax.failedToLoadReport')}
				columns={columns}
				rows={props.rows}
				loading={props.loading}
				error={props.error}
				emptyMessage={t('tax.noAuditEntriesMatchedTheSelectedFilters')}
				sorting={props.sorting}
				onSortingChange={props.onSortingChange}
				pagination={props.pagination}
				onPaginationChange={props.onPaginationChange}
				rowCount={props.rowCount}
				itemLabel={t('tax.auditEntries')}
				getRowKey={(row) => row.id}
			/>

			<Dialog
				open={Boolean(selectedEntry)}
				onOpenChange={(open) => !open && setSelectedEntry(null)}
			>
				<DialogContent className="max-w-6xl">
					<DialogHeader>
						<DialogTitle>{t('tax.auditPayloadDiff')}</DialogTitle>
						<DialogDescription>
							{selectedEntry
								? t('tax.value1Value2Value3ChangedPaths', {
										value1: selectedEntry.action,
										value2: formatTaxDateTime(selectedEntry.createdAt),
										value3: changedPaths.size,
									})
								: t('tax.auditPayloadDetails')}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="rounded-md border border-border">
							<div className="border-b border-border px-3 py-2 text-sm font-semibold">
								{t('tax.before')}
							</div>
							<div className="max-h-[60vh] overflow-auto px-3 py-2 font-mono text-xs leading-6">
								<JsonValueView value={selectedEntry?.before ?? null} changedPaths={changedPaths} />
							</div>
						</div>
						<div className="rounded-md border border-border">
							<div className="border-b border-border px-3 py-2 text-sm font-semibold">
								{t('tax.after')}
							</div>
							<div className="max-h-[60vh] overflow-auto px-3 py-2 font-mono text-xs leading-6">
								<JsonValueView value={selectedEntry?.after ?? null} changedPaths={changedPaths} />
							</div>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
