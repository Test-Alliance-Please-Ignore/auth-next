import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { usePageTitle } from '@/hooks/usePageTitle'

import { LedgerTable } from '../components/ledger-table'
import { MarketHistoryTable } from '../components/market-history-table'
import { useAuditLedger, useMarketHistory } from '../hooks'

import type { LedgerType } from '../types'

const LEDGER_TYPE_OPTIONS = [
	{ value: 'all', label: 'All types' },
	{ value: 'grant', label: 'Grant' },
	{ value: 'wager', label: 'Wager' },
	{ value: 'refund', label: 'Refund' },
	{ value: 'payout', label: 'Payout' },
	{ value: 'rake', label: 'Rake' },
	{ value: 'burn', label: 'Burn' },
	{ value: 'adjustment', label: 'Adjustment' },
	{ value: 'creator_reward', label: 'Creator reward' },
]

/** A YYYY-MM-DD date-input value → an ISO instant (start or end of day, UTC). */
function toIso(dateStr: string, endOfDay = false): string | undefined {
	if (!dateStr) return undefined
	const d = new Date(`${dateStr}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`)
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export default function PredictionMarketAudit() {
	usePageTitle('Admin - Prediction Market Audit')

	// Financial ledger tab
	const [ledgerType, setLedgerType] = useState('all')
	const [ledgerSince, setLedgerSince] = useState('')
	const [ledgerUntil, setLedgerUntil] = useState('')
	const [ledgerPage, setLedgerPage] = useState({ limit: 50, offset: 0 })

	const ledger = useAuditLedger({
		type: ledgerType === 'all' ? undefined : (ledgerType as LedgerType),
		since: toIso(ledgerSince),
		until: toIso(ledgerUntil, true),
		limit: ledgerPage.limit,
		offset: ledgerPage.offset,
	})
	const ledgerTotal = ledger.data?.total ?? 0

	// Market lifecycle tab
	const [visibility, setVisibility] = useState('public')
	const [historyPage, setHistoryPage] = useState({ limit: 50, offset: 0 })

	const history = useMarketHistory({
		includeInternal: visibility === 'all',
		limit: historyPage.limit,
		offset: historyPage.offset,
	})
	const historyTotal = history.data?.total ?? 0

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold gradient-text">Prediction Market Audit Log</h1>
				<p className="mt-1 text-muted-foreground">
					Immutable financial ledger and market-lifecycle history.
				</p>
			</div>

			<Tabs defaultValue="ledger" className="w-full">
				<TabsList className="grid w-full max-w-md grid-cols-2">
					<TabsTrigger value="ledger">Financial ledger</TabsTrigger>
					<TabsTrigger value="history">Market lifecycle</TabsTrigger>
				</TabsList>

				<TabsContent value="ledger" className="space-y-4">
					<div className="flex flex-wrap items-end gap-4">
						<div className="w-48 space-y-2">
							<Label htmlFor="pm-audit-type">Type</Label>
							<Select
								inputId="pm-audit-type"
								value={ledgerType}
								onValueChange={(val) => {
									setLedgerType(val)
									setLedgerPage((p) => ({ ...p, offset: 0 }))
								}}
								options={LEDGER_TYPE_OPTIONS}
								placeholder="All types"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="pm-audit-since">From</Label>
							<Input
								id="pm-audit-since"
								type="date"
								value={ledgerSince}
								onChange={(e) => {
									setLedgerSince(e.target.value)
									setLedgerPage((p) => ({ ...p, offset: 0 }))
								}}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="pm-audit-until">To</Label>
							<Input
								id="pm-audit-until"
								type="date"
								value={ledgerUntil}
								onChange={(e) => {
									setLedgerUntil(e.target.value)
									setLedgerPage((p) => ({ ...p, offset: 0 }))
								}}
							/>
						</div>
					</div>

					<LedgerTable rows={ledger.data?.rows} isLoading={ledger.isLoading} error={ledger.error} />
					{ledgerTotal > 0 ? (
						<UserSearchPaginationControls
							totalCount={ledgerTotal}
							page={Math.floor(ledgerPage.offset / ledgerPage.limit) + 1}
							pageSize={ledgerPage.limit}
							itemLabel="entries"
							nextButtonLoading={ledger.isFetching}
							onPageChange={(next) =>
								setLedgerPage((p) => ({ ...p, offset: (next - 1) * p.limit }))
							}
							onPageSizeChange={(size) => setLedgerPage({ limit: size, offset: 0 })}
						/>
					) : null}
				</TabsContent>

				<TabsContent value="history" className="space-y-4">
					<div className="w-48 space-y-2">
						<Label htmlFor="pm-audit-visibility">Visibility</Label>
						<Select
							inputId="pm-audit-visibility"
							value={visibility}
							onValueChange={(val) => {
								setVisibility(val)
								setHistoryPage((p) => ({ ...p, offset: 0 }))
							}}
							options={[
								{ value: 'public', label: 'Public only' },
								{ value: 'all', label: 'Include internal' },
							]}
						/>
					</div>

					<MarketHistoryTable
						rows={history.data?.rows}
						isLoading={history.isLoading}
						error={history.error}
					/>
					{historyTotal > 0 ? (
						<UserSearchPaginationControls
							totalCount={historyTotal}
							page={Math.floor(historyPage.offset / historyPage.limit) + 1}
							pageSize={historyPage.limit}
							itemLabel="events"
							nextButtonLoading={history.isFetching}
							onPageChange={(next) =>
								setHistoryPage((p) => ({ ...p, offset: (next - 1) * p.limit }))
							}
							onPageSizeChange={(size) => setHistoryPage({ limit: size, offset: 0 })}
						/>
					) : null}
				</TabsContent>
			</Tabs>
		</div>
	)
}
