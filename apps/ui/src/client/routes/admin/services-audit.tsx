import { AlertTriangle, Ban, Play, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingInline, LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
	isTerminalRunStatus,
	useCancelServicesAuditScan,
	useServicesAuditRun,
	useServicesAuditRunRows,
	useServicesAuditRuns,
	useStartServicesAuditScan,
} from '@/hooks/useServicesAudit'
import { characterPortraitUrl, corporationLogoUrl } from '@/lib/eve-images'

import type { BadgeVariant } from '@/components/ui/badge'
import type {
	ServiceEligibilityReasonCode,
	ServicesAuditRunDetail,
	ServicesAuditRunStatus,
} from '@/lib/api'
import type { ComponentType } from 'react'

/**
 * SERVICE ACCESS AUDIT — READ-ONLY.
 *
 * This page reports. It does not act. There is deliberately no enforce button,
 * no confirm dialog and no enforce API call anywhere in this file, because
 * enforcement is not built: the point of shipping the scan alone is to learn the
 * real ineligible count before anyone commits to revoking accounts on an
 * estimate.
 *
 * The page's job is to let a human decide whether to TRUST the number. That is
 * why the member-corp basis is rendered as prominently as the ineligible count
 * (an inverted basis is what makes an ineligible count wrong), why the reason
 * breakdown is shown by subcode rather than as one total (3,900 `null_corp` is a
 * broken ESI sync, not 3,900 infiltrators), and why names are shown at all
 * (somebody must be able to recognise a person who obviously should not be on
 * the list).
 */

const REASON_LABELS: Record<ServiceEligibilityReasonCode, string> = {
	member_corp: 'In a member corporation',
	admin_exempt: 'Admin (exempt)',
	no_characters: 'No characters',
	null_corp: 'No corporation on record',
	only_deleted_member_char: 'Only deleted member characters',
	unmanaged_corp: 'Corporation is not a member corp',
	no_user_row: 'No user row',
}

const REASON_ORDER: ServiceEligibilityReasonCode[] = [
	'member_corp',
	'admin_exempt',
	'unmanaged_corp',
	'null_corp',
	'only_deleted_member_char',
	'no_characters',
	'no_user_row',
]

function reasonBadgeVariant(reason: ServiceEligibilityReasonCode): BadgeVariant {
	if (reason === 'member_corp') return 'success'
	if (reason === 'admin_exempt') return 'secondary'
	// `null_corp` and `no_user_row` are the two subcodes most likely to mean
	// "our data is broken" rather than "this person should lose access".
	if (reason === 'null_corp' || reason === 'no_user_row') return 'warning'
	return 'destructive'
}

const STATUS_VARIANTS: Record<ServicesAuditRunStatus, BadgeVariant> = {
	scanning: 'default',
	blocked: 'destructive',
	awaiting_confirmation: 'warning',
	enforcing: 'warning',
	completed: 'success',
	completed_with_errors: 'warning',
	failed: 'destructive',
	cancelled: 'ghost',
}

const STATUS_LABELS: Record<ServicesAuditRunStatus, string> = {
	scanning: 'Scanning',
	blocked: 'Blocked',
	awaiting_confirmation: 'Ineligible users found',
	enforcing: 'Enforcing',
	completed: 'Completed',
	completed_with_errors: 'Completed with errors',
	failed: 'Failed',
	cancelled: 'Cancelled',
}

function formatTimestamp(value: string | null): string {
	if (!value) return '—'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function StatTile({
	label,
	value,
	hint,
	icon: Icon,
	emphasis,
}: {
	label: string
	value: string
	hint: string
	icon?: ComponentType<{ className?: string }>
	emphasis?: 'danger' | 'warning'
}) {
	return (
		<Card className={emphasis === 'danger' ? 'border-destructive/60' : undefined}>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium">{label}</CardTitle>
				{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
			</CardHeader>
			<CardContent>
				<div
					className={
						emphasis === 'danger'
							? 'text-2xl font-bold text-destructive'
							: emphasis === 'warning'
								? 'text-2xl font-bold text-warning'
								: 'text-2xl font-bold'
					}
				>
					{value}
				</div>
				<p className="text-xs text-muted-foreground mt-1">{hint}</p>
			</CardContent>
		</Card>
	)
}

/**
 * A list of corporations, by NAME.
 *
 * The audit rows store corporation IDs, because the eligibility rule is defined
 * over ids and most of these corps are unmanaged by definition — being in an
 * unmanaged corp is the usual reason someone is on this list, so
 * `managed_corporations` cannot supply their names. `useEntityNames` resolves any
 * id through the shared batched/cached lookup, which is how tax-rules,
 * tax-alerts and the HR recommendations list already do this.
 *
 * Ids are the fallback, never the presentation: "1000077, 98803465" is not
 * something a human can audit, and auditing is this page's only job.
 */
function CorporationNameList({
	corporationIds,
	names,
	withLogos = false,
	className,
}: {
	corporationIds: string[]
	/** Resolved id -> name. Looked up ONCE at page level and passed in: this
	 * component renders per table row, so calling useEntityNames here would issue
	 * one request per row (a different id set is a different cache key) and defeat
	 * the batching the hook exists for. */
	names: Record<string, string>
	withLogos?: boolean
	className?: string
}) {
	if (corporationIds.length === 0) return <span className="text-muted-foreground">—</span>

	if (!withLogos) {
		return (
			<span className={className}>
				{corporationIds.map((id) => names[id] ?? id).join(', ')}
			</span>
		)
	}

	return (
		<div className={`flex flex-wrap gap-x-3 gap-y-1 ${className ?? ''}`}>
			{corporationIds.map((id) => (
				<span key={id} className="inline-flex items-center gap-1.5">
					<img
						src={corporationLogoUrl(id, 32)}
						alt=""
						className="h-4 w-4 rounded-sm"
						loading="lazy"
					/>
					<span>{names[id] ?? id}</span>
				</span>
			))}
		</div>
	)
}

/**
 * The blocked banner. Rendered before anything else and visually unmistakable —
 * a blocked run's counts are meaningless and must never be read as a result.
 *
 * Only an EMPTY basis blocks. That is the one unambiguous case.
 */
function BlockedBanner({ run }: { run: ServicesAuditRunDetail }) {
	return (
		<Card className="border-destructive bg-destructive/10">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-destructive">
					<ShieldAlert className="h-5 w-5" />
					Run blocked — no corporations are flagged as member corporations
				</CardTitle>
				<CardDescription className="text-destructive/90">
					No rows were written and nothing was scanned. This is not overridable.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm whitespace-pre-wrap">
					{run.errorMessage ?? 'No error message was recorded on this run.'}
				</p>
				<p className="text-xs text-muted-foreground">
					Because <code>is_member_corporation</code> defaults to false, an empty corporation list
					does not weaken the eligibility rule — it inverts it, making every non-admin look
					ineligible. Fix the corporation data, then scan again.
				</p>
			</CardContent>
		</Card>
	)
}

/**
 * The suspect-basis banner. This is the tool's most important safety message.
 *
 * A shrinking basis deliberately does NOT block: de-flagging a corporation is
 * how a corp legitimately stops being a member corp, and it shrinks the basis by
 * construction — so blocking would refuse the tool's primary emergency use case.
 * Instead we show WHICH corporations left, because a count ratio cannot tell "I
 * de-flagged those 13" from "the table is half-restored", and a human reading the
 * names can do it in seconds.
 */
function BasisSuspectBanner({
	run,
	corporationNames,
}: {
	run: ServicesAuditRunDetail
	corporationNames: Record<string, string>
}) {
	const removed = run.basisRemovedCorporationIds ?? []
	return (
		<Card className="border-amber-500 bg-amber-500/10">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
					<ShieldAlert className="h-5 w-5" />
					The member-corporation basis shrank — check this before trusting the numbers below
				</CardTitle>
				<CardDescription>
					{run.memberCorpCount} member corporation{run.memberCorpCount === 1 ? '' : 's'} now, versus
					a high of {run.basisComparedToCount} in the last 30 days.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm whitespace-pre-wrap">{run.basisNote}</p>
				{removed.length > 0 && (
					<div>
						<p className="text-xs font-medium mb-1">
							{removed.length} corporation{removed.length === 1 ? '' : 's'} left the basis:
						</p>
						{/* By name and logo, not id. This banner asks the operator to recognise
						    these corporations — which is impossible from a list of numbers, and
						    recognition is the entire safety mechanism here. */}
						<CorporationNameList
							corporationIds={removed}
							names={corporationNames}
							withLogos
							className="text-xs"
						/>
						<p className="text-xs text-muted-foreground mt-2">
							Recognise them? Then you de-flagged them and this scan is correct. Don’t recognise
							them? <code>managed_corporations</code> may be half-restored or mid-sync, and the
							counts below are not trustworthy.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}

export default function AdminServicesAuditPage() {
	usePageTitle('Admin - Services Audit')

	const [selectedRunId, setSelectedRunId] = useState<string>('')
	const [reasonFilter, setReasonFilter] = useState<string>('all')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

	const runsQuery = useServicesAuditRuns()
	const runs = runsQuery.data?.items ?? []

	// Default to the newest run without needing an effect: the server returns runs
	// newest-first, and an explicit selection always wins.
	const activeRunId = selectedRunId || runs[0]?.id || ''

	const runQuery = useServicesAuditRun(activeRunId)
	const run = runQuery.data

	const rowsQuery = useServicesAuditRunRows(activeRunId, {
		reason: reasonFilter === 'all' ? undefined : (reasonFilter as ServiceEligibilityReasonCode),
		page,
		pageSize,
	})

	const startScan = useStartServicesAuditScan()
	const cancelScan = useCancelServicesAuditScan()

	/**
	 * Resolve every corporation id on the page in ONE batched lookup — the rows
	 * table plus the suspect-basis banner. Done here rather than inside the row
	 * component because a per-row lookup is a per-row cache key, i.e. one request
	 * per row.
	 */
	const corporationIdsOnPage = useMemo(() => {
		const ids = new Set<string>()
		for (const row of rowsQuery.data?.rows ?? []) {
			for (const id of row.corporationIds) ids.add(id)
		}
		for (const id of run?.basisRemovedCorporationIds ?? []) ids.add(id)
		return [...ids]
	}, [rowsQuery.data, run?.basisRemovedCorporationIds])

	const { data: corporationNames = {} } = useEntityNames(corporationIdsOnPage, {
		enabled: corporationIdsOnPage.length > 0,
	})

	const anyRunLive = runs.some((item) => !isTerminalRunStatus(item.status))

	const ineligibleBreakdown = (run?.reasonBreakdown ?? [])
		.filter((entry) => !entry.eligible)
		.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason))
	const eligibleBreakdown = (run?.reasonBreakdown ?? [])
		.filter((entry) => entry.eligible)
		.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason))

	const runOptions = runs.map((item) => ({
		value: item.id,
		// A suspect basis is marked in the PICKER, not only inside the run: someone
		// choosing between runs has to see which ones not to believe before they
		// have read a single number.
		label: `${STATUS_LABELS[item.status]}${item.basisSuspect ? ' ⚠ basis' : ''} — ${formatTimestamp(item.startedAt)}`,
		description: `${item.ineligibleCount.toLocaleString()} ineligible of ${item.scanned.toLocaleString()} scanned · basis ${item.memberCorpCount.toLocaleString()} corps${item.basisSuspect ? ' (shrank — numbers may be wrong)' : ''}`,
	}))

	const reasonOptions = [
		{ value: 'all', label: 'All reasons' },
		...REASON_ORDER.map((reason) => ({ value: reason, label: REASON_LABELS[reason] })),
	]

	return (
		<div className="space-y-6">
			<PageHeader
				title="Services Audit"
				description="Read-only scan of who is eligible for Mumble and Discord access, based on membership of a member corporation."
				action={
					<Button
						onClick={() => startScan.mutate()}
						disabled={startScan.isPending || anyRunLive}
						title={anyRunLive ? 'A scan is already in progress' : undefined}
					>
						{startScan.isPending ? <LoadingInline className="mr-2" /> : <Play className="mr-2 h-4 w-4" />}
						Start scan
					</Button>
				}
			/>

			{/* Nothing on this page acts. Say so once, plainly, at the top. */}
			<Card className="border-primary/40 bg-primary/5">
				<CardContent className="flex items-start gap-3 pt-6">
					<ShieldCheck className="h-5 w-5 flex-shrink-0 text-primary" />
					<div className="space-y-1 text-sm">
						<p className="font-medium">This tool only reports. Nothing here revokes anything.</p>
						<p className="text-muted-foreground">
							No Mumble account is deleted and no Discord role is removed by this page. Enforcement
							is not built yet. A scan tells you how many accounts <em>would</em> be affected so
							that decision can be made on a real number rather than an estimate.
						</p>
					</div>
				</CardContent>
			</Card>

			{startScan.isError && (
				<Card className="border-destructive">
					<CardContent className="pt-6 text-sm text-destructive">
						Failed to start scan: {startScan.error.message}
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Runs</CardTitle>
					<CardDescription>The 25 most recent scans, newest first.</CardDescription>
				</CardHeader>
				<CardContent>
					{runsQuery.isLoading ? (
						<LoadingSpinner size="sm" label="Loading runs..." />
					) : runsQuery.isError ? (
						<p className="text-sm text-destructive">
							Failed to load runs: {runsQuery.error.message}
						</p>
					) : runs.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground">
							No scans have been run yet. Start one to see who is currently ineligible.
						</p>
					) : (
						<div className="max-w-xl">
							<Select
								options={runOptions}
								value={activeRunId}
								onValueChange={(value) => {
									setSelectedRunId(value)
									setPage(1)
								}}
								placeholder="Select a run"
							/>
						</div>
					)}
				</CardContent>
			</Card>

			{activeRunId && runQuery.isLoading && <LoadingSpinner size="sm" label="Loading run..." />}

			{runQuery.isError && (
				<Card className="border-destructive">
					<CardContent className="pt-6 text-sm text-destructive">
						Failed to load run: {runQuery.error.message}
					</CardContent>
				</Card>
			)}

			{run && (
				<>
					{run.status === 'blocked' && <BlockedBanner run={run} />}
					{run.basisSuspect && run.status !== 'blocked' && <BasisSuspectBanner run={run} corporationNames={corporationNames} />}

					{run.status === 'failed' && (
						<Card className="border-destructive">
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-destructive">
									<AlertTriangle className="h-5 w-5" />
									Run failed
								</CardTitle>
							</CardHeader>
							<CardContent className="text-sm">
								{run.errorMessage ?? 'No error message was recorded on this run.'}
							</CardContent>
						</Card>
					)}

					<Card>
						<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
							<div className="space-y-1">
								<CardTitle className="flex items-center gap-2">
									<Badge variant={STATUS_VARIANTS[run.status]}>{STATUS_LABELS[run.status]}</Badge>
									{!isTerminalRunStatus(run.status) && (
										<span className="text-sm font-normal text-muted-foreground">
											Refreshing every 5s
										</span>
									)}
								</CardTitle>
								<CardDescription>
									Started {formatTimestamp(run.startedAt)} · Completed{' '}
									{formatTimestamp(run.completedAt)}
								</CardDescription>
							</div>
							{!isTerminalRunStatus(run.status) && (
								<Button
									variant="secondary"
									onClick={() => cancelScan.mutate(run.id)}
									disabled={cancelScan.isPending}
								>
									{cancelScan.isPending ? (
										<LoadingInline className="mr-2" />
									) : (
										<Ban className="mr-2 h-4 w-4" />
									)}
									Cancel scan
								</Button>
							)}
						</CardHeader>
						<CardContent className="space-y-6">
							{/* The basis is a headline number, not a footnote: it is the thing
							    that decides whether the ineligible count means anything. */}
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
								<StatTile
									label="Member corporations (basis)"
									value={run.memberCorpCount.toLocaleString()}
									hint="Corps that confer eligibility. If this looks wrong, every count below is wrong."
									icon={ShieldCheck}
									emphasis={run.memberCorpCount < 1 ? 'danger' : undefined}
								/>
								<StatTile
									label="Users scanned"
									value={run.scanned.toLocaleString()}
									hint="Every user row walked, eligible or not."
								/>
								<StatTile
									label="In population"
									value={run.inPopulation.toLocaleString()}
									hint={
										run.mumblePopulationKnown
											? 'Users holding a Discord link or a Mumble account.'
											: 'Discord-linked users ONLY — see the note below.'
									}
									emphasis={run.mumblePopulationKnown ? undefined : 'warning'}
								/>
								<StatTile
									label="Ineligible"
									value={run.ineligibleCount.toLocaleString()}
									hint="Would be affected if enforcement existed. Nothing has been revoked."
									icon={ShieldAlert}
									emphasis={run.ineligibleCount > 0 ? 'danger' : undefined}
								/>
							</div>

							{/* An incomplete denominator that presents itself as complete is
							    worse than no denominator. Say what it does not cover. */}
							{!run.mumblePopulationKnown && (
								<div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
									<p className="font-medium text-warning">The population figure is incomplete.</p>
									<p className="mt-1 text-muted-foreground">
										&ldquo;In population&rdquo; counts Discord-linked users only (
										<code>{run.inPopulationBasis}</code>). Mumble provisioning state lives in the
										Mumble service and cannot be read without a service call, which this read-only
										scan does not make. A user with a Mumble account but no Discord link is{' '}
										<strong>not</strong> counted here, so the true affected population may be larger
										than this number.
									</p>
								</div>
							)}

							{run.blastRadiusTripped && (
								<div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
									<p className="flex items-center gap-2 font-medium text-warning">
										<AlertTriangle className="h-4 w-4" />
										Unusually large blast radius
									</p>
									<p className="mt-1 text-muted-foreground">
										More than 20% of scanned users came back ineligible. The eligibility basis
										passed its checks, so this may be genuine — but check the reason breakdown
										below before believing it. A single dominant subcode usually means broken data
										rather than a broken alliance.
									</p>
								</div>
							)}

							{!run.mumbleFeature.enabled && (
								<div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
									<p className="font-medium text-warning">
										Mumble feature state: {run.mumbleFeature.state.replace(/_/g, ' ')}
									</p>
									<p className="mt-1 text-muted-foreground">{run.mumbleFeature.message}</p>
								</div>
							)}

							<div className="space-y-3">
								<div>
									<h3 className="text-sm font-medium">Ineligible by reason</h3>
									<p className="text-xs text-muted-foreground">
										Subcodes, not a single total. A large <code>null_corp</code> or{' '}
										<code>no_characters</code> group points at a data problem, not at people.
									</p>
								</div>
								{ineligibleBreakdown.length === 0 ? (
									<p className="text-sm text-muted-foreground">No ineligible users in this run.</p>
								) : (
									<div className="flex flex-wrap gap-2">
										{ineligibleBreakdown.map((entry) => (
											<Badge key={entry.reason} variant={reasonBadgeVariant(entry.reason)}>
												{REASON_LABELS[entry.reason]}: {entry.count.toLocaleString()}
											</Badge>
										))}
									</div>
								)}
								{eligibleBreakdown.length > 0 && (
									<>
										<h3 className="pt-2 text-sm font-medium">Eligible by reason</h3>
										<div className="flex flex-wrap gap-2">
											{eligibleBreakdown.map((entry) => (
												<Badge key={entry.reason} variant={reasonBadgeVariant(entry.reason)}>
													{REASON_LABELS[entry.reason]}: {entry.count.toLocaleString()}
												</Badge>
											))}
										</div>
									</>
								)}
							</div>

							{run.sample.length > 0 && (
								<div className="space-y-3">
									<div>
										<h3 className="text-sm font-medium">Sample of affected people</h3>
										<p className="text-xs text-muted-foreground">
											Up to 10 names. If you recognise someone here who obviously should keep
											access, stop and investigate the basis rather than the person.
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										{run.sample.map((sampleRow) => (
											<div
												key={sampleRow.userId}
												className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
											>
												{sampleRow.mainCharacterId && (
													<img
														src={characterPortraitUrl(sampleRow.mainCharacterId, 32)}
														alt=""
														className="h-6 w-6 rounded-full"
													/>
												)}
												<span className="text-sm">
													{sampleRow.mainCharacterName ?? sampleRow.userId}
												</span>
												<Badge variant={reasonBadgeVariant(sampleRow.reason)}>
													{REASON_LABELS[sampleRow.reason]}
												</Badge>
											</div>
										))}
									</div>
								</div>
							)}

							{run.ineligibleCount > 0 && isTerminalRunStatus(run.status) && run.status !== 'blocked' && (
								<div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
									<p className="font-medium">
										{run.ineligibleCount.toLocaleString()} users are ineligible. Nothing has been
										revoked.
									</p>
									<p className="mt-1 text-muted-foreground">
										No Mumble account has been deleted and no Discord role has been removed.
										Enforcement is not built yet — this run is a report, and it will stay a report.
									</p>
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Rows</CardTitle>
							<CardDescription>
								Every user this scan recorded. Filtering and pagination happen server-side.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="max-w-sm">
								<Select
									options={reasonOptions}
									value={reasonFilter}
									onValueChange={(value) => {
										setReasonFilter(value)
										setPage(1)
									}}
									placeholder="Filter by reason"
								/>
							</div>

							<UserSearchPaginationControls
								totalCount={rowsQuery.data?.pagination.totalCount ?? 0}
								page={page}
								pageSize={pageSize}
								pageSizeOptions={[10, 25, 50, 100]}
								onPageChange={setPage}
								onPageSizeChange={(nextPageSize) => {
									setPageSize(nextPageSize)
									setPage(1)
								}}
							/>

							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Character</TableHead>
										<TableHead>Eligible</TableHead>
										<TableHead>Reason</TableHead>
										<TableHead>Discord linked</TableHead>
										<TableHead>Corporations</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{rowsQuery.isLoading ? (
										<TableRow>
											<TableCell colSpan={5}>
												<LoadingSpinner size="sm" label="Loading rows..." />
											</TableCell>
										</TableRow>
									) : rowsQuery.isError ? (
										<TableRow>
											<TableCell colSpan={5} className="py-8 text-center text-destructive">
												Failed to load rows: {rowsQuery.error.message}
											</TableCell>
										</TableRow>
									) : (rowsQuery.data?.rows.length ?? 0) === 0 ? (
										<TableRow>
											<TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
												No rows match this filter.
											</TableCell>
										</TableRow>
									) : (
										rowsQuery.data?.rows.map((row) => (
											<TableRow key={row.id}>
												<TableCell>
													<div className="flex items-center gap-2">
														{row.mainCharacterId && (
															<img
																src={characterPortraitUrl(row.mainCharacterId, 32)}
																alt=""
																className="h-6 w-6 rounded-full"
															/>
														)}
														<span>{row.mainCharacterName ?? row.userId}</span>
													</div>
												</TableCell>
												<TableCell>
													<Badge variant={row.eligible ? 'success' : 'destructive'}>
														{row.eligible ? 'Eligible' : 'Ineligible'}
													</Badge>
												</TableCell>
												<TableCell>
													<Badge variant={reasonBadgeVariant(row.reason)}>
														{REASON_LABELS[row.reason]}
													</Badge>
												</TableCell>
												<TableCell>
													{row.hasDiscordLink ? (
														<Badge variant="default">Linked</Badge>
													) : (
														<Badge variant="ghost">Not linked</Badge>
													)}
												</TableCell>
												<TableCell className="text-muted-foreground">
													<CorporationNameList corporationIds={row.corporationIds} names={corporationNames} />
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>

							<div className="border-t border-border pt-4">
								<UserSearchPaginationControls
									totalCount={rowsQuery.data?.pagination.totalCount ?? 0}
									page={page}
									pageSize={pageSize}
									pageSizeOptions={[10, 25, 50, 100]}
									onPageChange={setPage}
									onPageSizeChange={(nextPageSize) => {
										setPageSize(nextPageSize)
										setPage(1)
									}}
								/>
							</div>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
